"use client";

// ---------------------------------------------------------------------------
// FingerprintField — the toy.
//
// One full-screen WebGL quad. Raw WebGL rather than R3F: this sits behind a
// form, so it has to be the cheapest possible thing that still feels alive —
// no scene graph, no reconciler, one program, one draw call per frame.
//
// It is seeded by the URL you are typing (see lib/redesigner/fingerprint.ts),
// takes keystroke impulses and click shockwaves, and changes phase while the
// request is in flight. No WebGL, or prefers-reduced-motion, and the caller
// renders a static ember gradient instead — the content never depends on it.
// ---------------------------------------------------------------------------

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type FieldPhase = "idle" | "forge" | "done";

export interface FieldHandle {
  /** Keystroke energy — brightens the filaments, decays in ~1s. */
  pulse: (strength?: number) => void;
  /** Shockwave from a point in viewport pixels. */
  ripple: (clientX: number, clientY: number) => void;
}

export interface FingerprintFieldProps {
  /** 0..100, from `fingerprint(url).seed`. 0 = the resting field. */
  seed: number;
  turbulence: number;
  phase: FieldPhase;
  /** Up to 3 [r,g,b] (0..1) cells that bleed in once results land. */
  cells: Array<[number, number, number]>;
}

const RIPPLES = 4;
const RIPPLE_LIFE = 2.6; // seconds

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform float uSeed;       // 0..100 domain offset
uniform float uTurb;       // 0..1 warp strength from the URL
uniform float uCharge;     // 0..1 keystroke energy
uniform float uForge;      // 0..1 request in flight
uniform float uDone;       // 0..1 results on screen
uniform float uIdleAmt;    // 0..1 nobody has touched it for a while
uniform vec2  uMouse;      // 0..1
uniform vec3  uRip[${RIPPLES}];   // x, y (0..1), age in seconds; age < 0 = free
uniform vec3  uCellCol[3];
uniform vec2  uCellPos[3];

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// 4 octaves is the whole budget — everything else is derived from these.
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}

// 2 octaves for the warp field, which nobody can see the detail of anyway.
float fbm2(vec2 p) {
  return 0.5 * noise(p) + 0.25 * noise(p * 2.03);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / max(uRes.y, 1.0);
  vec2 p = vec2(uv.x * asp, uv.y);

  // Breathing: the field never sits still, and relaxes when left alone.
  float breathe = 1.0 + 0.10 * sin(uTime * 0.45) * (0.35 + 0.65 * uIdleAmt);
  float flow = uTime * (0.040 + 0.115 * uForge) * breathe;

  // Shockwaves displace the noise domain, so a click really deforms the
  // material rather than drawing a ring on top of it.
  float wave = 0.0;
  for (int i = 0; i < ${RIPPLES}; i++) {
    float age = uRip[i].z;
    if (age >= 0.0) {
      vec2 rp = vec2(uRip[i].x * asp, uRip[i].y);
      float d = distance(p, rp);
      wave += sin((d - age * 0.8) * 34.0) * exp(-d * 3.0) * exp(-age * 2.2);
    }
  }

  // The URL's fingerprint: where in the noise we are, and how hard it folds.
  vec2 q = p * (1.9 + 1.1 * fract(uSeed * 0.37)) + vec2(uSeed * 1.7, uSeed * 0.93);
  q += wave * 0.22;

  vec2 warp = vec2(fbm2(q + flow), fbm2(q.yx - flow * 1.15));
  float n = fbm(q + warp * (0.9 + 1.3 * uTurb + 0.7 * uForge) + uMouse * 0.3);

  // Molten filaments along the ridges of the noise. Offsetting the ridge per
  // channel gives real chromatic aberration on the edges for free.
  float k = 10.0 - 3.5 * uForge;
  float split = 0.05 * uForge;
  float e = n * 2.0 - 1.0;
  float gR = pow(max(1.0 - abs(e + split), 0.0), k);
  float gG = pow(max(1.0 - abs(e), 0.0), k);
  float gB = pow(max(1.0 - abs(e - split), 0.0), k);

  const vec3 SIG = vec3(1.0, 0.302, 0.180);

  vec3 col = vec3(0.0196);
  // ember body
  col += SIG * 0.115 * smoothstep(0.52, 1.05, n) * (0.5 + 0.45 * uCharge + 0.6 * uForge);
  // filaments
  float gain = 0.17 + 0.85 * uCharge + 0.55 * uForge;
  col += vec3(gR, gG * 0.62, gB * 0.42) * SIG.r * gain;
  col.g += gG * 0.11 * gain;

  // Ring highlight on top of the displacement, so the shockwave reads.
  col += SIG * max(wave, 0.0) * 0.22;

  // A slow scan sweep while the field is resting — the cheapest surprise.
  float sweepY = fract(uTime * 0.055) * 1.35 - 0.18;
  col += vec3(0.55, 0.55, 0.58) * exp(-pow((uv.y - sweepY) * 26.0, 2.0)) * 0.05 * uIdleAmt;

  // Scanlines while forging.
  col *= 1.0 - 0.13 * uForge * step(0.5, fract(gl_FragCoord.y * 0.22 - uTime * 2.4));

  // The three direction palettes bleed in once the answer is on screen.
  for (int i = 0; i < 3; i++) {
    vec2 cp = vec2(uCellPos[i].x * asp, uCellPos[i].y);
    float d = distance(p, cp);
    col += uCellCol[i] * exp(-d * d * 6.5) * 0.38 * uDone;
  }

  // Pointer warmth.
  col += SIG * 0.055 * exp(-distance(p, vec2(uMouse.x * asp, uMouse.y)) * 4.5);

  // Grain, then a heavy vignette so the type always has somewhere to sit.
  col += (hash(gl_FragCoord.xy + fract(uTime) * 97.0) - 0.5) * 0.022;
  col *= 1.0 - 0.72 * pow(min(length(uv - 0.5) * 1.25, 1.0), 1.9);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error("[FingerprintField]", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export const FingerprintField = forwardRef<FieldHandle, FingerprintFieldProps>(
  function FingerprintField({ seed, turbulence, phase, cells }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Everything the render loop reads lives in refs: the loop must never be a
    // reason to re-render React, and uniforms must not restart the animation.
    const target = useRef({ seed, turbulence, phase, cells });
    target.current = { seed, turbulence, phase, cells };

    const api = useRef({
      charge: 0,
      lastTouch: 0,
      ripples: new Float32Array(RIPPLES * 3).fill(-1),
      slot: 0,
      mouse: { x: 0.5, y: 0.55, tx: 0.5, ty: 0.55 },
    });

    useImperativeHandle(ref, () => ({
      pulse(strength = 0.5) {
        const a = api.current;
        a.charge = Math.min(1, a.charge + strength);
        a.lastTouch = performance.now();
      },
      ripple(clientX, clientY) {
        const a = api.current;
        const i = a.slot % RIPPLES;
        a.slot++;
        a.ripples[i * 3] = clientX / Math.max(window.innerWidth, 1);
        // GL's y is bottom-up; the DOM's is top-down.
        a.ripples[i * 3 + 1] = 1 - clientY / Math.max(window.innerHeight, 1);
        a.ripples[i * 3 + 2] = 0;
        a.lastTouch = performance.now();
      },
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const gl =
        (canvas.getContext("webgl", {
          antialias: false,
          alpha: false,
          depth: false,
          stencil: false,
          powerPreference: "low-power",
        }) as WebGLRenderingContext | null) ??
        (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
      if (!gl) return;

      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return;

      const prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error("[FingerprintField]", gl.getProgramInfoLog(prog));
        return;
      }
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]), // one oversized triangle
        gl.STATIC_DRAW,
      );
      const aPos = gl.getAttribLocation(prog, "aPos");
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      const u = (name: string) => gl.getUniformLocation(prog, name);
      const L = {
        res: u("uRes"),
        time: u("uTime"),
        seed: u("uSeed"),
        turb: u("uTurb"),
        charge: u("uCharge"),
        forge: u("uForge"),
        done: u("uDone"),
        idle: u("uIdleAmt"),
        mouse: u("uMouse"),
        rip: u("uRip"),
        cellCol: u("uCellCol"),
        cellPos: u("uCellPos"),
      };

      // Cells sit at fixed points that roughly track the three result cards.
      gl.uniform2fv(L.cellPos, new Float32Array([0.2, 0.3, 0.5, 0.22, 0.8, 0.14]));

      let dead = false;
      const dpr = () => Math.min(window.devicePixelRatio || 1, 1.5);

      function resize() {
        const c = canvasRef.current;
        if (!c) return;
        const w = Math.max(1, Math.round(c.clientWidth * dpr()));
        const h = Math.max(1, Math.round(c.clientHeight * dpr()));
        if (c.width === w && c.height === h) return;
        c.width = w;
        c.height = h;
        gl!.viewport(0, 0, w, h);
        gl!.uniform2f(L.res, w, h);
      }
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(canvas);

      function onMove(e: PointerEvent) {
        const a = api.current;
        a.mouse.tx = e.clientX / Math.max(window.innerWidth, 1);
        a.mouse.ty = 1 - e.clientY / Math.max(window.innerHeight, 1);
        a.lastTouch = performance.now();
      }
      window.addEventListener("pointermove", onMove, { passive: true });

      const eased = { forge: 0, done: 0, seed, turb: turbulence, idle: 0 };
      const cellBuf = new Float32Array(9);
      let raf = 0;
      let last = performance.now();
      const t0 = last;

      function frame(now: number) {
        if (dead) return;
        raf = requestAnimationFrame(frame);
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        const a = api.current;
        const t = target.current;
        const lerp = (v: number, to: number, rate: number) =>
          v + (to - v) * Math.min(1, dt * rate);

        // Phase easing — nothing snaps.
        eased.forge = lerp(eased.forge, t.phase === "forge" ? 1 : 0, 3.2);
        eased.done = lerp(eased.done, t.phase === "done" ? 1 : 0, 2.0);
        eased.seed = lerp(eased.seed, t.seed, 4.5);
        eased.turb = lerp(eased.turb, t.turbulence, 3.0);

        a.charge = Math.max(0, a.charge - dt * 1.25);
        a.mouse.x = lerp(a.mouse.x, a.mouse.tx, 3.5);
        a.mouse.y = lerp(a.mouse.y, a.mouse.ty, 3.5);

        // 8s untouched and the field starts to relax + sweep.
        const quiet = (now - a.lastTouch) / 1000;
        eased.idle = lerp(eased.idle, quiet > 8 ? 1 : 0, 0.7);

        for (let i = 0; i < RIPPLES; i++) {
          const age = a.ripples[i * 3 + 2];
          if (age >= 0) {
            const next = age + dt;
            a.ripples[i * 3 + 2] = next > RIPPLE_LIFE ? -1 : next;
          }
        }

        for (let i = 0; i < 3; i++) {
          const c = t.cells[i];
          cellBuf[i * 3] = c ? c[0] : 0;
          cellBuf[i * 3 + 1] = c ? c[1] : 0;
          cellBuf[i * 3 + 2] = c ? c[2] : 0;
        }

        gl!.uniform1f(L.time, (now - t0) / 1000);
        gl!.uniform1f(L.seed, eased.seed);
        gl!.uniform1f(L.turb, eased.turb);
        gl!.uniform1f(L.charge, Math.min(a.charge, 1));
        gl!.uniform1f(L.forge, eased.forge);
        gl!.uniform1f(L.done, eased.done);
        gl!.uniform1f(L.idle, eased.idle);
        gl!.uniform2f(L.mouse, a.mouse.x, a.mouse.y);
        gl!.uniform3fv(L.rip, a.ripples);
        gl!.uniform3fv(L.cellCol, cellBuf);
        gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      }
      raf = requestAnimationFrame(frame);

      // A hidden tab has no business burning a GPU.
      function onVis() {
        if (document.hidden) {
          cancelAnimationFrame(raf);
        } else if (!dead) {
          last = performance.now();
          raf = requestAnimationFrame(frame);
        }
      }
      document.addEventListener("visibilitychange", onVis);

      return () => {
        dead = true;
        cancelAnimationFrame(raf);
        ro.disconnect();
        window.removeEventListener("pointermove", onMove);
        document.removeEventListener("visibilitychange", onVis);
        gl.deleteBuffer(buf);
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      };
      // Mounts once: every changing value is read through a ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return <canvas ref={canvasRef} className="rdx-field" aria-hidden />;
  },
);
