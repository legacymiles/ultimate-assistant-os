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
    ring = exp(-pow((r - uPulseAge * 2.2) * 3.0, 2.0)) * exp(-uPulseAge * 0.9) * step(0.0, uPulseAge);
    d += ring * 0.14;
    return p + n * d;
  }
`;

const POINT_VERT = /* glsl */ `
  ${COMMON}
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uSwirl;
  uniform float uRim;
  varying float vGlow;
  varying float vAlpha;
  varying float vMix;
  varying float vHeat;

  void main() {
    float seed = hash(position);
    float r = length(position);
    // Differential rotation about the galaxy's axis: inner stars orbit faster.
    float a = uSwirlT * uSwirl / max(r, 0.35);
    float s = sin(a), c = cos(a);
    vec3 q = vec3(c * position.x + s * position.z, position.y, -s * position.x + c * position.z);
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

    float big = step(0.985, seed) * 2.2;
    float twinkle = 0.6 + 0.4 * sin(uTime * (1.1 + seed * 2.3) + seed * 40.0);
    // uSize is pixels at the galaxy's centre; nearer stars grow, farther shrink.
    gl_PointSize = min(48.0, uSize * (0.5 + seed * 0.8 + big) * (1.0 + near * 0.8 + ring * 1.0) * uPixelRatio * uCamZ / -mv.z);
    vAlpha = twinkle * rim;
    vGlow = near * 0.9 + ring * 1.1 + uEnergy * 0.3 + uBreath * 0.25;
    vMix = seed;
    vHeat = smoothstep(0.9, 0.0, r);
  }
`;

const POINT_FRAG = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uHot;
  uniform float uOpacity;
  varying float vGlow;
  varying float vAlpha;
  varying float vMix;
  varying float vHeat;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float disc = smoothstep(0.5, 0.0, d);
    vec3 c = mix(uColorA, uColorB, vMix);
    c = mix(c, uHot, vHeat * 0.75) * (1.0 + vGlow);
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

const NEBULA_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const NEBULA_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying vec3 vDir;
  float h(vec3 p) { return fract(sin(dot(p, vec3(17.1, 31.7, 11.3))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(h(i), h(i + vec3(1, 0, 0)), f.x), mix(h(i + vec3(0, 1, 0)), h(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(h(i + vec3(0, 0, 1)), h(i + vec3(1, 0, 1)), f.x), mix(h(i + vec3(0, 1, 1)), h(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
  void main() {
    vec3 d = vDir * 2.2 + vec3(0.0, 0.0, uTime * 0.012);
    float n = fbm(d);
    float m = fbm(d * 1.7 + 4.0);
    vec3 c = uColorA * pow(n, 4.0) * 0.07 + uColorB * pow(m, 3.6) * 0.09;
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
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

      const CYAN = new THREE.Color("#47e8ff");
      const VIOLET = new THREE.Color("#8b7cff");
      const ICE = new THREE.Color("#c9f6ff");
      const GOLD = new THREE.Color("#ffc98a");
      const WARM = new THREE.Color("#fff1dc");
      const ROSE = new THREE.Color("#ff6fd0");
      const BLUE = new THREE.Color("#5f8bff");

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
      };

      interface Look { a: THREE_NS.Color; b: THREE_NS.Color; hot?: THREE_NS.Color; size: number; opacity: number; amp: number; swirl: number; rim?: number }
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
        galaxy_bulge: { a: GOLD, b: WARM, size: 3, opacity: 0.42, amp: 0.06, swirl: 0.22 },
        galaxy_arms: { a: CYAN, b: VIOLET, hot: GOLD, size: 3.6, opacity: 0.85, amp: 0.1, swirl: 0.14 },
        galaxy_dust: { a: VIOLET, b: ROSE, hot: VIOLET, size: 11, opacity: 0.06, amp: 0.1, swirl: 0.14 },
        galaxy_shell: { a: BLUE, b: CYAN, hot: ICE, size: 3.2, opacity: 0.95, amp: 0.2, swirl: 0.045, rim: 1 },
        galaxy_halo: { a: ICE, b: BLUE, size: 2.6, opacity: 0.55, amp: 0.16, swirl: 0.02 },
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
          const m = pointMat(looks[key] ?? looks.galaxy_halo);
          asPoints.material = m;
          asPoints.frustumCulled = false;
          pointMats.push(m);
        } else if (asMesh.isMesh) {
          asMesh.material = coreMat;
        }
      });

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

      let nebula: THREE_NS.Mesh | null = null;
      const nebulaUniforms = { uTime: shared.uTime, uColorA: { value: CYAN }, uColorB: { value: VIOLET } };
      if (tier === "high") {
        nebula = new THREE.Mesh(
          new THREE.SphereGeometry(80, 32, 16),
          new THREE.ShaderMaterial({
            vertexShader: NEBULA_VERT,
            fragmentShader: NEBULA_FRAG,
            uniforms: nebulaUniforms,
            side: THREE.BackSide,
            depthWrite: false,
          }),
        );
        scene.add(nebula);
      }

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
        // Fit the galaxy (r ≈ 2) into the shorter side of the content area.
        const box = anchorRef?.current?.getBoundingClientRect();
        const cx = box ? box.left + box.width / 2 : w / 2;
        const cy = box ? box.top + box.height / 2 : h / 2;
        const short = box ? Math.min(box.width, box.height) : Math.min(w, h);
        const fitR = 1.8 * (h / Math.max(short, 1));
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
      const onDown = () => {
        // A shockwave out from the core.
        shared.uPulseAge.value = 0;
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
      let busyLevel = 0;
      let phase = 0.15;
      let t = 0;
      let last = performance.now();
      let raf = 0;
      let probeFrames = 0;
      let probeTime = 0;
      const tiltNow = { x: 0, y: 0 };

      const draw = () => (composer ? composer.render() : renderer.render(scene, camera));

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
        // Inclined so the arms read as a spiral, rolled a little for movement.
        tilt.rotation.set(tiltNow.x + 0.52, tiltNow.y, -0.32);
        const s = 0.93 + 0.1 * shared.uBreath.value;
        spin.scale.setScalar(s);
        halo.scale.setScalar(1.15 + 0.35 * shared.uBreath.value + busyLevel * 0.35);
        spin.rotation.y += dt * (0.03 + busyLevel * 0.05);
        shared.uSwirlT.value += dt * (1 + busyLevel * 1.4 + energy * 0.5);
        stars.rotation.y += dt * 0.004;
        stars.position.set(pointer.x * 0.6 * pointer.on, pointer.y * 0.4 * pointer.on, 0);
        if (nebula) nebula.rotation.y += dt * 0.003;
        if (bloom) bloom.strength = 0.7 + 0.3 * shared.uBreath.value + 0.35 * busyLevel;
      };

      const frame = (now: number) => {
        const dt = (now - last) / 1000;
        last = now;
        step(dt);
        draw();
        // Quality probe: over the first ~2.5 s, a slow average drops bloom and
        // the nebula; still slow after that, the pixel ratio comes down too.
        probeFrames++;
        probeTime += dt;
        if (!pinned && probeTime > 2.5 && probeFrames > 3) {
          const avg = probeTime / probeFrames;
          if (avg > 0.024 && quality > 0) {
            quality--;
            tier = "low";
            composer = null;
            if (nebula) nebula.visible = false;
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
