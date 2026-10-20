"use client";

// ---------------------------------------------------------------------------
// The table surface (webgl-trail-reveal).
//
// Two perfectly aligned layers, both drawn by the shader so they can never
// drift apart: calm dark felt on top, glowing circuitry underneath. The
// pointer (or a finger) paints a trail with memory that scans the circuitry
// in, with a thin chromatic-split edge, and the trail eases closed a moment
// after the pointer stops. When a trick is won the table pulses: a ring of
// circuitry sweeps out from the winner's side.
//
// Raw WebGL 1: one quad, one shader. It only draws while something is
// moving, so an idle table costs nothing. No WebGL or reduced motion: the
// CSS felt underneath is the table.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { TRAIL_N, ageTrail, pushPoint, trailUniforms, type TrailPoint } from "@/lib/viral-studio/trail";

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
uniform vec3 uAccent;
uniform vec3 uFeltIn;
uniform vec3 uFeltOut;
uniform vec3 uPulse; // x, y, age (0..1, >=1 off)
uniform float uHint; // a faint always-on trace of the board, 0..1

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

// The felt: a radial fall-off from centre to rim with a fine woven grain.
vec3 felt(vec2 uv) {
  vec2 c = (uv - 0.5) * vec2(uAspect, 1.0);
  float r = length(c) / (0.5 * max(uAspect, 1.0));
  vec3 col = mix(uFeltIn, uFeltOut, smoothstep(0.0, 1.05, r));
  float grain = noise(uv * vec2(uAspect, 1.0) * 420.0) * 0.5 + noise(uv * vec2(uAspect, 1.0) * 180.0) * 0.5;
  // A low pool of accent light in the middle, where the cards land.
  col += uAccent * 0.07 * (1.0 - smoothstep(0.0, 0.62, r));
  return col * (0.94 + grain * 0.1);
}

// The circuitry: a board of traces, vias and a soft accent bloom.
vec3 circuit(vec2 uv) {
  vec2 p = uv * vec2(uAspect, 1.0) * 14.0;
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float h = hash(cell);
  // Each cell carries a horizontal, vertical or diagonal trace, or nothing.
  float line = 0.0;
  if (h < 0.3) line = 1.0 - smoothstep(0.06, 0.11, abs(f.y - 0.5));
  else if (h < 0.55) line = 1.0 - smoothstep(0.06, 0.11, abs(f.x - 0.5));
  else if (h < 0.7) line = 1.0 - smoothstep(0.07, 0.12, abs(f.x - f.y));
  float via = 1.0 - smoothstep(0.12, 0.18, length(f - 0.5));
  via *= step(0.78, hash(cell + 7.3));
  float grid = (1.0 - smoothstep(0.0, 0.04, min(f.x, f.y))) * 0.35;
  // Light runs along the traces.
  float flow = 0.45 + 0.55 * smoothstep(0.6, 1.0, sin(uTime * 3.0 - (cell.x * 0.7 + cell.y * 0.45)));
  vec3 base = felt(uv) * 0.35;
  vec3 glow = uAccent * (line * (0.55 + flow) + via * 1.6 + grid);
  return base + glow;
}

void main() {
  vec2 uv = vUv;

  float m = 0.0;
  for (int i = 0; i < ${TRAIL_N}; i++) {
    vec2 d = uv - uTrail[i];
    d.x *= uAspect;
    float age = uAge[i];
    float r = mix(0.13, 0.04, age);
    float f = 1.0 - smoothstep(r * 0.55, r, length(d));
    m = max(m, f * (1.0 - age));
  }

  // The trick pulse: a ring of circuitry sweeping out from the winner.
  if (uPulse.z < 1.0) {
    vec2 pd = uv - uPulse.xy;
    pd.x *= uAspect;
    float rr = uPulse.z * 0.95;
    float ring = 1.0 - smoothstep(0.0, 0.07, abs(length(pd) - rr));
    m = max(m, ring * (1.0 - uPulse.z));
  }
  m = clamp(m, 0.0, 1.0);

  float edge = 4.0 * m * (1.0 - m);
  vec2 j = (vec2(fbm(uv * 40.0 + uTime), fbm(uv * 40.0 - uTime)) - 0.5) * 0.006 * edge;
  vec2 split = vec2(0.0035, 0.0) * edge;

  vec3 calm = felt(uv);
  vec3 hidden = vec3(circuit(uv + j + split).r, circuit(uv + j).g, circuit(uv + j - split).b);
  vec3 col = mix(calm, hidden, smoothstep(0.0, 1.0, max(m, uHint)));
  col += uAccent * edge * 0.28;
  gl_FragColor = vec4(col, 1.0);
}`;

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [0.3, 0.85, 0.72];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export interface FeltPulse {
  id: number;
  /** uv, 0..1, y up. */
  x: number;
  y: number;
}

interface Props {
  accent: string;
  felt: [string, string];
  pulse: FeltPulse | null;
  /** Off: the CSS felt only (effects off, or reduced motion). */
  enabled: boolean;
}

const HOLD_S = 0.8;
const PULSE_S = 1.1;

export function HoloFelt({ accent, felt, pulse, enabled }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const look = useRef({ accent, felt });
  look.current = { accent, felt };
  const pulseRef = useRef<{ x: number; y: number; t0: number } | null>(null);
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    if (!pulse) return;
    pulseRef.current = { x: pulse.x, y: pulse.y, t0: performance.now() };
    kick.current();
  }, [pulse?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !enabled) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = document.createElement("canvas");
    canvas.className = "hx-felt-canvas";
    box.appendChild(canvas);
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false });
    if (!gl) { canvas.remove(); return; }

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn("[spades] felt shader:", gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) { canvas.remove(); return; }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); return; }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uTrail = u("uTrail"), uAge = u("uAge"), uAspect = u("uAspect"), uTime = u("uTime");
    const uAccent = u("uAccent"), uFeltIn = u("uFeltIn"), uFeltOut = u("uFeltOut"), uPulse = u("uPulse");
    const uHint = u("uHint");

    let trail: TrailPoint[] = [];
    let raf = 0;
    let last = performance.now();
    const start = last;
    let w = 1, h = 1;

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

    const draw = (now: number) => {
      const { pos, age } = trailUniforms(trail);
      gl.uniform2fv(uTrail, pos);
      gl.uniform1fv(uAge, age);
      gl.uniform1f(uAspect, w / h);
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.uniform3fv(uAccent, hexToRgb(look.current.accent));
      gl.uniform3fv(uFeltIn, hexToRgb(look.current.felt[0]));
      gl.uniform3fv(uFeltOut, hexToRgb(look.current.felt[1]));
      gl.uniform1f(uHint, 0.11);
      const p = pulseRef.current;
      const pAge = p ? (now - p.t0) / 1000 / PULSE_S : 1;
      gl.uniform3f(uPulse, p?.x ?? 0, p?.y ?? 0, Math.min(1, pAge));
      if (p && pAge >= 1) pulseRef.current = null;
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      trail = ageTrail(trail, dt, HOLD_S);
      draw(now);
      raf = trail.length || pulseRef.current ? requestAnimationFrame(frame) : 0;
    };
    const wake = () => {
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    };
    kick.current = wake;

    // The felt is tilted in 3D, so the screen rectangle is the wrong frame:
    // offsetX/Y are measured in the felt's own, untilted space, which is
    // exactly the shader's uv. Fast moves are filled in so the trail reads
    // as one continuous scan, not a string of dots.
    const onMove = (e: PointerEvent) => {
      if (e.target !== canvas) return;
      const x = e.offsetX / Math.max(1, canvas.clientWidth);
      const y = 1 - e.offsetY / Math.max(1, canvas.clientHeight);
      const lastP = trail[trail.length - 1];
      if (lastP && lastP.age < 0.3) {
        const d = Math.hypot(x - lastP.x, y - lastP.y);
        const steps = Math.min(8, Math.floor(d / 0.018));
        for (let k = 1; k < steps; k++) {
          trail = pushPoint(trail, lastP.x + ((x - lastP.x) * k) / steps, lastP.y + ((y - lastP.y) * k) / steps, 0.004);
        }
      }
      trail = pushPoint(trail, x, y, 0.004);
      wake();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(box);
    box.addEventListener("pointermove", onMove, { passive: true });
    resize();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      box.removeEventListener("pointermove", onMove);
      kick.current = () => {};
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, [enabled]);

  return (
    <div
      ref={boxRef}
      className="hx-felt"
      style={{ background: `radial-gradient(ellipse at 50% 45%, ${felt[0]} 0%, ${felt[1]} 78%)` }}
      aria-hidden="true"
    />
  );
}
