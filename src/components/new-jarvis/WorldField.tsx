"use client";

// ---------------------------------------------------------------------------
// Jarvis's living world — a breathing galaxy ball behind every section.
//
// Blender owns the shape (tools/jarvis-world/build_world.py → public/jarvis/
// world.glb: a blazing core, a bulge of old stars, four spiral arms with dust
// lanes, a ball of star streams around it all, a sparse halo). This file owns
// the life, written here because none of it can travel through glTF:
//
//   breath    the ball inhales and exhales like a lung — a slow swell, a short
//             hold, a longer release. The shell of streams swells most, and
//             its lower and side lobes more than its top.
//   swirl     differential rotation: stars near the core orbit faster than
//             the rim, so the arms wind as you watch.
//   glow      additive starlight with bloom; the ball's edge burns brighter.
//   pointer   the galaxy leans toward the pointer; stars under it brighten,
//             swell and are pulled toward it like a small gravity well; a
//             click sends a shockwave out from the core.
//   Jarvis    while it works the breath quickens, the swirl speeds up and the
//             core burns brighter; typing gives it a small breath of energy.
//
// Budgets: one draw per object (~8), ~26k points, bloom at half resolution.
// Phones and weak GPUs get no bloom, a capped pixel ratio and half the stars;
// a frame-time probe drops quality further if it must. Hidden tab → the loop
// stops. Reduced motion → one settled frame. No WebGL, a lost context or a
// failed load → `fallback` (the old canvas field).
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, type ReactNode } from "react";
import type * as THREE_NS from "three";
import { breathCurve } from "@/lib/new-jarvis/breath";

type Three = typeof THREE_NS;

interface Props {
  /** Jarvis is working: the breath quickens and the core brightens. */
  busy?: boolean;
  /** The world centres itself on this element (the content area). */
  anchorRef?: React.RefObject<HTMLElement | null>;
  /** Shown when WebGL is unavailable or the world cannot load. */
  fallback?: ReactNode;
}

const GLB = "/jarvis/world.glb";
const SMOKE = "/jarvis/smoke_64.bin";

// --- shaders ------------------------------------------------------------------

const COMMON = /* glsl */ `
  uniform float uTime;
  uniform float uBreath;
  uniform float uEnergy;
  uniform vec2 uPointer;
  uniform float uPointerOn;
  uniform float uAspect;
  uniform float uPulseAge;
  uniform float uAmp;
  uniform float uSwirlT;
  uniform float uCamZ;

  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

  // Radial displacement: the breath, a slow travelling wave, and a click's
  // shockwave running out from the core.
  vec3 breathe(vec3 p, float seed, out float ring) {
    float r = length(p);
    vec3 n = p / max(r, 1e-4);
    float lobe = 1.0 + 0.45 * (0.5 - 0.5 * n.y) + 0.25 * abs(n.x);
    float wave = sin(dot(n, vec3(2.7, 1.9, 3.3)) * 2.0 - uTime * 0.9 + seed * 6.2831);
    float d = uAmp * lobe * (uBreath - 0.4) * r + uAmp * 0.12 * wave * (0.55 + uEnergy);
    ring = exp(-pow((r - uPulseAge * 2.4) * 3.0, 2.0)) * exp(-uPulseAge * 1.3) * step(0.0, uPulseAge);
    d += ring * 0.14;
    return p + n * d;
  }
`;

const POINT_VERT = /* glsl */ `
  ${COMMON}
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uSwirl;
  uniform float uKepler;
  uniform vec3 uAxis;
  uniform float uRim;
  uniform float uMaxSize;
  uniform float uOcclude;
  uniform float uBallR;
  varying float vGlow;
  varying float vAlpha;
  varying float vMix;
  varying float vHeat;
  varying float vAngle;
  varying float vRing;
  varying float vDepth;

  // Rotate v about unit axis k by angle a (Rodrigues).
  vec3 spinAbout(vec3 v, vec3 k, float a) {
    float s = sin(a), c = cos(a);
    return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
  }

  void main() {
    float seed = hash(position);
    float r = length(position);
    // Differential rotation about this layer's own axis: the galaxy turns
    // about its disc, the ring about its tilt, inner orbits faster (uKepler).
    float a = uSwirlT * uSwirl / pow(max(r, 0.35), uKepler);
    vec3 q = spinAbout(position, uAxis, a);
    // Where round its axis this star sits — drives the ring's iridescence.
    vec3 ref = normalize(cross(uAxis, abs(uAxis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 flat_ = q - uAxis * dot(q, uAxis);
    vAngle = atan(dot(flat_, cross(uAxis, ref)), dot(flat_, ref));
    float ring;
    vec3 p = breathe(q, seed, ring);
    vec4 world = modelMatrix * vec4(p, 1.0);
    vec4 mv = viewMatrix * world;
    vec4 clip = projectionMatrix * mv;

    // A small gravity well under the pointer.
    vec2 ndc = clip.xy / clip.w;
    vec2 toP = (uPointer - ndc) * vec2(uAspect, 1.0);
    float pd = length(toP);
    float near = smoothstep(0.32, 0.0, pd) * uPointerOn;
    clip.xy += (toP / vec2(uAspect, 1.0)) * near * 0.07 * clip.w;
    gl_Position = clip;

    // The ball's edge burns brighter than its face.
    vec3 wn = normalize(mat3(modelMatrix) * normalize(p));
    float facing = abs(dot(wn, normalize(cameraPosition - world.xyz)));
    float rim = mix(1.0, 0.3 + 2.2 * pow(1.0 - facing, 2.0), uRim);

    // Depth: the near side of the galaxy is brighter and larger than the far side.
    vDepth = smoothstep(uCamZ + 2.6, uCamZ - 2.6, -mv.z);

    float big = step(0.985, seed) * 2.2;
    float twinkle = 0.6 + 0.4 * sin(uTime * (1.1 + seed * 2.3) + seed * 40.0);
    // uSize is pixels at the galaxy's centre; nearer stars grow, farther shrink.
    gl_PointSize = min(uMaxSize, uSize * (0.5 + seed * 0.8 + big) * (1.0 + near * 0.8 + ring * 0.6) * (0.75 + 0.5 * vDepth) * uPixelRatio * uCamZ / -mv.z);
    // Ring stars that pass behind the ball are hidden by it, like Saturn's.
    vec3 vc = (viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 ray = normalize(mv.xyz);
    float along = dot(vc, ray);
    float lateral = length(vc - ray * along);
    float occ = (1.0 - smoothstep(uBallR * 0.8, uBallR * 1.05, lateral)) * smoothstep(0.0, 0.4, length(mv.xyz) - along);
    float shade = mix(1.0, 0.16, occ * uOcclude);

    // Anything drifting right up to the lens fades instead of flaring.
    float lens = smoothstep(2.6, 6.0, -mv.z);
    vAlpha = twinkle * rim * (0.55 + 0.6 * vDepth) * lens * shade;
    vGlow = near * 0.9 + ring * 0.6 + uEnergy * 0.3 + uBreath * 0.25;
    vRing = ring;
    vMix = seed;
    vHeat = smoothstep(0.9, 0.0, r);
  }
`;

const POINT_FRAG = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uHot;
  uniform float uOpacity;
  uniform float uIri;
  uniform float uHue;
  uniform float uTime;
  uniform vec3 uPulseColor;
  varying float vGlow;
  varying float vAlpha;
  varying float vMix;
  varying float vHeat;
  varying float vAngle;
  varying float vRing;
  varying float vDepth;

  // Rotate a colour's hue by a radians, keeping its brightness.
  vec3 hueShift(vec3 c, float a) {
    const vec3 k = vec3(0.57735);
    float ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
  }
  // Oil-on-water colour: teal → violet → magenta → gold round the ring.
  vec3 iridescent(float t) {
    return vec3(0.55) + vec3(0.45) * cos(6.2831 * (t + vec3(0.0, 0.22, 0.48)));
  }

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float disc = smoothstep(0.5, 0.0, d);
    vec3 c = mix(uColorA, uColorB, vMix);
    c = mix(c, uHot, vHeat * 0.75);
    float t = vAngle / 6.2831 * 2.0 + uTime * 0.04 + vMix * 0.08;
    c = mix(c, iridescent(t) * 1.25, uIri);
    c = hueShift(c, uHue);
    // Far stars cool toward blue; near ones keep their full colour.
    c = mix(c * vec3(0.7, 0.8, 1.15), c, vDepth);
    c = c * (1.0 + vGlow) + uPulseColor * vRing * 0.9;
    gl_FragColor = vec4(c, uOpacity * vAlpha * disc * disc);
    #include <colorspace_fragment>
  }
`;

const CORE_VERT = /* glsl */ `
  uniform float uBreath;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vec3 p = position * (1.0 + uBreath * 0.22);
    vec4 world = modelMatrix * vec4(p, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const CORE_FRAG = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uBreath;
  uniform float uEnergy;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    float f = pow(1.0 - max(dot(vN, vView), 0.0), 2.2);
    vec3 c = mix(uColorB, uColorA, f) * (0.55 + f * 1.2 + uBreath * 0.45 + uEnergy * 0.8);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

// --- volumes: the smoke in the ball and the mist round the ring -------------
//
// Both are ray-marched inside a unit box (scaled to size): Beer–Lambert
// absorption with emission, accumulated premultiplied, so blending is
// ONE, ONE_MINUS_SRC_ALPHA. The core smoke reads a 64³ density grid
// (public/jarvis/smoke_64.bin) and adds finer procedural tearing on top; the
// ring mist is procedural, held to a thin horizontal band round the ring.

const VOLUME_VERT = /* glsl */ `
  uniform vec3 uCamLocal;
  varying vec3 vOrigin;
  varying vec3 vDir;
  void main() {
    vOrigin = uCamLocal;
    vDir = position - uCamLocal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const VOLUME_COMMON = /* glsl */ `
  uniform float uTime;
  uniform float uBreath;
  uniform float uEnergy;
  uniform float uHue;
  uniform float uOpacity;
  varying vec3 vOrigin;
  varying vec3 vDir;

  vec2 hitBox(vec3 o, vec3 d) {
    vec3 inv = 1.0 / d;
    vec3 t0 = (vec3(-0.5) - o) * inv, t1 = (vec3(0.5) - o) * inv;
    vec3 mn = min(t0, t1), mx = max(t0, t1);
    return vec2(max(max(mn.x, mn.y), mn.z), min(min(mx.x, mx.y), mx.z));
  }
  float h31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return s;
  }
  vec3 hueShift(vec3 c, float a) {
    const vec3 k = vec3(0.57735);
    float ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
  }
  // Teal → violet → magenta → gold.
  vec3 palette(float t) {
    return vec3(0.52) + vec3(0.48) * cos(6.2831 * (t + vec3(0.0, 0.24, 0.5)));
  }
  vec3 rotY(vec3 p, float a) {
    float s = sin(a), c = cos(a);
    return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  }
`;

const SMOKE_FRAG = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D uVol;
  uniform float uFrame;
  ${VOLUME_COMMON}

  void main() {
    vec3 d = normalize(vDir);
    vec2 b = hitBox(vOrigin, d);
    if (b.x > b.y) discard;
    b.x = max(b.x, 0.0);
    float dt = (b.y - b.x) / float(STEPS);
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uFrame) * 43758.5453);
    vec3 p = vOrigin + d * (b.x + dt * jitter);
    float T = 1.0;
    vec3 acc = vec3(0.0);
    // The smoke breathes with the ball: it swells as the ball inhales.
    float grow = 1.0 / (0.9 + 0.16 * uBreath);
    for (int i = 0; i < STEPS; i++) {
      float r = length(p);
      // Swirl that eddies back and forth rather than winding up for ever.
      float a = uTime * 0.11 + sin(uTime * 0.07 + r * 3.0) * 0.7;
      vec3 q = rotY(p * grow, a);
      float base = texture(uVol, vec3(q.x, -q.z, q.y) + 0.5).r;
      // Finer tearing, drifting slowly through the grid's big shapes.
      float tear = fbm(q * 7.0 + vec3(0.0, uTime * 0.05, uTime * 0.03)) * 0.7 + fbm(q * 15.0 - uTime * 0.04) * 0.45;
      // Thinned right at the heart, so the colour is in the folds, not a white blob.
      // Carved: below a floor there is no smoke at all, so the gaps between
      // the wisps stay dark and the folds read as depth.
      float s = max(0.0, base * (0.25 + 1.7 * tear) - 0.1) * smoothstep(0.5, 0.36, r) * smoothstep(0.03, 0.19, r);
      if (s > 0.01) {
        float alpha = 1.0 - exp(-s * dt * 10.0 * uOpacity);
        float t = fbm(q * 2.2 + 5.0) * 0.9 + atan(q.z, q.x) / 6.2831 + uTime * 0.015;
        vec3 col = hueShift(palette(t), uHue);
        // Deep, saturated colour — not pastel.
        col = clamp(mix(vec3(dot(col, vec3(0.333))), col, 1.7), 0.0, 1.0);
        // Self-shadow: lit by the core, so smoke between this point and the
        // heart darkens it — inner folds go deep, outer edges catch the light.
        vec3 inward = q * 0.78;
        float occl = texture(uVol, vec3(inward.x, -inward.z, inward.y) + 0.5).r;
        float light = exp(-occl * 2.6);
        // Hot at the heart, deep colour in the folds.
        col = mix(col, vec3(1.0, 0.86, 0.66), smoothstep(0.1, 0.0, r) * 0.6);
        // Kept under the bloom's threshold, so the smoke glows instead of bleaching.
        col *= (0.15 + 0.82 * light) + 0.3 * exp(-r * r * 160.0) + 0.12 * uEnergy + 0.06 * uBreath;
        acc += T * alpha * col;
        T *= 1.0 - alpha;
        if (T < 0.03) break;
      }
      p += d * dt;
    }
    float alpha = 1.0 - T;
    gl_FragColor = vec4(alpha > 0.0 ? acc / alpha : vec3(0.0), alpha);
    #include <colorspace_fragment>
    gl_FragColor.rgb *= gl_FragColor.a;
  }
`;

const MIST_FRAG = /* glsl */ `
  uniform vec3 uScale;
  uniform float uFrame;
  ${VOLUME_COMMON}

  void main() {
    vec3 d = normalize(vDir);
    vec2 b = hitBox(vOrigin, d);
    if (b.x > b.y) discard;
    b.x = max(b.x, 0.0);
    float dt = (b.y - b.x) / float(STEPS);
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uFrame) * 43758.5453);
    vec3 p = vOrigin + d * (b.x + dt * jitter);
    float T = 1.0;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < STEPS; i++) {
      vec3 w = p * uScale; // box space → world units
      float rad = length(w.xz);
      // A band round the ring, thinnest at its edges, nothing inside or far out.
      float band = smoothstep(1.55, 2.35, rad) * (1.0 - smoothstep(3.1, 4.1, rad));
      float thick = 0.16 + 0.1 * sin(atan(w.z, w.x) * 3.0 + uTime * 0.2);
      float vert = exp(-pow(w.y / thick, 2.0));
      if (band * vert > 0.02) {
        // It flows round the ring, inner faster than outer.
        vec3 q = rotY(w, uTime * 0.16 / pow(max(rad, 1.0), 1.5));
        float n = fbm(q * vec3(1.6, 4.0, 1.6) + vec3(0.0, 0.0, uTime * 0.02)) * 0.65 + fbm(q * vec3(0.55, 1.4, 0.55) - uTime * 0.01) * 0.55;
        float s = band * vert * max(0.0, n * 2.3 - 0.85);
        float alpha = 1.0 - exp(-s * dt * 2.2 * uOpacity);
        float t = atan(q.z, q.x) / 6.2831 * 1.5 + n * 0.5 + uTime * 0.01;
        vec3 col = hueShift(palette(t), uHue) * (0.42 + 0.15 * uBreath + 0.2 * uEnergy);
        acc += T * alpha * col;
        T *= 1.0 - alpha;
      }
      p += d * dt;
    }
    float alpha = 1.0 - T;
    gl_FragColor = vec4(alpha > 0.0 ? acc / alpha : vec3(0.0), alpha);
    #include <colorspace_fragment>
    gl_FragColor.rgb *= gl_FragColor.a;
  }
`;

// --- the breath ----------------------------------------------------------------

type Tier = "high" | "low";

function pickTier(): Tier {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  if (coarse || mem < 4 || cores <= 4 || Math.min(window.innerWidth, window.innerHeight) < 600) return "low";
  return "high";
}

export function WorldField({ busy = false, anchorRef, fallback = null }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      let THREE: Three;
      let GLTFLoader: typeof import("three/examples/jsm/loaders/GLTFLoader.js").GLTFLoader;
      try {
        THREE = await import("three");
        ({ GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js"));
      } catch {
        if (!disposed) setFailed(true);
        return;
      }
      if (disposed) return;

      const canvas = document.createElement("canvas");
      let renderer: THREE_NS.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
      } catch {
        setFailed(true);
        return;
      }
      host.appendChild(canvas);

      // ?world=full pins full quality (for checking the look on a slow machine).
      const pinned = new URLSearchParams(window.location.search).get("world") === "full";
      let tier: Tier = pinned ? "high" : pickTier();
      /** 2 = as picked, 1 = no bloom, 0 = no bloom and a low pixel ratio. */
      let quality = tier === "high" ? 2 : 1;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
      renderer.setClearColor(new THREE.Color("#02050b"), 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);

      // Saturated on purpose: additive light washes colour out, so it starts vivid.
      const CYAN = new THREE.Color("#00e5ff");
      const ELECTRIC = new THREE.Color("#3d6bff");
      const VIOLET = new THREE.Color("#9b5cff");
      const ICE = new THREE.Color("#c9f6ff");
      const GOLD = new THREE.Color("#ffb347");
      const WARM = new THREE.Color("#ffe9c2");
      const MAGENTA = new THREE.Color("#ff2fb4");
      const ROSE = new THREE.Color("#ff6fd0");
      const BLUE = new THREE.Color("#4f7bff");
      const TEAL = new THREE.Color("#1fffc8");
      const EMBER = new THREE.Color("#ff6a3d");
      const LIME = new THREE.Color("#8dff5a");
      const PULSES = [MAGENTA, CYAN, GOLD, LIME, VIOLET];

      // Shared clock-driven uniforms; each material spreads the same objects in.
      const shared = {
        uTime: { value: 0 },
        uBreath: { value: 0 },
        uEnergy: { value: 0 },
        uPointer: { value: new THREE.Vector2(0, 0) },
        uPointerOn: { value: 0 },
        uAspect: { value: 1 },
        uPulseAge: { value: -1 },
        // The swirl's own clock: it speeds up while Jarvis works without jumping.
        uSwirlT: { value: 0 },
        uCamZ: { value: 8 },
        // The pointer turns the whole palette; each click sends a new colour.
        uHue: { value: 0 },
        // The ball's radius on screen-space terms, for the rings' occlusion.
        uBallR: { value: 1.75 },
        uPulseColor: { value: new THREE.Color("#ff2fb4") },
      };

      interface Look {
        a: THREE_NS.Color;
        b: THREE_NS.Color;
        hot?: THREE_NS.Color;
        size: number;
        opacity: number;
        amp: number;
        swirl: number;
        /** 1 = galaxy-like (∝ 1/r), 1.5 = Kepler (ring), 0 = turns as one piece. */
        kepler?: number;
        rim?: number;
        /** 0..1 how much of its colour is the ring's oil-on-water shimmer. */
        iri?: number;
        /** Largest a point may draw, in pixels (clouds go bigger than stars). */
        maxSize?: number;
        /** 1 = hidden where it passes behind the ball (the rings). */
        occlude?: number;
      }
      const Y_AXIS = new THREE.Vector3(0, 1, 0);
      const pointMat = (l: Look) =>
        new THREE.ShaderMaterial({
          vertexShader: POINT_VERT,
          fragmentShader: POINT_FRAG,
          uniforms: {
            ...shared,
            uAmp: { value: l.amp },
            uColorA: { value: l.a },
            uColorB: { value: l.b },
            uHot: { value: l.hot ?? WARM },
            uOpacity: { value: l.opacity },
            uSize: { value: l.size },
            uSwirl: { value: l.swirl },
            uKepler: { value: l.kepler ?? 1 },
            uAxis: { value: Y_AXIS.clone() },
            uIri: { value: l.iri ?? 0 },
            uMaxSize: { value: l.maxSize ?? 56 },
            uOcclude: { value: l.occlude ?? 0 },
            uBallR: shared.uBallR,
            uRim: { value: l.rim ?? 0 },
            uPixelRatio: { value: 1 },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });

      // --- the world, from Blender -----------------------------------------
      let gltf: { scene: THREE_NS.Group };
      try {
        gltf = (await new GLTFLoader().loadAsync(GLB)) as unknown as { scene: THREE_NS.Group };
      } catch {
        renderer.dispose();
        canvas.remove();
        if (!disposed) setFailed(true);
        return;
      }
      if (disposed) {
        renderer.dispose();
        canvas.remove();
        return;
      }

      const tilt = new THREE.Group(); // leans toward the pointer
      const spin = new THREE.Group(); // slow turn
      scene.add(tilt);
      tilt.add(spin);
      spin.add(gltf.scene);

      const pointMats: THREE_NS.ShaderMaterial[] = [];
      const looks: Record<string, Look> = {
        galaxy_bulge: { a: GOLD, b: WARM, size: 3, opacity: 0.45, amp: 0.06, swirl: 0.22 },
        galaxy_arms: { a: CYAN, b: ELECTRIC, hot: GOLD, size: 3.4, opacity: 0.85, amp: 0.12, swirl: 0.14 },
        galaxy_knots: { a: MAGENTA, b: ROSE, hot: MAGENTA, size: 5.2, opacity: 0.95, amp: 0.12, swirl: 0.14 },
        galaxy_dust: { a: VIOLET, b: MAGENTA, hot: VIOLET, size: 11, opacity: 0.07, amp: 0.12, swirl: 0.14 },
        galaxy_shell: { a: CYAN, b: BLUE, hot: ICE, size: 3.5, opacity: 1, amp: 0.2, swirl: 0.045, rim: 1 },
        galaxy_ribbons: { a: TEAL, b: CYAN, size: 2.8, opacity: 0.6, amp: 0.18, swirl: 0.05, kepler: 0, iri: 0.45 },
        galaxy_companion: { a: ROSE, b: VIOLET, hot: ROSE, size: 2.8, opacity: 0.4, amp: 0.08, swirl: 0.05, kepler: 0 },
        ring_main: { a: TEAL, b: CYAN, size: 3, opacity: 0.85, amp: 0.05, swirl: 0.5, kepler: 1.5, iri: 0.85, occlude: 1 },
        ring_braid: { a: GOLD, b: EMBER, size: 3.2, opacity: 0.95, amp: 0.04, swirl: 0.5, kepler: 1.5, iri: 0.35, occlude: 1 },
        ring_moons: { a: ICE, b: WARM, size: 15, opacity: 1, amp: 0.03, swirl: 0.5, kepler: 1.5, occlude: 1 },
        // Out in the cosmos: stars and small clusters, drifting slowly as one sky.
        cosmos_stars: { a: ICE, b: ROSE, hot: ICE, size: 3, opacity: 0.8, amp: 0.08, swirl: 0.008, kepler: 0, iri: 0.35 },
      };

      const coreMat = new THREE.ShaderMaterial({
        vertexShader: CORE_VERT,
        fragmentShader: CORE_FRAG,
        uniforms: { uBreath: shared.uBreath, uEnergy: shared.uEnergy, uColorA: { value: WARM }, uColorB: { value: GOLD } },
      });

      gltf.scene.traverse((o) => {
        // Each Blender object is a node; its primitive may come in as a child.
        let top: THREE_NS.Object3D = o;
        while (top.parent && top.parent !== gltf.scene) top = top.parent;
        const key = top.name.replace(/\.\d+$/, "");
        const asPoints = o as THREE_NS.Points;
        const asMesh = o as THREE_NS.Mesh;
        if (asPoints.isPoints) {
          if (tier === "low") {
            // Half the stars on phones and weak GPUs.
            const g = asPoints.geometry;
            const pos = g.getAttribute("position");
            const kept: number[] = [];
            for (let i = 0; i < pos.count; i += 2) kept.push(pos.getX(i), pos.getY(i), pos.getZ(i));
            g.setAttribute("position", new THREE.Float32BufferAttribute(kept, 3));
          }
          const m = pointMat(looks[key] ?? looks.cosmos_stars);
          asPoints.material = m;
          asPoints.frustumCulled = false;
          pointMats.push(m);
        } else if (asMesh.isMesh) {
          asMesh.material = coreMat;
        }
      });

      // The rings: held level, Saturn-style, while the galaxy faces you.
      // They leave the galaxy's face-on group for their own, which only leans
      // a little with the pointer; each spins about its own (local Y) axis.
      const rings = new THREE.Group();
      scene.add(rings);
      for (const name of ["ring_main", "ring_braid", "ring_moons"]) {
        const o = gltf.scene.getObjectByName(name);
        if (o) rings.add(o);
      }

      // A soft halo around the core.
      const haloTex = (() => {
        const c = document.createElement("canvas");
        c.width = c.height = 128;
        const g = c.getContext("2d")!;
        const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, "rgba(255,244,225,0.95)");
        grad.addColorStop(0.18, "rgba(255,200,140,0.45)");
        grad.addColorStop(0.45, "rgba(120,140,255,0.12)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 128);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })();
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      );
      tilt.add(halo);

      // --- the smoke in the ball, and the mist round the ring -----------------
      const volumes: { mesh: THREE_NS.Mesh; mat: THREE_NS.ShaderMaterial }[] = [];
      const volumeMat = (frag: string, steps: number, extra: Record<string, THREE_NS.IUniform>) =>
        new THREE.ShaderMaterial({
          vertexShader: VOLUME_VERT,
          fragmentShader: frag,
          defines: { STEPS: steps },
          uniforms: {
            uCamLocal: { value: new THREE.Vector3() },
            uTime: shared.uTime,
            uBreath: shared.uBreath,
            uEnergy: shared.uEnergy,
            uHue: shared.uHue,
            uFrame: { value: 0 },
            uOpacity: { value: 1 },
            ...extra,
          },
          side: THREE.BackSide,
          transparent: true,
          depthWrite: false,
          blending: THREE.NormalBlending,
          premultipliedAlpha: true,
        });
      let smokeTex: THREE_NS.Data3DTexture | null = null;
      try {
        const res = await fetch(SMOKE);
        if (res.ok) {
          const data = new Uint8Array(await res.arrayBuffer());
          if (data.length === 64 * 64 * 64) {
            smokeTex = new THREE.Data3DTexture(data, 64, 64, 64);
            smokeTex.format = THREE.RedFormat;
            smokeTex.type = THREE.UnsignedByteType;
            smokeTex.minFilter = smokeTex.magFilter = THREE.LinearFilter;
            smokeTex.unpackAlignment = 1;
            smokeTex.needsUpdate = true;
          }
        }
      } catch {
        smokeTex = null; // no smoke, everything else still runs
      }
      if (disposed) return;
      if (smokeTex) {
        const mat = volumeMat(SMOKE_FRAG, tier === "high" ? 40 : 20, { uVol: { value: smokeTex } });
        mat.uniforms.uOpacity.value = 0.85;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
        mesh.scale.setScalar(4); // the grid's domain: [-2, 2]³
        mesh.renderOrder = -1; // under the stars, so they sparkle over it
        mesh.frustumCulled = false;
        spin.add(mesh);
        volumes.push({ mesh, mat });
      }
      {
        const scale = new THREE.Vector3(8.6, 1.0, 8.6);
        const mat = volumeMat(MIST_FRAG, tier === "high" ? 22 : 11, { uScale: { value: scale } });
        mat.uniforms.uOpacity.value = 0.75;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
        mesh.scale.copy(scale);
        mesh.renderOrder = -2;
        mesh.frustumCulled = false;
        rings.add(mesh);
        volumes.push({ mesh, mat });
      }

      // Far stars, and a faint nebula behind everything.
      const stars = (() => {
        const n = tier === "low" ? 700 : 1600;
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const d = new THREE.Vector3().randomDirection().multiplyScalar(14 + Math.random() * 30);
          pos.set([d.x, d.y, d.z], i * 3);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        const m = pointMat({ a: ICE, b: VIOLET, hot: ICE, size: 7, opacity: 0.5, amp: 0, swirl: 0 });
        pointMats.push(m);
        const p = new THREE.Points(g, m);
        p.frustumCulled = false;
        return p;
      })();
      scene.add(stars);

      // Depth, in front: a few big out-of-focus motes between you and the
      // galaxy. They ride with the camera and slide further with the pointer
      // than anything else, which is what makes the galaxy read as far away.
      scene.add(camera);
      const bokeh = (() => {
        const n = tier === "low" ? 14 : 34;
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          pos.set([(Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3.6, -1.6 - Math.random() * 2.6], i * 3);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        const m = pointMat({ a: CYAN, b: MAGENTA, hot: GOLD, size: 26, opacity: 0.16, amp: 0, swirl: 0 });
        m.uniforms.uCamZ = { value: 3 };
        // Out of focus and close to you: no shockwave, no pointer flare.
        m.uniforms.uPulseAge = { value: -1 };
        m.uniforms.uPointerOn = { value: 0 };
        pointMats.push(m);
        const p = new THREE.Points(g, m);
        p.frustumCulled = false;
        camera.add(p);
        return p;
      })();

      // Depth, behind: a handful of distant galaxies, each a different shape.
      const farGalaxies: THREE_NS.Sprite[] = [];
      const farTex: THREE_NS.Texture[] = [];
      {
        const tints = ["255,120,210", "120,220,255", "255,200,120", "170,140,255", "120,255,200"];
        const count = tier === "low" ? 3 : 6;
        for (let i = 0; i < count; i++) {
          const c = document.createElement("canvas");
          c.width = c.height = 128;
          const g = c.getContext("2d")!;
          const tint = tints[i % tints.length];
          const core = g.createRadialGradient(64, 64, 0, 64, 64, 18);
          core.addColorStop(0, "rgba(255,245,230,0.9)");
          core.addColorStop(1, "rgba(255,245,230,0)");
          g.translate(64, 64);
          g.scale(1, 0.35 + Math.random() * 0.5);
          // Two faint arms, drawn as dotted spirals.
          for (let arm = 0; arm < 2; arm++) {
            for (let k = 0; k < 160; k++) {
              const t = k / 160;
              const r = 6 + t * 52;
              const a = arm * Math.PI + t * 4.2;
              g.fillStyle = `rgba(${tint},${0.55 * (1 - t)})`;
              g.beginPath();
              g.arc(Math.cos(a) * r, Math.sin(a) * r, 1.6 + (1 - t) * 1.6, 0, Math.PI * 2);
              g.fill();
            }
          }
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.fillStyle = core;
          g.fillRect(0, 0, 128, 128);
          const tex = new THREE.CanvasTexture(c);
          tex.colorSpace = THREE.SRGBColorSpace;
          farTex.push(tex);
          const sp = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.2 }),
          );
          sp.material.rotation = Math.random() * Math.PI;
          const d = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.7, -0.6 - Math.random() * 0.4).normalize();
          sp.position.copy(d.multiplyScalar(30 + Math.random() * 12));
          sp.scale.setScalar(0.9 + Math.random() * 1.1);
          stars.add(sp);
          farGalaxies.push(sp);
        }
      }

      // The old all-over nebula is gone: the only haze now is the mist that
      // runs round the ring. What stays is a plain deep-space backdrop — an
      // opaque sphere, so the bloom has true black to settle on instead of
      // veiling the whole sky.
      const backdrop = new THREE.Mesh(
        new THREE.SphereGeometry(90, 24, 12),
        new THREE.MeshBasicMaterial({ color: new THREE.Color("#010308"), side: THREE.BackSide, depthWrite: false }),
      );
      backdrop.renderOrder = -10;
      scene.add(backdrop);

      // --- bloom (desktop) -------------------------------------------------
      let composer: import("three/examples/jsm/postprocessing/EffectComposer.js").EffectComposer | null = null;
      let bloom: import("three/examples/jsm/postprocessing/UnrealBloomPass.js").UnrealBloomPass | null = null;
      if (tier === "high") {
        try {
          const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
            import("three/examples/jsm/postprocessing/EffectComposer.js"),
            import("three/examples/jsm/postprocessing/RenderPass.js"),
            import("three/examples/jsm/postprocessing/UnrealBloomPass.js"),
            import("three/examples/jsm/postprocessing/OutputPass.js"),
          ]);
          composer = new EffectComposer(renderer);
          composer.addPass(new RenderPass(scene, camera));
          bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.45, 0.18);
          composer.addPass(bloom);
          composer.addPass(new OutputPass());
        } catch {
          composer = null;
        }
      }
      if (disposed) {
        renderer.dispose();
        canvas.remove();
        return;
      }

      // --- size, and centring on the content area ---------------------------
      let w = 1;
      let h = 1;
      const size = () => {
        w = Math.max(1, window.innerWidth);
        h = Math.max(1, window.innerHeight);
        const dpr =
          quality === 0
            ? 0.75
            : Math.min(window.devicePixelRatio || 1, tier === "high" ? 1.5 : 1.25);
        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h, false);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        if (composer) {
          composer.setPixelRatio(dpr);
          composer.setSize(w, h);
          bloom?.resolution.set(Math.round((w * dpr) / 2), Math.round((h * dpr) / 2));
        }
        for (const m of pointMats) m.uniforms.uPixelRatio.value = dpr;
        camera.aspect = w / h;
        // Centre the ball on the content area; the rings just fit, the
        // cosmos runs off the edges.
        const box = anchorRef?.current?.getBoundingClientRect();
        const cx = box ? box.left + box.width / 2 : w / 2;
        const cy = box ? box.top + box.height / 2 : h / 2;
        const short = box ? Math.min(box.width, box.height) : Math.min(w, h);
        const fitR = 2.7 * (h / Math.max(short, 1));
        camera.position.z = fitR / Math.tan(((camera.fov / 2) * Math.PI) / 180);
        shared.uCamZ.value = camera.position.z;
        camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);
        camera.updateProjectionMatrix();
        shared.uAspect.value = w / h;
        halo.scale.setScalar(1.3);
      };
      size();
      const ro = new ResizeObserver(size);
      ro.observe(document.documentElement);
      if (anchorRef?.current) ro.observe(anchorRef.current);
      window.addEventListener("resize", size);

      // --- input ------------------------------------------------------------
      const pointer = { x: 0, y: 0, on: 0, target: 0 };
      const onMove = (e: PointerEvent) => {
        pointer.x = (e.clientX / w) * 2 - 1;
        pointer.y = -((e.clientY / h) * 2 - 1);
        pointer.target = e.pointerType === "touch" ? 0.6 : 1;
      };
      const onLeave = () => (pointer.target = 0);
      const onDown = (e: PointerEvent) => {
        // Clicking a button or typing in a box is using the app, not touching
        // the galaxy: only a click on open space sends a shockwave.
        const target = e.target as HTMLElement | null;
        if (target?.closest("button, a, input, textarea, select, label, [role='button'], [contenteditable='true']")) return;
        // A shockwave out from the core, in the next colour of the cycle.
        shared.uPulseAge.value = 0;
        pulseIndex = (pulseIndex + 1) % PULSES.length;
        shared.uPulseColor.value.copy(PULSES[pulseIndex]);
        energy = Math.min(1.2, energy + 0.35);
      };
      const onKey = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) energy = Math.min(1, energy + 0.06);
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onDown, { passive: true });
      document.addEventListener("pointerleave", onLeave);
      window.addEventListener("keydown", onKey, { passive: true });

      // --- the loop ---------------------------------------------------------
      let energy = 0;
      let pulseIndex = 0;
      let hue = 0;
      let busyLevel = 0;
      let phase = 0.15;
      let t = 0;
      let last = performance.now();
      let raf = 0;
      let probeFrames = 0;
      let probeTime = 0;
      const tiltNow = { x: 0, y: 0 };

      const camWorld = new THREE.Vector3();
      const draw = () => {
        // Volumes march from the camera, in their own box space.
        camera.getWorldPosition(camWorld);
        for (const v of volumes) {
          v.mesh.updateWorldMatrix(true, false);
          v.mat.uniforms.uCamLocal.value.copy(camWorld);
          v.mesh.worldToLocal(v.mat.uniforms.uCamLocal.value);
          v.mat.uniforms.uFrame.value = (v.mat.uniforms.uFrame.value + 1) % 1024;
        }
        if (composer) composer.render();
        else renderer.render(scene, camera);
      };

      const step = (dtRaw: number) => {
        // A rAF timestamp can land a hair before the last performance.now(),
        // and a long pause can make a huge step: both are clamped.
        const dt = Math.max(0, Math.min(0.05, dtRaw));
        t += dt;
        busyLevel += ((busyRef.current ? 1 : 0) - busyLevel) * Math.min(1, dt * 2);
        energy = Math.max(0, energy - dt * 0.35);
        // One breath every ~6.4 s at rest, ~3.2 s while Jarvis works.
        phase = (((phase + dt / (6.4 - 3.2 * busyLevel)) % 1) + 1) % 1;
        shared.uTime.value = t;
        shared.uBreath.value = breathCurve(phase);
        shared.uEnergy.value = Math.min(1.4, energy + busyLevel * 0.6);
        if (shared.uPulseAge.value >= 0) {
          shared.uPulseAge.value += dt;
          if (shared.uPulseAge.value > 3.5) shared.uPulseAge.value = -1;
        }
        pointer.on += (pointer.target - pointer.on) * Math.min(1, dt * 4);
        shared.uPointer.value.set(pointer.x, pointer.y);
        shared.uPointerOn.value = pointer.on;

        // Lean toward the pointer on a soft spring; the whole thing breathes in scale.
        const tx = -pointer.y * 0.28 * pointer.on;
        const ty = pointer.x * 0.36 * pointer.on;
        tiltNow.x += (tx - tiltNow.x) * Math.min(1, dt * 2.5);
        tiltNow.y += (ty - tiltNow.y) * Math.min(1, dt * 2.5);
        // Nearly face-on, so the galaxy reads as a round ball, not a squashed
        // disc; rolled a touch so nothing sits square.
        tilt.rotation.set(tiltNow.x + 1.08, tiltNow.y, -0.2);
        const s = 0.93 + 0.1 * shared.uBreath.value;
        spin.scale.setScalar(s);
        rings.scale.setScalar(0.96 + 0.06 * shared.uBreath.value);
        rings.rotation.set(0.21 + tiltNow.x * 0.45, tiltNow.y * 0.5, -0.045);
        shared.uBallR.value = 1.72 * s;
        halo.scale.setScalar(1.15 + 0.35 * shared.uBreath.value + busyLevel * 0.35);
        spin.rotation.y += dt * (0.03 + busyLevel * 0.05);
        shared.uSwirlT.value += dt * (1 + busyLevel * 1.4 + energy * 0.5);
        stars.rotation.y += dt * 0.004;
        stars.position.set(pointer.x * 0.6 * pointer.on, pointer.y * 0.4 * pointer.on, 0);
        // Foreground motes slide the most: that difference is the depth.
        bokeh.position.set(-pointer.x * 0.55 * pointer.on, -pointer.y * 0.35 * pointer.on, 0);
        bokeh.rotation.z += dt * 0.01;
        // Colour follows the pointer across the screen, and drifts on its own.
        const hueTarget = pointer.x * 0.55 * pointer.on + Math.sin(t * 0.07) * 0.22 + busyLevel * 0.25;
        hue += (hueTarget - hue) * Math.min(1, dt * 1.5);
        shared.uHue.value = hue;
        if (bloom) bloom.strength = 0.7 + 0.3 * shared.uBreath.value + 0.35 * busyLevel;
      };

      const frame = (now: number) => {
        const dt = (now - last) / 1000;
        last = now;
        step(dt);
        draw();
        // Quality probe: over the first ~2.5 s, a slow average drops bloom and
        // thins the smoke and mist; still slow after that, the pixel ratio
        // comes down too.
        probeFrames++;
        probeTime += dt;
        if (!pinned && probeTime > 2.5 && probeFrames > 3) {
          const avg = probeTime / probeFrames;
          if (avg > 0.024 && quality > 0) {
            quality--;
            tier = "low";
            composer = null;
            // Fewer steps through the smoke and mist: the cheapest big saving.
            for (const v of volumes) {
              v.mat.defines.STEPS = Math.max(8, Math.round(Number(v.mat.defines.STEPS) * 0.55));
              v.mat.needsUpdate = true;
            }
            size();
          }
          probeFrames = 0;
          probeTime = 0;
        }
        raf = requestAnimationFrame(frame);
      };

      const start = () => {
        cancelAnimationFrame(raf);
        if (reduce.matches) {
          // Settled: one honest frame, no motion.
          step(0);
          shared.uBreath.value = 0.5;
          draw();
          return;
        }
        last = performance.now();
        raf = requestAnimationFrame(frame);
      };
      const onVis = () => (document.hidden ? cancelAnimationFrame(raf) : start());
      document.addEventListener("visibilitychange", onVis);
      reduce.addEventListener?.("change", start);
      const onRedraw = () => reduce.matches && start();
      window.addEventListener("resize", onRedraw);

      const onLost = (e: Event) => {
        e.preventDefault();
        cancelAnimationFrame(raf);
        setFailed(true);
      };
      canvas.addEventListener("webglcontextlost", onLost);

      start();
      host.dataset.ready = "true";

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        window.removeEventListener("resize", size);
        window.removeEventListener("resize", onRedraw);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerdown", onDown);
        document.removeEventListener("pointerleave", onLeave);
        window.removeEventListener("keydown", onKey);
        document.removeEventListener("visibilitychange", onVis);
        reduce.removeEventListener?.("change", start);
        canvas.removeEventListener("webglcontextlost", onLost);
        scene.traverse((o) => {
          const m = o as THREE_NS.Mesh;
          m.geometry?.dispose();
          const mat = m.material as THREE_NS.Material | THREE_NS.Material[] | undefined;
          (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
        });
        haloTex.dispose();
        smokeTex?.dispose();
        farTex.forEach((x) => x.dispose());
        farGalaxies.forEach((x) => x.material.dispose());
        composer?.dispose();
        renderer.dispose();
        canvas.remove();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [anchorRef]);

  if (failed) return <>{fallback}</>;
  return <div ref={hostRef} className="nj-world" aria-hidden />;
}
