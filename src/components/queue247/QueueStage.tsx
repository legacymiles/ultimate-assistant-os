"use client";

// ---------------------------------------------------------------------------
// The stage — the top of the 24/7 Queue (webgl-trail-reveal + taste-skill,
// mockup 3 "Chat is the stage", picked 2026-11-25).
//
// Two perfectly aligned layers, both drawn by one shader so they can never
// drift: calm smoked glass on top, the emerald circuitry the agents run on
// underneath. The pointer (or a finger) paints a trail WITH MEMORY that scans
// the circuitry in, with a thin chromatic-split edge, and the trail eases
// closed a moment after the pointer stops. The labels — the real workers and
// the 24/7 workflows — are revealed by the same trail (the CPU runs the same
// mask maths for each label), and every new event in the queue sends a pulse
// out of the node it came from. So the stage is quiet until something happens.
//
// Raw WebGL 1, one quad. It draws only while something moves; an idle stage
// costs nothing. Reduced motion or no WebGL: a still CSS picture of the same
// two layers, labels visible.
// ---------------------------------------------------------------------------

import { useEffect, useRef, type ReactNode } from "react";
import { TRAIL_N, ageTrail, pushPoint, trailUniforms, type TrailPoint } from "@/lib/viral-studio/trail";

export interface StageNode {
  id: string;
  label: string;
  /** uv, 0..1 from the left / from the BOTTOM (the shader's frame). */
  x: number;
  y: number;
  live?: boolean;
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec2 uTrail[${TRAIL_N}];
uniform float uAge[${TRAIL_N}];
uniform float uAspect;
uniform float uTime;
uniform vec3 uPulse; // x, y, age (>= 1 off)

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}

const vec3 ACCENT = vec3(0.239, 0.863, 0.592);

// Calm: smoked glass, a cool sheen from the top right, a faint green warmth
// low on the left, a fine grain so the dark never bands.
vec3 calm(vec2 uv) {
  vec2 p = uv * vec2(uAspect, 1.0);
  vec3 col = mix(vec3(0.043, 0.051, 0.063), vec3(0.071, 0.082, 0.098), uv.y);
  col += vec3(0.10, 0.11, 0.13) * 0.55 * smoothstep(0.9, 0.0, length(uv - vec2(0.92, 1.08)));
  col += vec3(0.05, 0.11, 0.08) * 0.6 * smoothstep(0.8, 0.0, length(uv - vec2(0.1, -0.1)));
  float grain = noise(p * 520.0) * 0.5 + noise(p * 210.0) * 0.5;
  return col * (0.95 + grain * 0.08);
}

// Hidden: the board the agents run on — traces, vias, light running along them.
vec3 circuit(vec2 uv) {
  vec2 p = uv * vec2(uAspect, 1.0) * 13.0;
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float h = hash(cell);
  float line = 0.0;
  if (h < 0.3) line = 1.0 - smoothstep(0.05, 0.1, abs(f.y - 0.5));
  else if (h < 0.55) line = 1.0 - smoothstep(0.05, 0.1, abs(f.x - 0.5));
  else if (h < 0.68) line = 1.0 - smoothstep(0.06, 0.11, abs(f.x - f.y));
  float via = (1.0 - smoothstep(0.1, 0.16, length(f - 0.5))) * step(0.8, hash(cell + 7.3));
  float grid = (1.0 - smoothstep(0.0, 0.035, min(f.x, f.y))) * 0.3;
  float flow = 0.4 + 0.6 * smoothstep(0.6, 1.0, sin(uTime * 2.6 - (cell.x * 0.7 + cell.y * 0.45)));
  vec3 base = mix(vec3(0.02, 0.09, 0.07), vec3(0.03, 0.16, 0.11), uv.x);
  return base + ACCENT * (line * (0.45 + flow) * 0.85 + via * 1.4 + grid * 0.8);
}

void main() {
  vec2 uv = vUv;
  float m = 0.0;
  for (int i = 0; i < ${TRAIL_N}; i++) {
    vec2 d = uv - uTrail[i];
    d.x *= uAspect;
    float age = uAge[i];
    float r = mix(0.16, 0.05, age);
    float f = 1.0 - smoothstep(r * 0.5, r, length(d));
    m = max(m, f * (1.0 - age));
  }
  if (uPulse.z < 1.0) {
    vec2 pd = uv - uPulse.xy;
    pd.x *= uAspect;
    float ring = 1.0 - smoothstep(0.0, 0.06, abs(length(pd) - uPulse.z * 0.9));
    m = max(m, ring * (1.0 - uPulse.z));
  }
  m = clamp(m, 0.0, 1.0);

  float edge = 4.0 * m * (1.0 - m);
  vec2 j = (vec2(fbm(uv * 40.0 + uTime), fbm(uv * 40.0 - uTime)) - 0.5) * 0.006 * edge;
  vec2 split = vec2(0.0035, 0.0) * edge;
  vec3 hidden = vec3(circuit(uv + j + split).r, circuit(uv + j).g, circuit(uv + j - split).b);
  vec3 col = mix(calm(uv), hidden, smoothstep(0.0, 1.0, m));
  col += ACCENT * edge * 0.22;
  gl_FragColor = vec4(col, 1.0);
}`;

const HOLD_S = 0.8;
const PULSE_S = 1.4;

/** The trail's strength at one point — the same formula the shader runs, for the labels. */
function maskAt(trail: TrailPoint[], x: number, y: number, aspect: number): number {
  let m = 0;
  for (const p of trail) {
    const dx = (x - p.x) * aspect;
    const dy = y - p.y;
    const r = 0.16 + (0.05 - 0.16) * p.age;
    const d = Math.hypot(dx, dy);
    const t = Math.min(1, Math.max(0, (d - r * 0.5) / (r * 0.5)));
    const f = 1 - t * t * (3 - 2 * t);
    m = Math.max(m, f * (1 - p.age));
  }
  return m;
}

export function QueueStage({
  nodes,
  pulseKey,
  pulseFrom,
  children,
}: {
  nodes: StageNode[];
  /** Changes whenever a new event lands; each change sends one pulse. */
  pulseKey: string;
  /** Which node the pulse leaves from (falls back to the first). */
  pulseFrom?: string | null;
  children: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef(new Map<string, HTMLSpanElement>());
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const pulseRef = useRef<{ x: number; y: number; t0: number } | null>(null);
  const kick = useRef<() => void>(() => {});
  const live = useRef(false);
  const firstPulse = useRef(true);

  // A new event → a pulse from its node. The first value is the page loading, not news.
  useEffect(() => {
    if (firstPulse.current) {
      firstPulse.current = false;
      return;
    }
    const n = nodesRef.current.find((x) => x.id === pulseFrom) ?? nodesRef.current[0];
    if (!n) return;
    pulseRef.current = { x: n.x, y: n.y, t0: performance.now() };
    kick.current();
  }, [pulseKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = document.createElement("canvas");
    canvas.className = "qs-canvas";
    canvas.setAttribute("aria-hidden", "true");
    box.prepend(canvas);
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false });
    if (!gl) {
      canvas.remove();
      return;
    }
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn("[24/7 Queue] stage shader:", gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) {
      canvas.remove();
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      canvas.remove();
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uTrail = u("uTrail"),
      uAge = u("uAge"),
      uAspect = u("uAspect"),
      uTime = u("uTime"),
      uPulse = u("uPulse");

    live.current = true;
    box.dataset.gl = "on";
    let trail: TrailPoint[] = [];
    let raf = 0;
    let last = performance.now();
    const start = last;
    let w = 1,
      h = 1;
    let intro = true;

    const paintLabels = () => {
      const aspect = w / h;
      const p = pulseRef.current;
      const pAge = p ? (performance.now() - p.t0) / 1000 / PULSE_S : 1;
      for (const n of nodesRef.current) {
        const el = labelRefs.current.get(n.id);
        if (!el) continue;
        let m = maskAt(trail, n.x, n.y, aspect);
        if (p && pAge < 1) {
          const d = Math.hypot((n.x - p.x) * aspect, n.y - p.y);
          m = Math.max(m, (1 - Math.min(1, Math.abs(d - pAge * 0.9) / 0.08)) * (1 - pAge));
        }
        el.style.opacity = String(0.14 + 0.86 * Math.min(1, m * 1.4));
      }
    };

    const draw = (now: number) => {
      const { pos, age } = trailUniforms(trail);
      gl.uniform2fv(uTrail, pos);
      gl.uniform1fv(uAge, age);
      gl.uniform1f(uAspect, w / h);
      gl.uniform1f(uTime, (now - start) / 1000);
      const p = pulseRef.current;
      const pAge = p ? (now - p.t0) / 1000 / PULSE_S : 1;
      gl.uniform3f(uPulse, p?.x ?? 0, p?.y ?? 0, Math.min(1, pAge));
      if (p && pAge >= 1) pulseRef.current = null;
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      paintLabels();
    };

    const resize = () => {
      const r = box.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = Math.max(1, Math.round(r.width * dpr));
      h = Math.max(1, Math.round(r.height * dpr));
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      draw(performance.now());
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      trail = ageTrail(trail, dt, HOLD_S);
      draw(now);
      raf = trail.length || pulseRef.current || intro ? requestAnimationFrame(frame) : 0;
    };
    const wake = () => {
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    kick.current = wake;

    const add = (x: number, y: number) => {
      const lastP = trail[trail.length - 1];
      if (lastP && lastP.age < 0.3) {
        const d = Math.hypot(x - lastP.x, y - lastP.y);
        const steps = Math.min(8, Math.floor(d / 0.018));
        for (let k = 1; k < steps; k++) trail = pushPoint(trail, lastP.x + ((x - lastP.x) * k) / steps, lastP.y + ((y - lastP.y) * k) / steps, 0.004);
      }
      trail = pushPoint(trail, x, y, 0.004);
      wake();
    };

    // The stage's content sits on top of the canvas, so the box listens — and
    // measures against the box, which is exactly the canvas.
    const onMove = (e: PointerEvent) => {
      const r = box.getBoundingClientRect();
      add((e.clientX - r.left) / Math.max(1, r.width), 1 - (e.clientY - r.top) / Math.max(1, r.height));
    };

    // One slow sweep on arrival, through the nodes, so the effect teaches
    // itself — then nothing moves until you do.
    const sweepStart = performance.now() + 450;
    const sweep = () => {
      const t = (performance.now() - sweepStart) / 1500;
      if (t < 0) return requestAnimationFrame(sweep);
      if (t > 1) {
        intro = false;
        return;
      }
      const e = 1 - Math.pow(1 - t, 3);
      add(0.42 + e * 0.52, 0.72 - Math.sin(e * Math.PI) * 0.22 - e * 0.12);
      requestAnimationFrame(sweep);
    };
    requestAnimationFrame(sweep);

    const ro = new ResizeObserver(resize);
    ro.observe(box);
    box.addEventListener("pointermove", onMove, { passive: true });
    resize();

    return () => {
      intro = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      box.removeEventListener("pointermove", onMove);
      kick.current = () => {};
      live.current = false;
      delete box.dataset.gl;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, []);

  return (
    <section ref={boxRef} className="qs-stage" data-standout aria-label="Talk to Jarvis">
      <div className="qs-still" aria-hidden />
      <div className="qs-nodes" aria-hidden>
        {nodes.map((n) => (
          <span
            key={n.id}
            ref={(el) => {
              if (el) labelRefs.current.set(n.id, el);
              else labelRefs.current.delete(n.id);
            }}
            className="qs-node"
            data-live={n.live ? "true" : undefined}
            style={{ left: `${(n.x * 100).toFixed(1)}%`, bottom: `${(n.y * 100).toFixed(1)}%` }}
          >
            {n.label}
          </span>
        ))}
      </div>
      <div className="qs-content">{children}</div>
    </section>
  );
}

/**
 * Where each label sits: the worker first (the hub of the board), then the
 * 24/7 workflows fanned out to its right, all in the stage's upper right so
 * the headline (upper left) and the composer (bottom) stay clear.
 */
export function placeNodes(items: { id: string; label: string; live?: boolean }[]): StageNode[] {
  const slots: [number, number][] = [
    [0.6, 0.8],
    [0.73, 0.88],
    [0.84, 0.76],
    [0.69, 0.66],
    [0.88, 0.58],
    [0.56, 0.6],
  ];
  return items.slice(0, slots.length).map((it, i) => ({ ...it, x: slots[i][0], y: slots[i][1] }));
}
