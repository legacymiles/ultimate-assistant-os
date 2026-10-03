"use client";

// ---------------------------------------------------------------------------
// The scanner — a trail that remembers where the cursor has been.
//
// Two images occupy the same frame. Moving the pointer paints a trail, and that
// trail is the reveal mask: the hidden layer shows through where the pointer
// has recently been, with a thin band of pixel jitter and RGB split at the
// boundary, and the whole thing eases shut a beat after the pointer leaves.
//
// ----- why a trail and not a spotlight --------------------------------------
//
// A circle that follows the current pointer position is a hover effect and
// reads as one. The mask here is a RING BUFFER of the last ~24 positions, each
// ageing independently, so the tail fades before the head and a fast sweep
// leaves a stroke rather than a dot. That path-with-memory is the entire trick,
// and it is the one thing that cannot be faked with CSS.
//
// ----- why the layers are drawn, not loaded ----------------------------------
//
// The illusion collapses unless the two layers are pixel-aligned, so they are
// both painted into 2D canvases by the same callbacks at the same size — the
// alignment is a property of the construction rather than something to check.
// It also sidesteps the one thing that would break this outright: artwork from
// a catalogue CDN would taint a canvas and make `texImage2D` throw, so nothing
// here ever uploads a remote image.
//
// ----- what it degrades to ----------------------------------------------------
//
// `prefers-reduced-motion` and a browser without WebGL both get the same
// fallback: the two layers stacked, with a slider that crossfades between them.
// Static, keyboard-operable, and it still answers the question the scanner is
// there to answer — what is under the plate.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** How many pointer positions the trail remembers. */
const TRAIL_N = 24;
/** How long one position takes to fade from the trail, in ms. */
const HOLD_MS = 700;
/** Pointer movement, in uv, before a new position is pushed. */
const STEP = 0.009;

export type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

export interface ScannerProps {
  /** The calm layer — what the panel looks like sealed. */
  base: Painter;
  /** The hidden layer, in the same geometry. */
  reveal: Painter;
  /** Both layers are repainted when this changes. */
  signature: string;
  /** CSS height of the plate. */
  height: number;
  /** The scan rim's colour, as 0-1 rgb. */
  rim?: [number, number, number];
  /** Content laid over the plate. Typography leads; the plate is behind it. */
  children?: React.ReactNode;
  className?: string;
  /** Read by screen readers in place of the plate. */
  label: string;
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2((aPos.x + 1.0) * 0.5, 1.0 - (aPos.y + 1.0) * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
#define TRAIL_N ${TRAIL_N}
varying vec2 vUv;
uniform sampler2D uBase;
uniform sampler2D uReveal;
uniform vec2 uTrailPos[TRAIL_N];
uniform float uTrailAge[TRAIL_N];
uniform float uTime;
uniform float uAspect;
uniform float uSpeed;
uniform vec3 uRim;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  return 0.6 * noise(p) + 0.4 * noise(p * 2.07 + 11.3);
}

/* The mask: every remembered position contributes, the oldest least. */
float trailMask(vec2 uv) {
  float m = 0.0;
  for (int i = 0; i < TRAIL_N; i++) {
    float age = uTrailAge[i];
    if (age >= 1.0) continue;
    vec2 d = uv - uTrailPos[i];
    d.x *= uAspect;
    float radius = mix(0.085 + 0.02 * uSpeed, 0.022, age);
    float falloff = 1.0 - smoothstep(radius * 0.35, radius, length(d));
    m = max(m, falloff * (1.0 - age * age));
  }
  return clamp(m, 0.0, 1.0);
}

void main() {
  vec3 base = texture2D(uBase, vUv).rgb;
  float mask = trailMask(vUv);
  float edge = 4.0 * mask * (1.0 - mask);

  vec2 jitter = (vec2(fbm(vUv * 42.0 + uTime * 0.6), fbm(vUv * 42.0 - uTime * 0.6)) - 0.5) * 0.007 * edge;
  float split = 0.0028 * edge * (1.0 + 0.3 * uSpeed);
  vec3 revealed = vec3(
    texture2D(uReveal, vUv + jitter + vec2(split, 0.0)).r,
    texture2D(uReveal, vUv + jitter).g,
    texture2D(uReveal, vUv + jitter - vec2(split, 0.0)).b
  );

  vec3 out3 = mix(base, revealed, smoothstep(0.0, 0.85, mask));
  out3 += uRim * edge * 0.42;
  gl_FragColor = vec4(out3, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** A canvas painted by one of the callbacks, kept at device resolution. */
function paintInto(canvas: HTMLCanvasElement, painter: Painter, w: number, h: number, dpr: number) {
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  painter(ctx, w, h);
}

export function Scanner({ base, reveal, signature, height, rim = [0.49, 0.36, 1], children, className, label }: ScannerProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const glCanvas = useRef<HTMLCanvasElement | null>(null);
  const baseCanvas = useRef<HTMLCanvasElement | null>(null);
  const revealCanvas = useRef<HTMLCanvasElement | null>(null);
  const flatBase = useRef<HTMLCanvasElement | null>(null);
  const flatReveal = useRef<HTMLCanvasElement | null>(null);
  /** Restarts the render loop after it has parked itself. Set by the GL effect. */
  const kick = useRef<(() => void) | null>(null);
  const [size, setSize] = useState({ w: 0, h: height });
  const [mode, setMode] = useState<"gl" | "flat" | null>(null);
  /** The fallback's crossfade, 0 = sealed. */
  const [fade, setFade] = useState(0);

  // The trail itself. Refs, not state: it changes every frame and nothing
  // outside the render loop reads it.
  const trail = useRef({
    pos: new Float32Array(TRAIL_N * 2),
    age: new Float32Array(TRAIL_N).fill(2),
    head: 0,
    last: [-1, -1] as [number, number],
    speed: 0,
    alive: false,
  });

  const rimKey = rim.join(",");

  const reduced =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  // ----- measure -----------------------------------------------------------

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: height });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [height]);

  // ----- paint the two layers ---------------------------------------------

  const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);

  useEffect(() => {
    if (!size.w) return;
    if (!baseCanvas.current) baseCanvas.current = document.createElement("canvas");
    if (!revealCanvas.current) revealCanvas.current = document.createElement("canvas");
    paintInto(baseCanvas.current, base, size.w, size.h, dpr);
    paintInto(revealCanvas.current, reveal, size.w, size.h, dpr);
    // `signature` is the honest dependency: the painters are new closures on
    // every render, so depending on them would repaint every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, size.w, size.h, dpr]);

  // ----- the GL loop -------------------------------------------------------

  useEffect(() => {
    if (!size.w || reduced) {
      setMode(reduced ? "flat" : null);
      return;
    }
    const canvas = glCanvas.current;
    const baseSrc = baseCanvas.current;
    const revealSrc = revealCanvas.current;
    if (!canvas || !baseSrc || !revealSrc) return;

    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, premultipliedAlpha: false });
    if (!gl) {
      setMode("flat");
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = vs && fs ? gl.createProgram() : null;
    if (!vs || !fs || !program) {
      setMode("flat");
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      setMode("flat");
      return;
    }
    gl.useProgram(program);
    setMode("gl");

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const makeTexture = (source: HTMLCanvasElement, unit: number, name: string) => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.uniform1i(gl.getUniformLocation(program, name), unit);
      return tex;
    };
    const baseTex = makeTexture(baseSrc, 0, "uBase");
    const revealTex = makeTexture(revealSrc, 1, "uReveal");

    const uPos = gl.getUniformLocation(program, "uTrailPos");
    const uAge = gl.getUniformLocation(program, "uTrailAge");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uAspect = gl.getUniformLocation(program, "uAspect");
    const uSpeed = gl.getUniformLocation(program, "uSpeed");
    gl.uniform3f(gl.getUniformLocation(program, "uRim"), rim[0], rim[1], rim[2]);

    canvas.width = Math.max(1, Math.round(size.w * dpr));
    canvas.height = Math.max(1, Math.round(size.h * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1f(uAspect, size.w / Math.max(1, size.h));

    let frame = 0;
    let previous = performance.now();
    let stopped = false;

    const draw = (now: number) => {
      if (stopped) return;
      const dt = Math.min(64, now - previous);
      previous = now;
      const t = trail.current;

      let alive = false;
      for (let i = 0; i < TRAIL_N; i++) {
        if (t.age[i] < 1) {
          t.age[i] = Math.min(1, t.age[i] + dt / HOLD_MS);
          if (t.age[i] < 1) alive = true;
        }
      }
      t.speed = Math.max(0, t.speed - dt / 600);

      gl.uniform2fv(uPos, t.pos);
      gl.uniform1fv(uAge, t.age);
      gl.uniform1f(uTime, now / 1000);
      gl.uniform1f(uSpeed, Math.min(1, t.speed));
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Stop the loop once the plate is sealed again: an idle tab in a studio
      // full of panels should not be holding a GPU awake.
      if (alive) {
        frame = requestAnimationFrame(draw);
      } else {
        t.alive = false;
        frame = 0;
      }
    };

    // One frame now, so the sealed plate is visible before anyone moves.
    draw(performance.now());

    kick.current = () => {
      if (stopped || trail.current.alive) return;
      trail.current.alive = true;
      previous = performance.now();
      frame = requestAnimationFrame(draw);
    };

    return () => {
      stopped = true;
      kick.current = null;
      if (frame) cancelAnimationFrame(frame);
      gl.deleteTexture(baseTex);
      gl.deleteTexture(revealTex);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
    // `rim` is compared by its values (rimKey) rather than by identity: an
    // inline array literal from the caller would otherwise rebuild the whole
    // GL context on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, size.w, size.h, dpr, reduced, rimKey]);

  // The fallback shows the same two layers, so it needs them copied across
  // whenever they are repainted.
  useEffect(() => {
    if (mode !== "flat") return;
    if (flatBase.current && baseCanvas.current) copy(flatBase.current, baseCanvas.current);
    if (flatReveal.current && revealCanvas.current) copy(flatReveal.current, revealCanvas.current);
  }, [mode, signature, size.w, size.h, dpr]);

  // ----- the pointer -------------------------------------------------------

  const onMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const el = host.current;
    if (!el || mode !== "gl") return;
    const box = el.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    const t = trail.current;
    const [lx, ly] = t.last;
    const moved = lx < 0 ? 0 : Math.hypot(x - lx, y - ly);
    if (lx >= 0 && moved < STEP) return;
    t.speed = Math.min(1, t.speed + moved * 4);

    /*
      Fill the gap, rather than dropping a bead where each event landed.

      A pointer that moves fast — or a browser that coalesces its moves, or a
      finger dragging — delivers samples far enough apart that one point per
      event paints a dotted line instead of a stroke. Interpolating along the
      segment makes the trail continuous at any sample rate, which is the whole
      difference between this reading as a path and reading as a row of blobs.
    */
    const steps = Math.max(1, Math.min(8, Math.round(moved / STEP)));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      t.pos[t.head * 2] = lx < 0 ? x : lx + (x - lx) * k;
      t.pos[t.head * 2 + 1] = ly < 0 ? y : ly + (y - ly) * k;
      // A touch of age on the earlier points of the segment, so a filled gap
      // still tapers from head to tail instead of fading as one block.
      t.age[t.head] = (1 - k) * 0.08;
      t.head = (t.head + 1) % TRAIL_N;
    }
    t.last = [x, y];
    kick.current?.();
  }, [mode]);

  const onLeave = useCallback(() => {
    // The trail is left to age out on its own — snapping it shut is the thing
    // that makes a reveal feel cheap.
    trail.current.last = [-1, -1];
  }, []);

  const flat = mode === "flat";

  return (
    <div
      ref={host}
      className={`mc-scan ${flat ? "is-flat" : ""} ${className ?? ""}`}
      style={{ height }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      {flat ? (
        <>
          <canvas className="mc-scan-flat" ref={flatBase} aria-hidden />
          <canvas className="mc-scan-flat is-top" style={{ opacity: fade }} ref={flatReveal} aria-hidden />
          <label className="mc-scan-slider">
            <span className="mc-sr">Reveal {label}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={fade}
              onChange={(e) => setFade(Number(e.target.value))}
            />
          </label>
        </>
      ) : (
        <canvas className="mc-scan-gl" ref={glCanvas} aria-hidden />
      )}
      <span className="mc-sr">{label}</span>
      {children && <div className="mc-scan-over">{children}</div>}
    </div>
  );
}

/** Blit an offscreen layer onto a visible canvas, for the no-WebGL fallback. */
function copy(target: HTMLCanvasElement, source: HTMLCanvasElement) {
  if (target.width !== source.width || target.height !== source.height) {
    target.width = source.width;
    target.height = source.height;
  }
  const ctx = target.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(source, 0, 0);
}
