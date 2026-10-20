"use client";

// ---------------------------------------------------------------------------
// The Reel — the YouTube videos hero's live 3D layer (blender-to-web, tier 1).
//
// The asset is modeled in Blender (tools/youtube-videos-hero/build_hero.py)
// and exported as a Draco GLB with stable part names:
//   core          the play prism        → breathes, turns toward the pointer
//   tile_NN       one per saved video   → wears that video's thumbnail, leans
//                                          toward the pointer, deals on scroll
//   fleck_NN      the near plane        → moves most with the pointer
//
// Blender owns the shapes and materials; the browser owns the response.
// Cycles light doesn't survive glTF, so the rig from the build script is
// rebuilt here (key / rim / fill, same colours and positions).
//
// Signature move: feed(x, y) — the link you just pasted becomes a tile that
// leaves the paste box at that screen point and flies into the reel.
//
// Robustness: pauses offscreen and in a hidden tab, handles WebGL context
// loss, falls back to the rendered poster with no WebGL. Reduced motion keeps
// the renderer but draws settled frames only (no idle motion, no flights).
// ---------------------------------------------------------------------------

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export interface ReelHeroHandle {
  /** A link was saved: fly a tile in from this screen point (client px). */
  feed: (clientX: number, clientY: number) => void;
}

interface Props {
  glb: string;
  poster: string;
  /** Portrait render for phones. */
  posterPhone: string;
  /** Thumbnails of the newest saved videos, newest first. */
  thumbs: string[];
  /** Scroll progress through the hero, 0 → 1, read every frame. */
  progress: React.MutableRefObject<number>;
  /** Where the centerpiece sits horizontally: 0 centre, + right (desktop puts it right of the copy). */
  shift: number;
}

const RIG = [
  { pos: [3.5, 3.2, 3.0], color: "#ffd6c8", power: 34 },
  { pos: [-3.8, 1.5, -2.5], color: "#3fd6ff", power: 40 },
  { pos: [0, -0.5, 4.5], color: "#9a7bff", power: 9 },
] as const;

type Part = { obj: THREE.Object3D; rest: { p: THREE.Vector3; r: THREE.Euler; s: THREE.Vector3 }; depth: number; i: number };

interface Spring {
  x: number;
  v: number;
}
const spring = (s: Spring, target: number, dt: number, k = 70, c = 14) => {
  const a = -k * (s.x - target) - c * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
};

function webglOk(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export const ReelHero = forwardRef<ReelHeroHandle, Props>(function ReelHero({ glb, poster, posterPhone, thumbs, progress, shift }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "live" | "poster">("loading");
  const api = useRef<{ feed: (x: number, y: number) => void; thumbs: (t: string[]) => void; shift: (s: number) => void } | null>(null);
  const thumbsRef = useRef(thumbs);
  thumbsRef.current = thumbs;

  useImperativeHandle(ref, () => ({ feed: (x, y) => api.current?.feed(x, y) }), []);
  useEffect(() => api.current?.thumbs(thumbs), [thumbs]);
  useEffect(() => api.current?.shift(shift), [shift]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (!webglOk()) {
      setState("poster");
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: !coarse, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "ytv-canvas";
    renderer.domElement.setAttribute("aria-hidden", "true");
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
    for (const l of RIG) {
      const light = new THREE.PointLight(l.color, l.power, 0, 2);
      light.position.set(l.pos[0], l.pos[1], l.pos[2]);
      scene.add(light);
    }
    scene.add(new THREE.AmbientLight("#1a1d2b", 0.6));

    const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 60);
    camera.position.set(0, 0.55, 7.6);
    camera.lookAt(0, 0.05, 0);

    const world = new THREE.Group();
    scene.add(world);
    let shiftX = 0;
    let shiftTarget = 0;
    let liftTarget = 0;

    let core: Part | null = null;
    const tiles: Part[] = [];
    const flecks: Part[] = [];
    const screens: THREE.Mesh[] = [];
    const texLoader = new THREE.TextureLoader();
    texLoader.setCrossOrigin("anonymous");
    const texCache = new Map<string, THREE.Texture>();

    // pointer, scroll and pulse state
    const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
    const sx: Spring = { x: 0, v: 0 };
    const sy: Spring = { x: 0, v: 0 };
    const pulse: Spring = { x: 0, v: 0 };
    let scrollP = 0;
    const flights: { part: Part; from: THREE.Vector3; t: number }[] = [];
    let shown = 0;

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Keep the whole reel across a tall phone (~38° wide is enough for it)
      // and lift it into the space above the copy, which sits low on a phone.
      const minH = THREE.MathUtils.degToRad(38);
      const vFromH = 2 * Math.atan(Math.tan(minH / 2) / camera.aspect);
      camera.fov = THREE.MathUtils.radToDeg(Math.max(THREE.MathUtils.degToRad(26), vFromH));
      liftTarget = camera.aspect < 0.9 ? 1.55 : camera.aspect < 1.3 ? 0.6 : 0;
      camera.updateProjectionMatrix();
      draw();
    };

    const applyThumbs = (list: string[]) => {
      shown = Math.max(3, Math.min(tiles.length, list.length || 3));
      tiles.forEach((t, i) => {
        t.obj.visible = i < shown;
        const scr = screens[i];
        if (!scr) return;
        const url = list[i];
        const mat = scr.material as THREE.MeshStandardMaterial;
        if (!url) {
          if (mat.map) {
            mat.map = null;
            mat.emissiveMap = null;
            mat.needsUpdate = true;
          }
          return;
        }
        const use = (tex: THREE.Texture) => {
          if (disposed) return;
          mat.map = tex;
          mat.emissiveMap = tex;
          mat.emissive.set("#ffffff");
          mat.emissiveIntensity = 0.85;
          mat.color.set("#ffffff");
          mat.needsUpdate = true;
          draw();
        };
        const cached = texCache.get(url);
        if (cached) return use(cached);
        texLoader.load(
          url,
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.flipY = false;
            // hqdefault is 4:3 with letterbox bars; crop to the 16:9 middle.
            tex.repeat.set(1, 0.75);
            tex.offset.set(0, 0.125);
            tex.anisotropy = 4;
            texCache.set(url, tex);
            use(tex);
          },
          undefined,
          () => {
            /* a thumbnail that won't load (CORS, private) keeps the tile's colour */
          },
        );
      });
    };

    // Screen point → a point in the world, on the plane the reel sits on.
    const unproject = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector3(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1, 0.5);
      ndc.unproject(camera);
      const dir = ndc.sub(camera.position).normalize();
      const dist = (1.5 - camera.position.z) / dir.z; // plane in front of the core
      return world.worldToLocal(camera.position.clone().add(dir.multiplyScalar(dist)));
    };

    let raf = 0;
    let last = performance.now();
    let running = false;
    let onScreen = true;
    let t0 = 0;

    function pose(dt: number, time: number) {
      // pointer springs (fixed step, capped)
      spring(sx, ptr.tx, dt, 38, 11);
      spring(sy, ptr.ty, dt, 38, 11);
      spring(pulse, 0, dt, 120, 9);
      shiftX += (shiftTarget - shiftX) * Math.min(1, dt * 4);
      world.position.x = shiftX;
      world.position.y = liftTarget;
      const p = THREE.MathUtils.clamp(scrollP, 0, 1);
      const idle = reduced ? 0 : 1;

      if (core) {
        const c = core.obj;
        c.position.copy(core.rest.p);
        c.position.y += Math.sin(time * 0.9) * 0.05 * idle + p * 0.6;
        c.rotation.set(core.rest.r.x + sy.x * -0.35, core.rest.r.y + sx.x * 0.55 + Math.sin(time * 0.5) * 0.08 * idle, core.rest.r.z);
        const s = 1 + pulse.x * 0.35 - p * 0.25;
        c.scale.copy(core.rest.s).multiplyScalar(s);
      }
      for (const t of tiles) {
        if (!t.obj.visible) continue;
        const o = t.obj;
        const lean = 0.25 + t.depth * 0.25;
        o.position.copy(t.rest.p);
        o.position.x += sx.x * 0.18 * t.depth + p * (t.rest.p.x >= 0 ? 1 : -1) * (0.6 + t.i * 0.08);
        o.position.y += Math.sin(time * 0.7 + t.i * 1.3) * 0.045 * idle - p * (1.4 + t.i * 0.12) + sy.x * 0.12 * t.depth;
        o.rotation.set(t.rest.r.x - sy.x * lean * 0.6 + p * 0.9, t.rest.r.y + sx.x * lean, t.rest.r.z);
        o.scale.copy(t.rest.s);
      }
      for (const f of flecks) {
        const o = f.obj;
        o.position.copy(f.rest.p);
        o.position.x += sx.x * 0.55;
        o.position.y += sy.x * 0.4 + Math.sin(time * 0.4 + f.i) * 0.06 * idle + p * 0.9;
      }
      // flights override their tile until they land
      for (let k = flights.length - 1; k >= 0; k--) {
        const fl = flights[k];
        fl.t = Math.min(1, fl.t + dt / 0.9);
        const e = 1 - Math.pow(1 - fl.t, 3);
        const o = fl.part.obj;
        const to = o.position.clone();
        const arc = Math.sin(e * Math.PI) * 0.9;
        o.position.lerpVectors(fl.from, to, e);
        o.position.y += arc;
        o.rotation.z += (1 - e) * 2.4;
        o.scale.multiplyScalar(0.35 + 0.65 * e);
        if (fl.t >= 1) {
          flights.splice(k, 1);
          pulse.v += 6;
        }
      }
    }

    function draw() {
      if (disposed) return;
      pose(0, t0);
      renderer.render(scene, camera);
    }

    const frame = (now: number) => {
      raf = 0;
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t0 += dt;
      scrollP = progress.current;
      // two sub-steps keep the springs stable at low frame rates
      pose(dt / 2, t0);
      pose(dt / 2, t0);
      renderer.render(scene, camera);
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

    // Reduced motion: no loop. Settle and draw when something changes.
    let settleRaf = 0;
    const settle = () => {
      if (settleRaf) return;
      settleRaf = requestAnimationFrame(() => {
        settleRaf = 0;
        scrollP = progress.current;
        sx.x = sx.v = sy.x = sy.v = pulse.x = pulse.v = 0;
        shiftX = shiftTarget;
        pose(0, 0);
        renderer.render(scene, camera);
      });
    };

    const draco = new DRACOLoader();
    draco.setDecoderPath("/youtube-videos/draco/");
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.load(
      glb,
      (gltf) => {
        if (disposed) return;
        world.add(gltf.scene);
        gltf.scene.traverse((o) => {
          const rest = { p: o.position.clone(), r: o.rotation.clone(), s: o.scale.clone() };
          if (o.name === "core") core = { obj: o, rest, depth: 1, i: 0 };
          const tm = /^tile_(\d+)$/.exec(o.name);
          if (tm) tiles.push({ obj: o, rest, depth: THREE.MathUtils.clamp(1 + o.position.z * 0.35, 0.3, 1.6), i: Number(tm[1]) });
          const fm = /^fleck_(\d+)$/.exec(o.name);
          if (fm) flecks.push({ obj: o, rest, depth: 2, i: Number(fm[1]) });
          if (o instanceof THREE.Mesh) {
            const m = o.material as THREE.MeshPhysicalMaterial;
            if (coarse && m.transmission) {
              // Transmission is the expensive part on a phone GPU.
              m.transmission = 0;
              m.transparent = true;
              m.opacity = 0.88;
            }
          }
        });
        tiles.sort((a, b) => a.i - b.i);
        // Newest saves sit nearest the camera.
        const byDepth = [...tiles].sort((a, b) => b.rest.p.z - a.rest.p.z);
        byDepth.forEach((t) => {
          const scr = t.obj.children.find((c) => c instanceof THREE.Mesh && /_screen$/.test(c.name)) as THREE.Mesh | undefined;
          if (scr) {
            scr.material = (scr.material as THREE.Material).clone();
            screens.push(scr);
          }
        });
        tiles.splice(0, tiles.length, ...byDepth);
        applyThumbs(thumbsRef.current);
        resize();
        void renderer.compileAsync(scene, camera).then(() => {
          if (disposed) return;
          setState("live");
          if (reduced) settle();
          else start();
        });
      },
      undefined,
      () => !disposed && setState("poster"),
    );

    api.current = {
      thumbs: (list) => applyThumbs(list),
      shift: (s) => {
        shiftTarget = s;
        if (reduced) settle();
      },
      feed: (cx, cy) => {
        // The newest save is tiles[0] (nearest the camera) once thumbs update.
        const part = tiles[0];
        if (!part) return;
        if (reduced) {
          settle();
          return;
        }
        flights.push({ part, from: unproject(cx, cy), t: 0 });
        start();
      },
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || reduced) return;
      const r = el.getBoundingClientRect();
      ptr.tx = THREE.MathUtils.clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      ptr.ty = THREE.MathUtils.clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
    };
    const onLeave = () => {
      ptr.tx = 0;
      ptr.ty = 0;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      if (onScreen && !reduced) start();
      else stop();
    });
    io.observe(el);
    const onVis = () => (document.hidden ? stop() : !reduced && start());
    document.addEventListener("visibilitychange", onVis);
    const onLost = (e: Event) => {
      e.preventDefault();
      stop();
      setState("poster");
    };
    renderer.domElement.addEventListener("webglcontextlost", onLost);
    // Reduced motion still follows the scroll, one settled frame at a time.
    const scroller = el.closest(".ytv-scroll");
    const onScroll = () => reduced && settle();
    scroller?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      disposed = true;
      stop();
      if (settleRaf) cancelAnimationFrame(settleRaf);
      api.current = null;
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVis);
      scroller?.removeEventListener("scroll", onScroll);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      draco.dispose();
      pmrem.dispose();
      texCache.forEach((t) => t.dispose());
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
    // glb is fixed for the life of the page; thumbs/shift arrive via api.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glb]);

  return (
    <div ref={host} className="ytv-reel" data-state={state}>
      {/* The Blender render: shown while loading, and for good with no WebGL. */}
      <picture>
        <source media="(max-width: 819px)" srcSet={posterPhone} />
        <img className="ytv-poster" src={poster} alt="" aria-hidden draggable={false} />
      </picture>
    </div>
  );
});
