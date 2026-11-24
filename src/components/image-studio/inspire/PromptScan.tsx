"use client";

// ---------------------------------------------------------------------------
// Prompt Scan: the picture and its prompt, stacked in one shader.
//
//   mode "hero"  the picture rests drawn out of its own prompt words, each
//                glyph lit in the colour underneath it; the pointer's trail
//                scans the real picture through. With no pointer it scans
//                itself on a slow wandering path, so phones see it too.
//   mode "card"  the inverse, mounted on one hovered card at a time: the
//                picture rests, and the trail scans it away to the prompt.
//
// The boundary is the webgl-trail-reveal edge: a few pixels of fbm jitter and
// an RGB split, a thin warm/cool rim — never a blob. The trail is the hub's
// ring buffer (src/lib/viral-studio/trail.ts); the words texture is drawn at
// the canvas's own size so both layers are pixel-aligned by construction.
// Raw WebGL 1: one quad, two textures — no scene graph.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { TRAIL_N, ageTrail, coverTransform, pushPoint, trailUniforms, type TrailPoint } from "@/lib/viral-studio/trail";
import { stillTrail, sweepPoint, wordSize, wordStream } from "@/lib/image-studio/inspire/scan";

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uImg;
uniform sampler2D uWords;
uniform vec2 uScale;
uniform vec2 uOffset;
uniform vec2 uTrail[${TRAIL_N}];
uniform float uAge[${TRAIL_N}];
uniform float uAspect;
uniform float uTime;
uniform float uInvert;
uniform float uRadius;
uniform float uIntro;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; } return v; }
vec3 art(vec2 uv) { return texture2D(uImg, uOffset + clamp(uv, 0.0, 1.0) * uScale).rgb; }
float glyph(vec2 uv) { return texture2D(uWords, clamp(uv, 0.0, 1.0)).a; }

// The picture written in its own words: each glyph glows in the colour under
// it, lifted so the dark parts of the picture still read as text.
vec3 written(vec2 uv) {
  vec3 c = art(uv);
  float g = glyph(uv);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  // Push saturation so the words carry the picture's colours, not grey.
  vec3 sat = clamp(mix(vec3(l), c, 1.75), 0.0, 1.0);
  vec3 lit = sat * 1.12 + 0.025;
  float ink = g * (0.42 + 0.5 * smoothstep(0.02, 0.4, l));
  return mix(vec3(0.006, 0.008, 0.012) + c * 0.05, lit, ink);
}

void main() {
  vec2 uv = vUv;
  float m = 0.0;
  for (int i = 0; i < ${TRAIL_N}; i++) {
    vec2 d = uv - uTrail[i];
    d.x *= uAspect;
    float age = uAge[i];
    float r = mix(uRadius, uRadius * 0.3, age);
    float f = 1.0 - smoothstep(r * 0.55, r, length(d));
    m = max(m, f * (1.0 - age));
  }
  m = clamp(m, 0.0, 1.0);

  float edge = 4.0 * m * (1.0 - m);
  vec2 j = (vec2(fbm(uv * 42.0 + uTime), fbm(uv * 42.0 - uTime)) - 0.5) * 0.012 * edge;
  vec2 split = vec2(0.0035, 0.0) * edge;

  vec3 picture = vec3(art(uv + j + split).r, art(uv + j).g, art(uv + j - split).b);
  vec3 words = written(uv + j);

  vec3 restLayer = mix(words, art(uv), uInvert);
  vec3 scanLayer = mix(picture, words, uInvert);
  vec3 col = mix(restLayer, scanLayer, smoothstep(0.0, 1.0, m));

  // The scanner rim: warm on one side of the noise, cool on the other.
  float side = step(0.5, fbm(uv * 9.0 + uTime * 0.3));
  col += mix(vec3(1.0, 0.56, 0.24), vec3(0.35, 0.8, 1.0), side) * edge * 0.32;
  gl_FragColor = vec4(col * uIntro, 1.0);
}`;

export interface ScanImage {
  src: string;
  width: number;
  height: number;
}

interface Props {
  image: ScanImage;
  prompt: string;
  mode: "hero" | "card";
  /** The element whose pointer paints the trail (defaults to the scan itself). */
  host?: HTMLElement | null;
  /** Hero only: scan itself when nobody is pointing. */
  auto?: boolean;
  /** No WebGL, or the context was lost: the parent shows its CSS version. */
  onFallback?: () => void;
  /** First frame drawn. */
  onReady?: () => void;
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s;
  console.warn("[inspire] prompt-scan shader didn't compile:", gl.getShaderInfoLog(s));
  return null;
}

/** The interface's monospace face, resolved from the next/font variable. */
function monoFamily(el: HTMLElement): string {
  const v = getComputedStyle(el).getPropertyValue("--font-insp-mono").trim();
  return v || "ui-monospace, monospace";
}

/** Paint the prompt as a tiled block of glyphs on a 2D canvas the size of the stage. */
function paintWords(ctx: CanvasRenderingContext2D, w: number, h: number, stream: string, sizePx: number, family: string) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "top";
  ctx.font = `600 ${sizePx}px ${family}`;
  const cw = Math.max(1, ctx.measureText("M").width + sizePx * 0.02);
  const lh = sizePx * 1.12;
  const cols = Math.max(1, Math.floor(w / cw));
  const rows = Math.ceil(h / lh) + 1;
  let at = 0;
  for (let r = 0; r < rows; r++) {
    // Each line steps a little further into the stream so columns never align.
    const line = stream.slice(at % stream.length, (at % stream.length) + cols);
    ctx.fillText(line.length < cols ? line + stream.slice(0, cols - line.length) : line, 0, r * lh);
    at += cols + 7;
  }
}

export function PromptScan({ image, prompt, mode, host, auto = mode === "hero", onFallback, onReady }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cb = useRef({ onFallback, onReady });
  cb.current = { onFallback, onReady };

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const target = host ?? box;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    box.appendChild(canvas);
    const ctx = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!ctx) {
      canvas.remove();
      cb.current.onFallback?.();
      return;
    }
    const gl: WebGLRenderingContext = ctx;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) {
      canvas.remove();
      cb.current.onFallback?.();
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      canvas.remove();
      cb.current.onFallback?.();
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const makeTex = (unit: number) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    };
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const texImg = makeTex(0);
    const texWords = makeTex(1);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    gl.uniform1i(u("uImg"), 0);
    gl.uniform1i(u("uWords"), 1);
    const uScale = u("uScale");
    const uOffset = u("uOffset");
    const uTrail = u("uTrail");
    const uAge = u("uAge");
    const uAspect = u("uAspect");
    const uTime = u("uTime");
    const uRadius = u("uRadius");
    const uIntro = u("uIntro");
    gl.uniform1f(u("uInvert"), mode === "card" ? 1 : 0);
    gl.uniform1f(uRadius, mode === "card" ? 0.17 : 0.12);

    let dead = false;
    let imgReady = false;
    let wordsReady = false;
    let trail: TrailPoint[] = reduced && mode === "hero" ? stillTrail() : [];
    let lastPointer = -1e9;
    let visible = true;
    const start = performance.now();
    let last = start;
    let introAt = 0;

    const stream = wordStream(prompt, mode === "card" ? 2500 : 9000);
    const words = document.createElement("canvas");
    const wctx = words.getContext("2d");
    const family = monoFamily(box);

    const drawWords = async () => {
      if (!wctx || dead) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = wordSize(canvas.clientWidth, mode) * dpr;
      try {
        await Promise.race([document.fonts.load(`600 ${size}px ${family}`), new Promise((r) => setTimeout(r, 1200))]);
      } catch {
        /* the fallback mono still draws */
      }
      if (dead) return;
      words.width = Math.max(1, canvas.width);
      words.height = Math.max(1, canvas.height);
      paintWords(wctx, words.width, words.height, stream, size, family);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texWords);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, words);
      wordsReady = true;
      if (reduced) draw(performance.now());
    };

    let wordsTimer = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      window.clearTimeout(wordsTimer);
      wordsTimer = window.setTimeout(() => void drawWords(), wordsReady ? 160 : 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const pic = new Image();
    pic.decoding = "async";
    pic.onload = () => {
      if (dead) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texImg);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pic);
        imgReady = true;
        introAt = performance.now();
        if (reduced) draw(performance.now());
      } catch {
        cb.current.onFallback?.();
      }
    };
    pic.onerror = () => cb.current.onFallback?.();
    pic.src = image.src;

    const toUv = (e: PointerEvent): [number, number] | null => {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const x = (e.clientX - r.left) / r.width;
      const y = 1 - (e.clientY - r.top) / r.height;
      if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) return null;
      return [x, y];
    };
    const onMove = (e: PointerEvent) => {
      if (reduced) return;
      const p = toUv(e);
      if (!p) return;
      trail = pushPoint(trail, p[0], p[1]);
      lastPointer = performance.now();
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerdown", onMove);

    let drewOnce = false;
    function draw(now: number) {
      if (dead || !imgReady || !wordsReady) return;
      const { scale, offset } = coverTransform(pic.naturalWidth, pic.naturalHeight, canvas.width, canvas.height);
      const { pos, age } = trailUniforms(trail);
      // The hero fades its first frame in; a card must never flash dark over its own picture.
      const intro = reduced || mode === "card" ? 1 : Math.min(1, (now - introAt) / 700);
      gl.uniform2f(uScale, scale[0], scale[1]);
      gl.uniform2f(uOffset, offset[0], offset[1]);
      gl.uniform2fv(uTrail, pos);
      gl.uniform1fv(uAge, age);
      gl.uniform1f(uAspect, canvas.width / canvas.height);
      gl.uniform1f(uTime, ((now - start) / 1000) * 0.6);
      gl.uniform1f(uIntro, 1 - Math.pow(1 - intro, 3));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!drewOnce) {
        drewOnce = true;
        canvas.dataset.ready = "1";
        cb.current.onReady?.();
      }
    }

    let raf = 0;
    const frame = (now: number) => {
      if (dead) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (auto && now - lastPointer > 1600) {
        const [x, y] = sweepPoint((now - start) / 1000);
        trail = pushPoint(trail, x, y, 0.004);
      }
      trail = ageTrail(trail, dt, mode === "card" ? 0.7 : 0.95);
      draw(now);
      raf = visible ? requestAnimationFrame(frame) : 0;
    };

    // Run only while on screen: an off-screen hero costs nothing.
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && document.visibilityState === "visible";
      if (visible && !raf && !reduced) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    });
    io.observe(box);
    const onVis = () => {
      visible = document.visibilityState === "visible";
      if (visible && !raf && !reduced) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    const onLost = (e: Event) => {
      e.preventDefault();
      dead = true;
      cb.current.onFallback?.();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    if (!reduced) raf = requestAnimationFrame(frame);

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(wordsTimer);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerdown", onMove);
      canvas.removeEventListener("webglcontextlost", onLost);
      gl.deleteTexture(texImg);
      gl.deleteTexture(texWords);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, [image.src, prompt, mode, host, auto]);

  return <div ref={boxRef} aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden" }} />;
}

/**
 * The same idea without WebGL: the prompt words clipped to the picture, with
 * a still scan band showing the real image through. Used when WebGL is off.
 */
export function PromptScanStill({ image, prompt }: { image: ScanImage; prompt: string }) {
  const stream = wordStream(prompt, 7000);
  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#020305" }}>
      <div
        className="insp-mono"
        style={{
          position: "absolute",
          inset: -4,
          font: "600 12.5px/1.12 var(--font-insp-mono), monospace",
          wordBreak: "break-all",
          color: "transparent",
          background: `url(${image.src}) center/cover`,
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          filter: "saturate(1.4) brightness(1.4)",
        }}
      >
        {stream}
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `url(${image.src}) center/cover`,
          WebkitMaskImage: "radial-gradient(ellipse 34% 30% at 58% 48%, #000 55%, transparent 100%)",
          maskImage: "radial-gradient(ellipse 34% 30% at 58% 48%, #000 55%, transparent 100%)",
        }}
      />
    </div>
  );
}
