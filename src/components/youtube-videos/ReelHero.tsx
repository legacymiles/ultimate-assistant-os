"use client";

// ---------------------------------------------------------------------------
// The Holo Deck — YouTube videos' live hero (blender-to-web tier 1, layered
// the scroll-craft way).
//
// Blender (tools/youtube-videos-hero/build_hero.py, direction "holo") owns the
// shapes: a ring of glass screens round a play-prism core, glowing frames and
// two orbit rings, exported as a Draco GLB with stable names:
//   core · tile_NN (+ _screen, _glow) · orbit_0/1 · fleck_NN
// The browser owns everything alive:
//   • backdrop   a shader: holographic grid floor rolling toward you, stars,
//                horizon glow, ripples where the pointer is
//   • the ring   drag (or swipe) to spin it, with inertia; it idles in a slow
//                attract spin; each screen wears one of your saved videos
//   • hover      the screen lifts, its frame flares, a HUD callout names it
//   • click      a screen plays that video (onOpen); an empty one asks for a link
//   • feed()     a link you just saved flies out of the paste box into the ring
//   • scroll     the camera pulls back and the ring tips away into the list
//   • bloom      frames, orbits and core glow (desktop GPUs; phones skip it)
// Robust: pauses offscreen / hidden tab, survives context loss, poster with no
// WebGL. Reduced motion: no idle motion or flights, frames drawn on demand.
// ---------------------------------------------------------------------------

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export interface ReelItem {
  id: string;
  title: string;
  platform: string;
  thumb?: string;
}

export interface ReelHeroHandle {
  /** A link was saved: fly a screen in from this screen point (client px). */
  feed: (clientX: number, clientY: number) => void;
}

interface Props {
  glb: string;
  poster: string;
  posterPhone: string;
  /** The newest saved videos, newest first; one per screen. */
  items: ReelItem[];
  /** Scroll progress through the hero, 0 → 1, read every frame. */
  progress: React.MutableRefObject<number>;
  /** World-space nudge right (desktop puts the ring right of the copy). */
  shift: number;
  onOpen: (id: string) => void;
  /** An empty screen was clicked. */
  onEmpty: () => void;
}

const RIG = [
  { pos: [3.5, 3.4, 3.0], color: "#ffd6c8", power: 30 },
  { pos: [-3.8, 1.6, -2.5], color: "#3be3ff", power: 44 },
  { pos: [0, -0.4, 4.8], color: "#a67bff", power: 10 },
] as const;

// ---- backdrop shader --------------------------------------------------------
const BACK_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`;
const BACK_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uRes;
uniform vec2 uPointer;
uniform float uScroll;
uniform float uPulse;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec3 col = mix(vec3(0.012, 0.014, 0.03), vec3(0.03, 0.025, 0.06), uv.y);

  // stars, twinkling, thinner toward the horizon
  vec2 sp = uv * vec2(aspect, 1.0) * 140.0;
  vec2 cell = floor(sp);
  float h = hash(cell);
  float star = step(0.985, h) * smoothstep(0.5, 0.0, length(fract(sp) - 0.5)) * (0.5 + 0.5 * sin(uTime * (1.0 + h * 3.0) + h * 40.0));
  col += vec3(0.7, 0.85, 1.0) * star * smoothstep(0.35, 0.9, uv.y) * 0.8;

  // horizon glow (coral + cyan), breathes with the pulse
  float horizon = 0.36 + uScroll * 0.12;
  float hg = exp(-abs(uv.y - horizon) * 9.0);
  col += vec3(1.0, 0.3, 0.24) * hg * (0.10 + uPulse * 0.25);
  col += vec3(0.23, 0.89, 1.0) * exp(-abs(uv.y - horizon) * 30.0) * 0.12;

  // perspective grid floor below the horizon, rolling toward the viewer
  if (uv.y < horizon) {
    float d = (horizon - uv.y);
    float z = 0.35 / max(d, 0.002);
    float x = (uv.x - 0.5) * aspect * z;
    // ripple where the pointer is
    vec2 pp = vec2((uPointer.x * 0.5) * aspect * z, 0.0);
    float rip = sin(length(vec2(x, z) - vec2(pp.x, 3.0)) * 3.0 - uTime * 3.0) * 0.06 * exp(-length(vec2(x - pp.x, 0.0)) * 0.3);
    float gz = fract(z * 0.9 - uTime * 0.55 + rip);
    float gx = fract(x * 0.9 + rip);
    float lineZ = smoothstep(0.06 * z * 0.12, 0.0, min(gz, 1.0 - gz));
    float lineX = smoothstep(0.035 * z * 0.12, 0.0, min(gx, 1.0 - gx));
    float fade = smoothstep(0.0, 0.25, d) * exp(-z * 0.06);
    col += vec3(0.23, 0.89, 1.0) * (lineZ + lineX) * fade * 0.55;
    // a scan sweep across the floor
    float sweep = exp(-pow(fract(uTime * 0.12) * 1.4 - (1.0 - d / horizon), 2.0) * 120.0);
    col += vec3(0.23, 0.89, 1.0) * sweep * fade * 0.35;
  }

  // vignette + faint scanlines
  vec2 c = uv - 0.5;
  col *= 1.0 - dot(c, c) * 0.9;
  col *= 0.97 + 0.03 * sin(uv.y * uRes.y * 1.5);
  gl_FragColor = vec4(col, 1.0);
}
`;

type Tile = {
  obj: THREE.Object3D;
  base: number; // angle on the ring
  radius: number;
  y: number;
  tilt: number;
  screen?: THREE.Mesh;
  glow?: THREE.Mesh;
  glowBase: number;
  lift: number; // hover spring
  liftV: number;
  index: number;
};

function webglOk(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export const ReelHero = forwardRef<ReelHeroHandle, Props>(function ReelHero({ glb, poster, posterPhone, items, progress, shift, onOpen, onEmpty }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const callout = useRef<HTMLDivElement>(null);
  const calloutKicker = useRef<HTMLSpanElement>(null);
  const calloutTitle = useRef<HTMLSpanElement>(null);
  const reticle = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "live" | "poster">("loading");
  const api = useRef<{ feed: (x: number, y: number) => void; items: (t: ReelItem[]) => void; shift: (s: number) => void } | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Read when the scene is built: a prop that arrived before the GLB loaded
  // must still apply (it was being dropped, leaving the ring centred).
  const shiftRef = useRef(shift);
  shiftRef.current = shift;
  const cb = useRef({ onOpen, onEmpty });
  cb.current = { onOpen, onEmpty };

  useImperativeHandle(ref, () => ({ feed: (x, y) => api.current?.feed(x, y) }), []);
  useEffect(() => api.current?.items(items), [items]);
  useEffect(() => api.current?.shift(shift), [shift]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (!webglOk()) {
      setState("poster");
      return;
    }
    const hostEl: HTMLDivElement = el;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const lowTier = coarse || (navigator.hardwareConcurrency ?? 8) <= 4;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: !lowTier, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowTier ? 1.5 : 2));
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor("#05060a");
    renderer.domElement.className = "ytv-canvas";
    renderer.domElement.setAttribute("aria-hidden", "true");
    el.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.4;
    for (const l of RIG) {
      const light = new THREE.PointLight(l.color, l.power, 0, 2);
      light.position.set(l.pos[0], l.pos[1], l.pos[2]);
      scene.add(light);
    }
    scene.add(new THREE.AmbientLight("#1a1d2b", 0.7));

    // backdrop: a full-screen quad drawn first, behind everything
    const backMat = new THREE.ShaderMaterial({
      vertexShader: BACK_VERT,
      fragmentShader: BACK_FRAG,
      depthWrite: false,
      depthTest: false,
      uniforms: { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uPointer: { value: new THREE.Vector2() }, uScroll: { value: 0 }, uPulse: { value: 0 } },
    });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backMat);
    back.frustumCulled = false;
    back.renderOrder = -1;
    scene.add(back);

    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 80);
    const camRest = new THREE.Vector3(0, 2.0, 8.2);
    camera.position.copy(camRest);
    camera.lookAt(0, 0.05, 0);

    const world = new THREE.Group();
    scene.add(world);
    const deck = new THREE.Group(); // the ring spins inside this
    world.add(deck);
    let shiftTarget = shiftRef.current;
    let shiftX = shiftTarget;

    // post: bloom on capable GPUs only
    let composer: EffectComposer | null = null;
    let bloom: UnrealBloomPass | null = null;
    if (!lowTier) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.78);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
    }

    let core: THREE.Object3D | null = null;
    const orbits: THREE.Object3D[] = [];
    const tiles: Tile[] = [];
    const flecks: { obj: THREE.Object3D; rest: THREE.Vector3; i: number }[] = [];
    const texLoader = new THREE.TextureLoader();
    texLoader.setCrossOrigin("anonymous");
    const texCache = new Map<string, THREE.Texture>();
    let shown: ReelItem[] = [];

    // motion state
    const ptr = { x: 0, y: 0, sx: 0, sy: 0 };
    let spin = 0;
    let spinV = reduced ? 0 : 0.12;
    let pulse = 0;
    let pulseV = 0;
    let scrollP = 0;
    let hovered: Tile | null = null;
    let lastInput = performance.now();
    const flights: { tile: Tile; from: THREE.Vector3; t: number }[] = [];
    let spinTo: number | null = null;
    let calloutFor = -1;
    let dragging = false;

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      composer?.setSize(w, h);
      bloom?.setSize(w, h);
      backMat.uniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
      camera.aspect = w / h;
      // keep the whole ring across a tall phone (~44° wide), lifted above the copy
      const minH = THREE.MathUtils.degToRad(44);
      const vFromH = 2 * Math.atan(Math.tan(minH / 2) / camera.aspect);
      camera.fov = THREE.MathUtils.radToDeg(Math.max(THREE.MathUtils.degToRad(27), vFromH));
      camera.updateProjectionMatrix();
      // On a phone the copy sits low, so the picture is moved up like a lens
      // shift: the view angle stays the same (moving the objects instead
      // turned the floor ring edge-on into a stray line).
      const lens = camera.aspect < 0.9 ? 0.2 : camera.aspect < 1.3 ? 0.08 : 0;
      if (lens) camera.setViewOffset(w, h, 0, h * lens, w, h);
      else camera.clearViewOffset();
      draw();
    };

    const applyItems = (list: ReelItem[]) => {
      shown = list.slice(0, tiles.length);
      tiles.forEach((t, i) => {
        const it = shown[i];
        const mat = t.screen?.material as THREE.MeshStandardMaterial | undefined;
        if (!mat) return;
        if (!it?.thumb) {
          mat.map = null;
          mat.emissiveMap = null;
          mat.emissiveIntensity = it ? 1.2 : 0.35; // an empty screen is dim: room for one more
          mat.needsUpdate = true;
          return;
        }
        const use = (tex: THREE.Texture) => {
          if (disposed) return;
          mat.map = tex;
          mat.emissiveMap = tex;
          mat.emissive.set("#ffffff");
          mat.emissiveIntensity = 0.9;
          mat.color.set("#ffffff");
          mat.needsUpdate = true;
          draw();
        };
        const cached = texCache.get(it.thumb);
        if (cached) return use(cached);
        texLoader.load(
          it.thumb,
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.flipY = false;
            // hqdefault is 4:3 with letterbox bars; show the 16:9 middle
            tex.repeat.set(1, 0.75);
            tex.offset.set(0, 0.125);
            tex.anisotropy = 4;
            texCache.set(it.thumb!, tex);
            use(tex);
          },
          undefined,
          () => {
            /* a thumbnail that won't load keeps the screen's colour */
          },
        );
      });
    };

    // where tile i sits right now
    const posOf = (t: Tile, out: THREE.Vector3) => {
      const a = t.base + spin;
      return out.set(Math.sin(a) * t.radius, t.y, Math.cos(a) * t.radius);
    };

    // screen point → a point in the deck's space, in front of the ring
    const unproject = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector3(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1, 0.5);
      ndc.unproject(camera);
      const dir = ndc.sub(camera.position).normalize();
      const dist = (3.2 - camera.position.z) / dir.z;
      return deck.worldToLocal(camera.position.clone().add(dir.multiplyScalar(dist)));
    };

    const tmp = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();
    function pose(dt: number, time: number) {
      const k = Math.min(1, dt * 6);
      ptr.sx += (ptr.x - ptr.sx) * k;
      ptr.sy += (ptr.y - ptr.sy) * k;
      // springs
      pulseV += (-90 * pulse - 9 * pulseV) * dt;
      pulse += pulseV * dt;
      shiftX += (shiftTarget - shiftX) * Math.min(1, dt * 4);
      world.position.set(shiftX, 0, 0);
      world.scale.setScalar(shiftTarget > 0 ? 0.88 : 1); // beside the copy on desktop, a touch smaller
      scrollP = THREE.MathUtils.clamp(progress.current, 0, 1);
      const p = scrollP;
      const idle = reduced ? 0 : 1;

      // spin: drag/flick inertia, then settle into a slow attract spin
      if (spinTo !== null) {
        const d = Math.atan2(Math.sin(spinTo - spin), Math.cos(spinTo - spin));
        spinV = d * 5;
        if (Math.abs(d) < 0.002) spinTo = null;
      } else if (!dragging) {
        const attract = reduced || hovered || performance.now() - lastInput < 2500 ? 0 : 0.14;
        spinV += (attract - spinV) * Math.min(1, dt * 0.9);
      }
      spin += spinV * dt;

      // camera: pull back and up as you scroll, parallax with the pointer
      camera.position.set(camRest.x + ptr.sx * 0.35, camRest.y + p * 1.6 - ptr.sy * 0.25, camRest.z + p * 3.2);
      camera.lookAt(0, 0.05 - p * 0.4, 0);
      deck.rotation.x = p * 0.5;

      if (core) {
        core.rotation.y = time * 0.6 * idle + ptr.sx * 0.4;
        core.rotation.x = -ptr.sy * 0.25;
        core.position.y = Math.sin(time * 0.9) * 0.05 * idle;
        const s = 1 + pulse * 0.4 - p * 0.15;
        core.scale.setScalar(s);
      }
      orbits.forEach((o, i) => {
        o.rotation.z += dt * (i ? 0.6 : 0.12) * (idle || 0) * (i ? 1 : -1);
      });

      for (const t of tiles) {
        const target = hovered === t ? 1 : 0;
        t.liftV += (220 * (target - t.lift) - 20 * t.liftV) * dt;
        t.lift += t.liftV * dt;
        posOf(t, tmp);
        tmp.y += Math.sin(time * 0.8 + t.index * 1.7) * 0.04 * idle - p * (0.8 + (t.index % 3) * 0.35) + t.lift * 0.18;
        t.obj.position.copy(tmp);
        t.obj.rotation.set(t.tilt - p * 0.6, t.base + spin, 0);
        t.obj.scale.setScalar(1 + t.lift * 0.14);
        const g = t.glow?.material as THREE.MeshStandardMaterial | undefined;
        if (g) g.emissiveIntensity = t.glowBase * (0.55 + t.lift * 1.6 + pulse * 0.8);
      }
      for (const f of flecks) {
        f.obj.position.set(f.rest.x + ptr.sx * 0.5, f.rest.y + Math.sin(time * 0.4 + f.i) * 0.07 * idle - ptr.sy * 0.3 + p * 0.8, f.rest.z);
      }
      for (let n = flights.length - 1; n >= 0; n--) {
        const fl = flights[n];
        fl.t = Math.min(1, fl.t + dt / 0.95);
        const e = 1 - Math.pow(1 - fl.t, 3);
        const to = fl.tile.obj.position.clone();
        fl.tile.obj.position.lerpVectors(fl.from, to, e);
        fl.tile.obj.position.y += Math.sin(e * Math.PI) * 0.8;
        fl.tile.obj.rotation.z = (1 - e) * 3.0;
        fl.tile.obj.scale.multiplyScalar(0.3 + 0.7 * e);
        if (fl.t >= 1) {
          flights.splice(n, 1);
          pulseV += 7;
        }
      }
      backMat.uniforms.uTime.value = time;
      backMat.uniforms.uPointer.value.set(ptr.sx, ptr.sy);
      backMat.uniforms.uScroll.value = p;
      backMat.uniforms.uPulse.value = Math.max(0, pulse);

      // HUD: the reticle rides the core, the callout rides the hovered screen
      const r = hostEl.getBoundingClientRect();
      if (reticle.current && core) {
        core.getWorldPosition(tmp2).project(camera);
        reticle.current.style.transform = `translate3d(${((tmp2.x + 1) / 2) * r.width}px, ${((1 - tmp2.y) / 2) * r.height}px, 0) translate(-50%, -50%) scale(${1 - p * 0.3})`;
      }
      if (callout.current) {
        if (hovered && hovered.index !== calloutFor) {
          calloutFor = hovered.index;
          const it = shown[hovered.index];
          if (calloutKicker.current) calloutKicker.current.textContent = it ? `${it.platform.toUpperCase()} · #${String(hovered.index + 1).padStart(2, "0")}` : "EMPTY SLOT";
          if (calloutTitle.current) calloutTitle.current.textContent = it ? it.title : "Paste a link to fill it";
        }
        if (hovered) {
          hovered.obj.getWorldPosition(tmp2);
          tmp2.y += 0.42;
          tmp2.project(camera);
          callout.current.style.transform = `translate3d(${((tmp2.x + 1) / 2) * r.width}px, ${((1 - tmp2.y) / 2) * r.height}px, 0)`;
          callout.current.dataset.on = "true";
        } else {
          callout.current.dataset.on = "false";
          calloutFor = -1;
        }
      }
    }

    function draw() {
      if (disposed) return;
      pose(0, clock);
      if (composer) composer.render();
      else renderer.render(scene, camera);
    }

    let raf = 0;
    let last = performance.now();
    let running = false;
    let onScreen = true;
    let clock = 0;
    const frame = (now: number) => {
      raf = 0;
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!reduced) clock += dt;
      pose(dt / 2, clock);
      pose(dt / 2, clock);
      if (composer) composer.render();
      else renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (running || disposed || !onScreen || document.hidden) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    // Reduced motion: frames run only while something is settling.
    let settleUntil = 0;
    const settle = (ms = 900) => {
      if (!reduced) return;
      settleUntil = Math.max(settleUntil, performance.now() + ms);
      start();
      window.setTimeout(() => performance.now() >= settleUntil && stop(), ms + 30);
    };

    // ---- pointer: hover, drag-to-spin, click-to-play --------------------------
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pick = (cx: number, cy: number): Tile | null => {
      const r = el.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(tiles.map((t) => t.obj), true);
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        while (o && !tiles.some((t) => t.obj === o)) o = o.parent;
        const t = tiles.find((x) => x.obj === o);
        // only screens facing the viewer count
        if (t && Math.cos(t.base + spin) > -0.15) return t;
      }
      return null;
    };
    let downX = 0;
    let downY = 0;
    let lastX = 0;
    let lastT = 0;
    let moved = 0;
    const canvas = renderer.domElement;
    const onDown = (e: PointerEvent) => {
      downX = lastX = e.clientX;
      downY = e.clientY;
      lastT = performance.now();
      moved = 0;
      dragging = true;
      spinTo = null;
      lastInput = performance.now();
    };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ptr.x = THREE.MathUtils.clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      ptr.y = THREE.MathUtils.clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
      lastInput = performance.now();
      if (dragging && (e.buttons || e.pointerType !== "mouse")) {
        const dx = e.clientX - lastX;
        const now = performance.now();
        moved = Math.max(moved, Math.abs(e.clientX - downX), Math.abs(e.clientY - downY));
        if (Math.abs(e.clientX - downX) > 4) {
          const d = (dx / Math.max(1, r.width)) * Math.PI * 1.6;
          spin += d;
          spinV = d / Math.max(0.008, (now - lastT) / 1000);
          canvas.style.cursor = "grabbing";
        }
        lastX = e.clientX;
        lastT = now;
      } else if (e.pointerType === "mouse") {
        const t = pick(e.clientX, e.clientY);
        hovered = t;
        canvas.style.cursor = t ? "pointer" : "grab";
      }
      settle();
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      canvas.style.cursor = hovered ? "pointer" : "grab";
      spinV = THREE.MathUtils.clamp(spinV, -6, 6);
      if (moved < 6) {
        const t = pick(e.clientX, e.clientY);
        if (t) {
          const it = shown[t.index];
          // bring it to the front, then play it
          spinTo = -t.base;
          if (it) cb.current.onOpen(it.id);
          else cb.current.onEmpty();
        }
      }
      settle(1400);
    };
    // A vertical swipe hands the touch to the page scroll (touch-action: pan-y);
    // the browser cancels the pointer, so stop dragging instead of spinning on.
    const onCancel = () => {
      dragging = false;
      spinV = THREE.MathUtils.clamp(spinV, -2, 2);
      settle(600);
    };
    const onLeave = () => {
      hovered = null;
      ptr.x = 0;
      ptr.y = 0;
    };
    canvas.style.cursor = "grab";
    canvas.style.touchAction = "pan-y"; // vertical swipes still scroll the page
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("pointerleave", onLeave);

    // ---- load the Blender asset -------------------------------------------
    const draco = new DRACOLoader();
    draco.setDecoderPath("/youtube-videos/draco/");
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.load(
      glb,
      (gltf) => {
        if (disposed) return;
        const root = gltf.scene;
        const found: THREE.Object3D[] = [];
        root.traverse((o) => found.push(o));
        for (const o of found) {
          if (o.name === "core") {
            core = o;
            deck.add(o); // add, not attach: keep Blender's local placement whatever the group's offset
          }
          if (/^orbit_\d$/.test(o.name)) {
            orbits.push(o);
            deck.add(o); // add, not attach: keep Blender's local placement whatever the group's offset
          }
          const tm = /^tile_(\d+)$/.exec(o.name);
          if (tm) {
            const screen = o.children.find((c) => c instanceof THREE.Mesh && /_screen$/.test(c.name)) as THREE.Mesh | undefined;
            const glow = o.children.find((c) => c instanceof THREE.Mesh && /_glow$/.test(c.name)) as THREE.Mesh | undefined;
            if (screen) screen.material = (screen.material as THREE.Material).clone();
            if (glow) glow.material = (glow.material as THREE.Material).clone();
            tiles.push({
              obj: o,
              base: Math.atan2(o.position.x, o.position.z),
              radius: Math.hypot(o.position.x, o.position.z),
              y: o.position.y,
              tilt: o.rotation.x,
              screen,
              glow,
              glowBase: (glow?.material as THREE.MeshStandardMaterial | undefined)?.emissiveIntensity ?? 1,
              lift: 0,
              liftV: 0,
              index: Number(tm[1]),
            });
            deck.add(o); // add, not attach: keep Blender's local placement whatever the group's offset
          }
          const fm = /^fleck_(\d+)$/.exec(o.name);
          if (fm) {
            flecks.push({ obj: o, rest: o.position.clone(), i: Number(fm[1]) });
            world.add(o);
          }
          if (o instanceof THREE.Mesh) {
            const m = o.material as THREE.MeshPhysicalMaterial;
            if (lowTier && m.transmission) {
              m.transmission = 0;
              m.transparent = true;
              m.opacity = 0.9;
            }
          }
        }
        // ring order: index 0 is the newest save, sitting at the front
        tiles.sort((a, b) => a.index - b.index);
        tiles.forEach((t, i) => (t.index = i));
        applyItems(itemsRef.current);
        resize();
        void renderer.compileAsync(scene, camera).then(() => {
          if (disposed) return;
          setState("live");
          if (reduced) {
            draw();
            settle(300);
          } else start();
        });
      },
      undefined,
      () => !disposed && setState("poster"),
    );

    api.current = {
      items: (list) => {
        applyItems(list);
        if (reduced) settle(200);
      },
      shift: (s) => {
        shiftTarget = s;
        settle();
      },
      feed: (cx, cy) => {
        const tile = tiles[0];
        if (!tile) return;
        spinTo = -tile.base;
        lastInput = performance.now();
        if (reduced) {
          settle(1200);
          return;
        }
        flights.push({ tile, from: unproject(cx, cy), t: 0 });
        start();
      },
    };

    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      if (onScreen && !reduced) start();
      else if (!onScreen) stop();
    });
    io.observe(el);
    const onVis = () => (document.hidden ? stop() : !reduced && start());
    document.addEventListener("visibilitychange", onVis);
    const onLost = (e: Event) => {
      e.preventDefault();
      stop();
      setState("poster");
    };
    canvas.addEventListener("webglcontextlost", onLost);
    const scroller = el.closest(".ytv-scroll");
    const onScroll = () => settle(400);
    scroller?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      disposed = true;
      stop();
      api.current = null;
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVis);
      scroller?.removeEventListener("scroll", onScroll);
      canvas.removeEventListener("webglcontextlost", onLost);
      draco.dispose();
      pmrem.dispose();
      composer?.dispose();
      texCache.forEach((t) => t.dispose());
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      canvas.remove();
    };
    // glb is fixed for the page's life; items/shift arrive through api.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glb]);

  return (
    <div ref={host} className="ytv-reel" data-state={state}>
      <picture>
        <source media="(max-width: 819px)" srcSet={posterPhone} />
        <img className="ytv-poster" src={poster} alt="" aria-hidden draggable={false} />
      </picture>
      <div ref={reticle} className="ytv-reticle" aria-hidden>
        <span />
        <span />
      </div>
      <div ref={callout} className="ytv-callout" data-on="false" aria-hidden>
        <span className="ytv-callout-inner">
          <span ref={calloutKicker} className="ytv-callout-kicker" />
          <span ref={calloutTitle} className="ytv-callout-title" />
        </span>
      </div>
    </div>
  );
});
