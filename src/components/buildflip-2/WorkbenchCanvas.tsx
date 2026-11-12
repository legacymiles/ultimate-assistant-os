"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The board's surface: a raw-WebGL plane running a planed-wood grain shader
 * with a light that follows the pointer and sawdust motes that drift when the
 * board has been idle for a few seconds.
 *
 * Raw WebGL, not three.js — this is a dense tool and the whole effect is ~90
 * lines and one draw call, so it holds 60fps on a phone instead of shipping a
 * 600 KB renderer. Degrades to a plain CSS gradient with no WebGL, on a
 * low-core device, or under prefers-reduced-motion.
 */

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uIdle;
uniform float uLight;
uniform vec3 uBase;
uniform vec3 uAccent;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 ar = vec2(uRes.x / uRes.y, 1.0);

  // Planed grain: stretched noise along x, with a slow swell so it is alive
  // without ever being noticeable.
  float grainBand = noise(vec2(uv.x * 2.0, uv.y * 190.0 + sin(uv.x * 7.0) * 2.2));
  float wide = noise(vec2(uv.x * 3.2 + uTime * 0.008, uv.y * 24.0));
  float grain = grainBand * 0.035 + wide * 0.03;

  // The pointer light: a soft warm pool, so the surface reads as a real
  // workbench under a single shop lamp.
  vec2 m = uMouse * ar;
  float d = distance(uv * ar, m);
  float light = exp(-d * d * 7.0) * uLight;

  // Sawdust motes — only once the board has gone quiet.
  float motes = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 drift = vec2(uTime * (0.012 + fi * 0.006), -uTime * 0.004 + fi * 0.3);
    float n = noise((uv + drift) * (46.0 + fi * 22.0));
    motes += smoothstep(0.965, 1.0, n) * (0.5 - fi * 0.14);
  }
  motes *= uIdle;

  // Vignette, so the edges fall away and the content sits forward.
  float vig = smoothstep(1.35, 0.25, distance(uv, vec2(0.5)));

  vec3 col = uBase * (0.86 + vig * 0.22);
  col += uBase * grain;
  col += uAccent * light * 0.3;
  col += vec3(0.92, 0.84, 0.70) * motes * 0.10;

  gl_FragColor = vec4(col, 1.0);
}
`;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export default function WorkbenchCanvas({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const weak =
      typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) <= 3;
    if (reduced || weak) {
      setFailed(true);
      return;
    }

    const canvas = ref.current;
    if (!canvas) return;

    const gl =
      (canvas.getContext("webgl", {
        antialias: false,
        alpha: false,
        powerPreference: "low-power",
      }) as WebGLRenderingContext | null) ?? null;
    if (!gl) {
      setFailed(true);
      return;
    }

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };

    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
      setFailed(true);
      return;
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setFailed(true);
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = {
      res: gl.getUniformLocation(prog, "uRes"),
      time: gl.getUniformLocation(prog, "uTime"),
      mouse: gl.getUniformLocation(prog, "uMouse"),
      idle: gl.getUniformLocation(prog, "uIdle"),
      light: gl.getUniformLocation(prog, "uLight"),
      base: gl.getUniformLocation(prog, "uBase"),
      accent: gl.getUniformLocation(prog, "uAccent"),
    };

    const readTheme = () => {
      const styles = getComputedStyle(document.documentElement);
      const bg = styles.getPropertyValue("--bg-deep").trim() || "#06080a";
      const accent = styles.getPropertyValue("--accent").trim() || "#ffb020";
      const light = document.documentElement.dataset.theme === "light";
      return { base: hexToRgb(bg), accent: hexToRgb(accent), lightMode: light };
    };
    let theme = readTheme();

    const dpr = () => Math.min(window.devicePixelRatio || 1, 1.6);
    const resize = () => {
      const r = dpr();
      const w = Math.max(1, Math.floor(canvas.clientWidth * r));
      const h = Math.max(1, Math.floor(canvas.clientHeight * r));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const mouse = { x: 0.5, y: 0.55, tx: 0.5, ty: 0.55 };
    let lastMove = performance.now();
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.tx = (e.clientX - r.left) / Math.max(1, r.width);
      mouse.ty = 1 - (e.clientY - r.top) / Math.max(1, r.height);
      lastMove = performance.now();
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const themeObserver = new MutationObserver(() => {
      theme = readTheme();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    let raf = 0;
    let visible = true;
    const onVis = () => {
      visible = !document.hidden;
      if (visible && !raf) raf = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", onVis);

    const start = performance.now();
    const frame = (now: number) => {
      raf = 0;
      if (!visible) return;
      resize();

      // Pointer light eases toward the cursor so it has weight.
      mouse.x += (mouse.tx - mouse.x) * 0.07;
      mouse.y += (mouse.ty - mouse.y) * 0.07;

      // Idle after 8 quiet seconds: the sawdust comes out.
      const quiet = (now - lastMove) / 1000;
      const idle = Math.min(1, Math.max(0, (quiet - 8) / 4));

      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.time, (now - start) / 1000);
      gl.uniform2f(u.mouse, mouse.x, mouse.y);
      gl.uniform1f(u.idle, idle);
      gl.uniform1f(u.light, theme.lightMode ? 0.22 : 0.85);
      gl.uniform3fv(u.base, theme.base);
      gl.uniform3fv(u.accent, theme.accent);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onLost = (e: Event) => {
      e.preventDefault();
      if (raf) cancelAnimationFrame(raf);
      setFailed(true);
    };
    canvas.addEventListener("webglcontextlost", onLost);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("webglcontextlost", onLost);
      themeObserver.disconnect();
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    };
  }, []);

  if (failed) {
    return (
      <div
        aria-hidden
        className={className}
        style={{
          background:
            "radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--accent) 7%, var(--bg-deep)) 0%, var(--bg-deep) 55%, var(--bg) 100%)",
        }}
      />
    );
  }

  return <canvas ref={ref} aria-hidden className={className} />;
}
