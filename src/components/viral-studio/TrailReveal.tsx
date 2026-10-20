"use client";

// ---------------------------------------------------------------------------
// The hover reveal (webgl-trail-reveal): a clip rests in black and white; the
// pointer paints a trail that scans its real colour in, with a thin
// chromatic-split edge where colour meets grey; then colour floods outward
// from the pointer and the clip plays.
//
// Mounted only on the one active tile, so there is never more than one WebGL
// context on the page. Raw WebGL 1 rather than three.js: one quad, one
// texture, one shader — a scene graph would be most of the bundle.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";

import { FULL, TRAIL_N, ageTrail, coverTransform, floodEase, pushPoint, regionCover, trailUniforms, type Region, type TrailPoint } from "@/lib/viral-studio/trail";

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
uniform sampler2D uTex;
uniform vec2 uScale;
uniform vec2 uOffset;
uniform vec2 uTrail[${TRAIL_N}];
uniform float uAge[${TRAIL_N}];
uniform float uAspect;
uniform float uTime;
uniform float uFlood;
uniform vec2 uFloodAt;

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
vec3 art(vec2 uv) { return texture2D(uTex, uOffset + clamp(uv, 0.0, 1.0) * uScale).rgb; }

void main() {
  vec2 uv = vUv;

  // The trail: every remembered point contributes, fat at the head, tapering
  // and fading toward the tail.
  float m = 0.0;
  for (int i = 0; i < ${TRAIL_N}; i++) {
    vec2 d = uv - uTrail[i];
    d.x *= uAspect;
    float age = uAge[i];
    float r = mix(0.15, 0.06, age);
    float f = 1.0 - smoothstep(r * 0.72, r, length(d));
    m = max(m, f * (1.0 - age));
  }

  // The flood: colour widening from where the pointer is, once the scan has
  // had its moment.
  vec2 fd = uv - uFloodAt;
  fd.x *= uAspect;
  float fr = uFlood * 1.9;
  float flood = uFlood >= 0.999 ? 1.0 : 1.0 - smoothstep(fr - 0.06, fr, length(fd));
  m = clamp(max(m, flood), 0.0, 1.0);

  // A thin scanner band where colour meets grey: a few pixels of jitter and
  // an RGB split. Restraint is what makes it read as expensive.
  float edge = 4.0 * m * (1.0 - m);
  vec2 j = (vec2(fbm(uv * 38.0 + uTime), fbm(uv * 38.0 - uTime)) - 0.5) * 0.016 * edge;

  vec3 base = art(uv);
  float g = smoothstep(0.03, 0.97, dot(base, vec3(0.299, 0.587, 0.114)));
  vec3 mono = vec3(g) * 0.9 + 0.02;

  vec3 col;
  col.r = art(uv + j + vec2(0.004, 0.0) * edge).r;
  col.g = art(uv + j).g;
  col.b = art(uv + j - vec2(0.004, 0.0) * edge).b;

  vec3 outc = mix(mono, col, smoothstep(0.0, 1.0, m));
  outc += vec3(0.85, 0.92, 1.0) * edge * 0.16;
  gl_FragColor = vec4(outc, 1.0);
}`;

/** How long the scan plays before colour floods in, and how long the flood takes (s). */
const SCAN_S = 0.8;
const FLOOD_S = 0.8;

interface Props {
  /** The element whose pointer moves paint the trail (the whole tile). */
  host: HTMLElement | null;
  image: HTMLImageElement | null;
  /** When set and playing, its frames replace the poster — the reveal is of the moving clip. */
  video: HTMLVideoElement | null;
  onFlooded: () => void;
  /** WebGL missing, or the art can't be read as a texture: the tile shows colour without the effect. */
  onUnsupported: () => void;
  /** Where the pointer entered, in uv — the scan starts there instead of empty. */
  seed?: [number, number] | null;
  /** The picture part of the still (letterbox bars trimmed), so the reveal frames it like the poster. */
  region?: Region;
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s;
  console.warn("[viral-studio] reveal shader didn't compile:", gl.getShaderInfoLog(s));
  return null;
}

function giveUp(why: string, done: () => void) {
  console.warn(`[viral-studio] hover reveal off: ${why}`);
  done();
}

export function TrailReveal({ host, image, video, onFlooded, onUnsupported, seed, region = FULL }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cb = useRef({ onFlooded, onUnsupported });
  cb.current = { onFlooded, onUnsupported };
  const sources = useRef({ image, video });
  sources.current = { image, video };
  const seedRef = useRef(seed);
  const regionRef = useRef(region);
  regionRef.current = region;

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !host) return;
    // A fresh canvas per mount: a context released on cleanup stays lost on
    // its canvas, so a remount (React's dev double-run, a fast re-hover) must
    // never reuse the old element.
    const canvas = document.createElement("canvas");
    canvas.className = "vsc-reveal";
    box.appendChild(canvas);
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) {
      canvas.remove();
      giveUp("no WebGL", cb.current.onUnsupported);
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) {
      canvas.remove();
      giveUp("shader setup failed", cb.current.onUnsupported);
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      canvas.remove();
      giveUp(`link failed: ${gl.getProgramInfoLog(prog)}`, cb.current.onUnsupported);
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const u = (name: string) => gl.getUniformLocation(prog, name);
    const uScale = u("uScale");
    const uOffset = u("uOffset");
    const uTrail = u("uTrail");
    const uAge = u("uAge");
    const uAspect = u("uAspect");
    const uTime = u("uTime");
    const uFlood = u("uFlood");
    const uFloodAt = u("uFloodAt");

    const s0 = seedRef.current;
    let trail: TrailPoint[] = s0 ? pushPoint([], s0[0], s0[1]) : [];
    let floodAt: [number, number] = s0 ?? [0.5, 0.65];
    let texW = 0;
    let texH = 0;
    let fromVideo = false;
    let dead = false;
    let flooded = false;
    const start = performance.now();
    let last = start;
    // Test hook: screenshot scripts slow the reveal down to capture its middle.
    const speed = Number((window as { __vscRevealSpeed?: number }).__vscRevealSpeed) || 1;

    const toUv = (e: PointerEvent): [number, number] | null => {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
    };
    const onMove = (e: PointerEvent) => {
      const p = toUv(e);
      if (!p) return;
      trail = pushPoint(trail, p[0], p[1]);
      floodAt = p;
    };
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerdown", onMove);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    /** Upload whichever source is best right now. False = nothing drawable yet. */
    const upload = (): boolean => {
      const { image: img, video: vid } = sources.current;
      try {
        if (vid && vid.readyState >= 2 && vid.videoWidth) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vid);
          texW = vid.videoWidth;
          texH = vid.videoHeight;
          fromVideo = true;
          return true;
        }
        if (img && img.complete && img.naturalWidth) {
          if (texW !== img.naturalWidth || texH !== img.naturalHeight) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            texW = img.naturalWidth;
            texH = img.naturalHeight;
          }
          return true;
        }
      } catch (err) {
        // A cross-origin source without CORS taints the canvas. Hand back to
        // the plain tile rather than draw nothing.
        dead = true;
        giveUp(`can't read the art as a texture (${(err as Error)?.name ?? "error"})`, cb.current.onUnsupported);
      }
      return false;
    };

    let raf = 0;
    const frame = (now: number) => {
      if (dead) return;
      const dt = Math.min(0.05, ((now - last) / 1000) * speed);
      last = now;
      trail = ageTrail(trail, dt);
      const t = ((now - start) / 1000) * speed;
      const flood = floodEase((t - SCAN_S) / FLOOD_S);
      if (flood >= 1 && !flooded) {
        flooded = true;
        cb.current.onFlooded();
      }

      if (upload()) {
        const { scale, offset } = fromVideo
          ? coverTransform(texW, texH, canvas.width, canvas.height)
          : regionCover(texW, texH, regionRef.current, canvas.width, canvas.height);
        const { pos, age } = trailUniforms(trail);
        gl.uniform2f(uScale, scale[0], scale[1]);
        gl.uniform2f(uOffset, offset[0], offset[1]);
        gl.uniform2fv(uTrail, pos);
        gl.uniform1fv(uAge, age);
        gl.uniform1f(uAspect, canvas.width / canvas.height);
        gl.uniform1f(uTime, t * 0.6);
        gl.uniform1f(uFlood, flood);
        gl.uniform2f(uFloodAt, floodAt[0], floodAt[1]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        canvas.dataset.ready = "1";
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerdown", onMove);
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      // Free the context now instead of waiting for GC — hovering across a
      // board must not pile up live contexts toward the browser's cap.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, [host]);

  return <div ref={boxRef} className="vsc-reveal-box" aria-hidden="true" />;
}
