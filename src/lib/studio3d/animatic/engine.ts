// ---------------------------------------------------------------------------
// The animatic engine: a director's plan played as moving 3D previz.
//
// Every scene becomes a small Three.js set built from the plan — sky, ground
// and props from the environment, stand-in rigs for each character (humanoid,
// creature or object), procedural motion for each action's verb, the scene's
// camera move, and simple effects. A 2D canvas composites the 3D frame with
// the title card, scene tag, narration subtitle and fades, so the same canvas
// is what the player shows and what the exporter records.
//
// It is deliberately a previz, not the final film: timing, staging and camera
// are what it proves. The Blender render on the PC is the finished video.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import type { Action, Aspect, Character, DirectorPlan, Environment, Scene, StyleId } from "../types";

export const EXPORT_SIZE: Record<Aspect, [number, number]> = {
  "16:9": [1280, 720],
  "9:16": [720, 1280],
  "1:1": [1080, 1080],
};

type Part = THREE.Object3D;

interface Rig {
  character: Character;
  root: THREE.Group;
  body: THREE.Group;
  head?: Part;
  armL?: THREE.Group;
  armR?: THREE.Group;
  legL?: THREE.Group;
  legR?: THREE.Group;
  legs: THREE.Group[];
  wheels: Part[];
}

interface Placement {
  rig: Rig;
  baseX: number;
  actions: Action[];
}

interface Burst {
  group: THREE.Group;
  pieces: { mesh: THREE.Mesh; dir: THREE.Vector3 }[];
  at: number;
}

interface Built {
  spec: Scene;
  env: Environment;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  placements: Placement[];
  falling: THREE.Points[];
  risers: THREE.Mesh[];
  twinkles: THREE.Points[];
  bursts: Burst[];
  disposables: { dispose(): void }[];
}

const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
const clamp01 = (p: number) => Math.min(1, Math.max(0, p));

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class AnimaticEngine {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly starts: number[];
  private readonly ctx: CanvasRenderingContext2D;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly built = new Map<number, Built>();
  private readonly style: StyleId;

  constructor(
    private readonly plan: DirectorPlan,
    private readonly aspect: Aspect,
    scale = 1,
  ) {
    const [w, h] = EXPORT_SIZE[aspect];
    this.width = Math.round(w * scale);
    this.height = Math.round(h * scale);
    this.style = plan.style.id;

    this.canvas = document.createElement("canvas");
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot draw the animatic (no 2D canvas).");
    this.ctx = ctx;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = this.style === "cinematic" ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;

    let acc = 0;
    this.starts = plan.scenes.map((s) => {
      const start = acc;
      acc += s.durationSec;
      return start;
    });
    this.duration = acc;
  }

  /** Which scene is on screen at time t, and how far into it. */
  sceneAt(t: number): { index: number; local: number; progress: number } {
    const time = Math.min(Math.max(0, t), Math.max(0, this.duration - 1e-3));
    let index = this.starts.length - 1;
    for (let i = 0; i < this.starts.length; i++) {
      if (time < this.starts[i] + this.plan.scenes[i].durationSec) {
        index = i;
        break;
      }
    }
    const local = time - this.starts[index];
    return { index, local, progress: clamp01(local / this.plan.scenes[index].durationSec) };
  }

  /** Draw the frame at time t onto `canvas`. */
  draw(t: number): void {
    if (!this.plan.scenes.length) return;
    const { index, local, progress } = this.sceneAt(t);
    const built = this.build(index);
    // Claymation is animated on twos.
    const animT = this.style === "claymation" ? Math.floor(local * 12) / 12 : local;
    this.animate(built, animT, progress);
    this.renderer.render(built.scene, built.camera);
    this.composite(t, index, local);
  }

  snapshot(t: number): string {
    this.draw(t);
    return this.canvas.toDataURL("image/jpeg", 0.82);
  }

  dispose(): void {
    for (const b of this.built.values()) disposeBuilt(b);
    this.built.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  // ----- building a set ---------------------------------------------------------

  private build(index: number): Built {
    const cached = this.built.get(index);
    if (cached) return cached;
    // Keep at most three sets alive: the current one and its neighbours.
    for (const [i, b] of this.built) {
      if (Math.abs(i - index) > 1) {
        disposeBuilt(b);
        this.built.delete(i);
      }
    }

    const spec = this.plan.scenes[index];
    const env = this.plan.environments.find((e) => e.id === spec.environmentId) ?? this.plan.environments[0];
    const rand = rng(index * 977 + 13);
    const scene = new THREE.Scene();
    const disposables: { dispose(): void }[] = [];
    const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
      const m = this.material(color, extra);
      disposables.push(m);
      return m;
    };
    const geo = <G extends THREE.BufferGeometry>(g: G) => {
      disposables.push(g);
      return g;
    };

    scene.background = new THREE.Color(env.palette.sky);
    scene.fog = new THREE.Fog(env.palette.fog, 20, 75);

    const night = env.timeOfDay === "night";
    const golden = env.timeOfDay === "golden";
    scene.add(new THREE.HemisphereLight(env.palette.sky, env.palette.ground, night ? 0.55 : 1.0));
    const sun = new THREE.DirectionalLight(night ? "#9db4ff" : golden ? "#ffb36b" : "#ffffff", night ? 0.9 : golden ? 2.0 : 1.7);
    sun.position.set(golden ? -10 : 6, golden ? 4.5 : 10, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.5, far: 40 });
    scene.add(sun);
    if (night) {
      const warm = new THREE.PointLight("#ffcf8a", 12, 14);
      warm.position.set(2, 3, 3);
      scene.add(warm);
    }

    const ground = new THREE.Mesh(geo(new THREE.CircleGeometry(90, 48)), mat(env.palette.ground, { roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    this.dress(scene, env, rand, mat, geo);

    // Cast: everyone this scene's actions mention, or the lead.
    const ids = [...new Set(spec.actions.map((a) => a.characterId))];
    if (!ids.length && this.plan.characters[0]) ids.push(this.plan.characters[0].id);
    const cast = ids.map((id) => this.plan.characters.find((c) => c.id === id)).filter((c): c is Character => Boolean(c));
    const placements: Placement[] = cast.map((c, i) => {
      const rig = this.rig(c, mat, geo);
      scene.add(rig.root);
      return { rig, baseX: (i - (cast.length - 1) / 2) * 1.9, actions: spec.actions.filter((a) => a.characterId === c.id) };
    });

    // Effects.
    const falling: THREE.Points[] = [];
    const risers: THREE.Mesh[] = [];
    const twinkles: THREE.Points[] = [];
    const bursts: Burst[] = [];
    const fx = spec.effects.join(" ").toLowerCase() + " " + spec.actions.map((a) => a.motion).join(" ");
    if (/snow|rain/.test(fx)) {
      const rain = /rain/.test(fx);
      falling.push(this.particles(scene, 700, rain ? "#9fc3ff" : "#ffffff", rain ? 0.05 : 0.09, rand, geo, disposables, [30, 14, 20]));
    }
    if (/sparkle|glow|magic|star/.test(fx)) twinkles.push(this.particles(scene, 160, "#fff4b0", 0.12, rand, geo, disposables, [6, 4, 4], 1.4));
    if (/fire|smoke/.test(fx)) {
      for (let i = 0; i < 14; i++) {
        const m = new THREE.Mesh(geo(new THREE.IcosahedronGeometry(0.25, 0)), mat(/fire/.test(fx) ? "#ff7a2f" : "#8a8f98", { emissive: /fire/.test(fx) ? "#ff5a00" : "#000000", transparent: true, opacity: 0.8 }));
        m.userData = { x: -3 + rand() * 1.2, z: -1.5 + rand(), phase: rand() };
        scene.add(m);
        risers.push(m);
      }
    }
    if (/explo|burst|shatter|splash|explode/.test(fx)) {
      const group = new THREE.Group();
      group.position.set(0, 1.2, -1);
      const pieces = Array.from({ length: 26 }, () => {
        const mesh = new THREE.Mesh(geo(new THREE.IcosahedronGeometry(0.12 + rand() * 0.14, 0)), mat(rand() > 0.5 ? "#ffb703" : "#fb5607", { emissive: "#ff6a00" }));
        group.add(mesh);
        return { mesh, dir: new THREE.Vector3(rand() - 0.5, rand() * 0.9, rand() - 0.5).normalize() };
      });
      group.visible = false;
      scene.add(group);
      bursts.push({ group, pieces, at: 0.45 });
    }

    const camera = new THREE.PerspectiveCamera((2 * Math.atan(12 / spec.camera.lens) * 180) / Math.PI, this.width / this.height, 0.1, 200);

    const built: Built = { spec, env, scene, camera, placements, falling, risers, twinkles, bursts, disposables };
    this.built.set(index, built);
    return built;
  }

  private material(color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.Material {
    switch (this.style) {
      case "anime-toon":
        return new THREE.MeshToonMaterial({ color, transparent: extra.transparent, opacity: extra.opacity ?? 1, emissive: extra.emissive ?? "#000000" });
      case "paper-craft":
        return new THREE.MeshLambertMaterial({ color, transparent: extra.transparent, opacity: extra.opacity ?? 1, emissive: extra.emissive ?? "#000000" });
      case "low-poly":
        return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...extra });
      case "claymation":
        return new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, ...extra });
      case "cinematic":
        return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...extra });
      default:
        return new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });
    }
  }

  private particles(
    scene: THREE.Scene,
    count: number,
    color: string,
    size: number,
    rand: () => number,
    geo: <G extends THREE.BufferGeometry>(g: G) => G,
    disposables: { dispose(): void }[],
    box: [number, number, number],
    y0 = 0,
  ): THREE.Points {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rand() - 0.5) * box[0];
      pos[i * 3 + 1] = y0 + rand() * box[1];
      pos[i * 3 + 2] = (rand() - 0.5) * box[2];
    }
    const g = geo(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.9, depthWrite: false });
    disposables.push(m);
    const pts = new THREE.Points(g, m);
    pts.userData = { base: pos.slice(), height: box[1], y0 };
    scene.add(pts);
    return pts;
  }

  private dress(
    scene: THREE.Scene,
    env: Environment,
    rand: () => number,
    mat: (c: string, e?: Partial<THREE.MeshStandardMaterialParameters>) => THREE.Material,
    geo: <G extends THREE.BufferGeometry>(g: G) => G,
  ): void {
    const add = (m: THREE.Object3D) => {
      m.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      scene.add(m);
      return m;
    };
    /** A spot off the central stage: behind and to the sides. */
    const spot = (depth = 1): [number, number] => {
      const x = (rand() - 0.5) * 26 * depth;
      const z = -3 - rand() * 14 * depth;
      return [Math.abs(x) < 3.5 && z > -5 ? x + Math.sign(x || 1) * 4 : x, z];
    };
    const lowSeg = this.style === "low-poly" ? 5 : 14;
    const props = env.props.length ? env.props : ["shapes"];
    const known = new Set<string>();

    for (const raw of props) {
      const p = raw.toLowerCase();
      if (/tree|pine|forest/.test(p)) {
        known.add(p);
        for (let i = 0; i < 12; i++) {
          const g = new THREE.Group();
          const trunk = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.15, 0.22, 1.4, 6)), mat("#7a4e2d"));
          trunk.position.y = 0.7;
          const leafColor = /pine/.test(p) ? "#2f6b3f" : "#4f9d5a";
          const crown = new THREE.Mesh(geo(new THREE.ConeGeometry(0.9 + rand() * 0.4, 2.2 + rand(), lowSeg)), mat(leafColor));
          crown.position.y = 2.3;
          g.add(trunk, crown);
          const [x, z] = spot();
          g.position.set(x, 0, z);
          g.scale.setScalar(0.8 + rand() * 0.8);
          add(g);
        }
      } else if (/palm/.test(p)) {
        known.add(p);
        for (let i = 0; i < 6; i++) {
          const g = new THREE.Group();
          const trunk = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.1, 0.18, 3.2, 6)), mat("#9c6b3f"));
          trunk.position.y = 1.6;
          trunk.rotation.z = (rand() - 0.5) * 0.3;
          const leaves = new THREE.Mesh(geo(new THREE.SphereGeometry(1.1, lowSeg, 6)), mat("#3fa34d"));
          leaves.scale.set(1.3, 0.35, 1.3);
          leaves.position.y = 3.3;
          g.add(trunk, leaves);
          const [x, z] = spot();
          g.position.set(x, 0, z);
          add(g);
        }
      } else if (/building|tower|city|house/.test(p)) {
        known.add(p);
        const tones = ["#8093a8", "#a3b1c2", "#6c7a8c", "#c2b8a3", "#94a3b8"];
        for (let i = 0; i < 16; i++) {
          const hgt = 3 + rand() * 9;
          const b = new THREE.Mesh(geo(new THREE.BoxGeometry(2 + rand() * 1.5, hgt, 2 + rand() * 1.5)), mat(tones[i % tones.length]));
          const x = -16 + (i % 8) * 4.6 + rand();
          const z = i < 8 ? -9 - rand() * 2 : -16 - rand() * 3;
          b.position.set(x, hgt / 2, z);
          add(b);
          if (/tower/.test(p)) {
            const roof = new THREE.Mesh(geo(new THREE.ConeGeometry(1.4, 1.6, 4)), mat("#9b2c2c"));
            roof.position.set(x, hgt + 0.8, z);
            add(roof);
          }
        }
      } else if (/lamp|light(?!s? ?pot)/.test(p) && !/spot/.test(p)) {
        known.add(p);
        for (let i = 0; i < 4; i++) {
          const g = new THREE.Group();
          const pole = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6)), mat("#374151"));
          pole.position.y = 1.3;
          const bulb = new THREE.Mesh(geo(new THREE.SphereGeometry(0.18, 10, 8)), mat("#fff3b0", { emissive: "#ffd166" }));
          bulb.position.y = 2.7;
          g.add(pole, bulb);
          g.position.set(-6 + i * 4, 0, -4);
          add(g);
        }
      } else if (/star/.test(p)) {
        known.add(p);
        const pos = new Float32Array(900 * 3);
        for (let i = 0; i < 900; i++) {
          const th = rand() * Math.PI * 2;
          const ph = rand() * Math.PI * 0.45;
          pos[i * 3] = Math.cos(th) * Math.cos(ph) * 70;
          pos[i * 3 + 1] = Math.sin(ph) * 70 + 3;
          pos[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * 70;
        }
        const g = geo(new THREE.BufferGeometry());
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        const m = new THREE.PointsMaterial({ color: "#ffffff", size: 0.35, fog: false });
        scene.add(new THREE.Points(g, m));
      } else if (/planet|moon/.test(p)) {
        known.add(p);
        const planet = new THREE.Mesh(geo(new THREE.SphereGeometry(7, 32, 24)), mat("#e07a5f", { emissive: "#3d1408" }));
        planet.position.set(-20, 12, -45);
        const ring = new THREE.Mesh(geo(new THREE.TorusGeometry(10.5, 0.4, 6, 48)), mat("#f2cc8f"));
        ring.position.copy(planet.position);
        ring.rotation.x = 1.2;
        scene.add(planet, ring);
      } else if (/rock/.test(p)) {
        known.add(p);
        for (let i = 0; i < 12; i++) {
          const r = new THREE.Mesh(geo(new THREE.DodecahedronGeometry(0.3 + rand() * 0.9, 0)), mat("#8b8680"));
          const [x, z] = spot();
          r.position.set(x, 0.2, z);
          r.rotation.set(rand(), rand(), rand());
          add(r);
        }
      } else if (/water|sea|ocean/.test(p)) {
        known.add(p);
        const w = new THREE.Mesh(geo(new THREE.PlaneGeometry(120, 60)), mat("#2f9bd6", { roughness: 0.2, metalness: 0.1 }));
        w.rotation.x = -Math.PI / 2;
        w.position.set(0, 0.03, -36);
        scene.add(w);
      } else if (/coral/.test(p)) {
        known.add(p);
        const colors = ["#ff6b6b", "#ffa94d", "#f06595", "#cc5de8"];
        for (let i = 0; i < 14; i++) {
          const c = new THREE.Mesh(geo(new THREE.ConeGeometry(0.3 + rand() * 0.4, 1 + rand() * 1.5, 7)), mat(colors[i % colors.length]));
          const [x, z] = spot(0.8);
          c.position.set(x, 0.6, z);
          add(c);
        }
      } else if (/cactus/.test(p)) {
        known.add(p);
        for (let i = 0; i < 7; i++) {
          const g = new THREE.Group();
          const body = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.28, 1.6, 4, 8)), mat("#4d8b31"));
          body.position.y = 1.1;
          const arm = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.16, 0.6, 4, 8)), mat("#4d8b31"));
          arm.position.set(0.4, 1.4, 0);
          g.add(body, arm);
          const [x, z] = spot();
          g.position.set(x, 0, z);
          add(g);
        }
      } else if (/mountain/.test(p)) {
        known.add(p);
        for (let i = 0; i < 6; i++) {
          const g = new THREE.Group();
          const hgt = 12 + rand() * 12;
          const m = new THREE.Mesh(geo(new THREE.ConeGeometry(9 + rand() * 5, hgt, lowSeg)), mat("#8391a6"));
          m.position.y = hgt / 2;
          const cap = new THREE.Mesh(geo(new THREE.ConeGeometry(3.2, hgt * 0.3, lowSeg)), mat("#ffffff"));
          cap.position.y = hgt * 0.86;
          g.add(m, cap);
          g.position.set(-40 + i * 16 + rand() * 4, 0, -42 - rand() * 10);
          scene.add(g);
        }
      } else if (/desk|bench|counter|shel|furniture|table/.test(p)) {
        known.add(p);
        for (let i = 0; i < 5; i++) {
          const d = new THREE.Mesh(geo(new THREE.BoxGeometry(2.2, 1, 0.9)), mat(/counter/.test(p) ? "#e9ecef" : "#a0704a"));
          d.position.set(-6 + i * 3, 0.5, -4.5 - (i % 2) * 2);
          add(d);
        }
      } else if (/screen|board/.test(p)) {
        known.add(p);
        for (let i = 0; i < (/board/.test(p) ? 1 : 3); i++) {
          const s = new THREE.Mesh(geo(new THREE.PlaneGeometry(/board/.test(p) ? 6 : 1.8, /board/.test(p) ? 2.6 : 1.1)), mat(/board/.test(p) ? "#2d6a4f" : "#4cc9f0", { emissive: /board/.test(p) ? "#0b2a1f" : "#1b6a8a" }));
          s.position.set(/board/.test(p) ? 0 : -3 + i * 3, 2.2, -6);
          scene.add(s);
        }
      } else if (/spotlight/.test(p)) {
        known.add(p);
        const cols = ["#ff4d8d", "#4dabf7", "#ffd43b", "#9775fa"];
        for (let i = 0; i < 4; i++) {
          const cone = new THREE.Mesh(geo(new THREE.ConeGeometry(1.6, 9, 20, 1, true)), new THREE.MeshBasicMaterial({ color: cols[i], transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
          cone.position.set(-5 + i * 3.3, 4.5, -2.5);
          cone.rotation.z = (i - 1.5) * 0.15;
          scene.add(cone);
        }
      } else if (/platform|stage/.test(p)) {
        known.add(p);
        const pl = new THREE.Mesh(geo(new THREE.CylinderGeometry(3.4, 3.6, 0.12, 40)), mat("#e5e7eb"));
        pl.position.y = 0.06;
        pl.receiveShadow = true;
        scene.add(pl);
      } else if (/flower/.test(p)) {
        known.add(p);
        const cols = ["#ff6b6b", "#ffd43b", "#f783ac", "#ffffff"];
        for (let i = 0; i < 26; i++) {
          const f = new THREE.Mesh(geo(new THREE.SphereGeometry(0.12, 8, 6)), mat(cols[i % 4]));
          const [x, z] = spot(0.7);
          f.position.set(x, 0.3, z + 2);
          scene.add(f);
        }
      } else if (/bubble/.test(p)) {
        known.add(p);
        for (let i = 0; i < 20; i++) {
          const b = new THREE.Mesh(geo(new THREE.SphereGeometry(0.1 + rand() * 0.12, 10, 8)), mat("#e7f5ff", { transparent: true, opacity: 0.5 }));
          b.userData = { x: (rand() - 0.5) * 10, z: -2 - rand() * 6, phase: rand() };
          scene.add(b);
        }
      }
    }

    if (!known.size) {
      // Nothing recognised: floating shapes in the palette keep the set from looking empty.
      for (let i = 0; i < 8; i++) {
        const shapes = [new THREE.TorusGeometry(0.6, 0.2, 8, 20), new THREE.IcosahedronGeometry(0.7, 0), new THREE.BoxGeometry(1, 1, 1)];
        const s = new THREE.Mesh(geo(shapes[i % 3]), mat(i % 2 ? env.palette.sky : "#ffffff"));
        const [x, z] = spot(0.8);
        s.position.set(x, 1.5 + rand() * 3, z);
        s.rotation.set(rand() * 3, rand() * 3, 0);
        add(s);
      }
    }
  }

  // ----- rigs --------------------------------------------------------------------

  private rig(
    c: Character,
    mat: (color: string, e?: Partial<THREE.MeshStandardMaterialParameters>) => THREE.Material,
    geo: <G extends THREE.BufferGeometry>(g: G) => G,
  ): Rig {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const bodyMat = mat(c.colors.body);
    const accent = mat(c.colors.accent);
    const skin = mat("#" + new THREE.Color(c.colors.body).lerp(new THREE.Color("#ffffff"), 0.5).getHexString());
    const dark = mat("#111827");
    const rig: Rig = { character: c, root, body, legs: [], wheels: [] };
    const m = (g: THREE.BufferGeometry, material: THREE.Material) => {
      const mesh = new THREE.Mesh(geo(g), material);
      mesh.castShadow = true;
      return mesh;
    };

    if (c.kind === "humanoid") {
      const hip = 0.95;
      const torso = m(new THREE.CapsuleGeometry(0.32, 0.5, 6, 14), bodyMat);
      torso.position.y = hip + 0.42;
      body.add(torso);
      const head = new THREE.Group();
      head.position.y = hip + 1.1;
      head.add(m(new THREE.SphereGeometry(0.3, 20, 16), skin));
      for (const x of [-0.1, 0.1]) {
        const eye = m(new THREE.SphereGeometry(0.045, 10, 8), dark);
        eye.position.set(x, 0.04, 0.27);
        head.add(eye);
      }
      const band = m(new THREE.CylinderGeometry(0.31, 0.31, 0.1, 20), accent);
      band.position.y = 0.17;
      head.add(band);
      body.add(head);
      rig.head = head;
      const limb = (x: number, y: number, len: number, r: number, end: THREE.Material) => {
        const pivot = new THREE.Group();
        pivot.position.set(x, y, 0);
        const seg = m(new THREE.CapsuleGeometry(r, len, 4, 10), bodyMat);
        seg.position.y = -len / 2 - r;
        const tip = m(new THREE.SphereGeometry(r * 1.25, 10, 8), end);
        tip.position.y = -len - r * 2;
        pivot.add(seg, tip);
        body.add(pivot);
        return pivot;
      };
      rig.armL = limb(-0.44, hip + 0.72, 0.42, 0.085, skin);
      rig.armR = limb(0.44, hip + 0.72, 0.42, 0.085, skin);
      rig.legL = limb(-0.16, hip, 0.55, 0.11, accent);
      rig.legR = limb(0.16, hip, 0.55, 0.11, accent);
    } else if (c.kind === "creature") {
      const torso = m(new THREE.CapsuleGeometry(0.35, 0.9, 6, 14), bodyMat);
      torso.rotation.z = Math.PI / 2;
      torso.position.y = 0.85;
      body.add(torso);
      const head = new THREE.Group();
      head.position.set(0.85, 1.15, 0);
      head.add(m(new THREE.SphereGeometry(0.28, 16, 12), bodyMat));
      for (const z of [-0.1, 0.1]) {
        const eye = m(new THREE.SphereGeometry(0.04, 8, 6), dark);
        eye.position.set(0.24, 0.07, z);
        head.add(eye);
      }
      const snout = m(new THREE.SphereGeometry(0.1, 8, 6), accent);
      snout.position.set(0.28, -0.05, 0);
      head.add(snout);
      body.add(head);
      rig.head = head;
      for (const [x, z] of [[0.45, 0.2], [0.45, -0.2], [-0.45, 0.2], [-0.45, -0.2]]) {
        const pivot = new THREE.Group();
        pivot.position.set(x, 0.7, z);
        const leg = m(new THREE.CapsuleGeometry(0.08, 0.45, 4, 8), bodyMat);
        leg.position.y = -0.33;
        pivot.add(leg);
        body.add(pivot);
        rig.legs.push(pivot);
      }
      const tail = m(new THREE.CapsuleGeometry(0.06, 0.5, 4, 8), accent);
      tail.position.set(-0.85, 1.05, 0);
      tail.rotation.z = -0.9;
      body.add(tail);
    } else {
      const name = c.name.toLowerCase();
      if (/rocket/.test(name)) {
        const hull = m(new THREE.CylinderGeometry(0.35, 0.4, 1.8, 18), bodyMat);
        hull.position.y = 1.1;
        const nose = m(new THREE.ConeGeometry(0.35, 0.7, 18), accent);
        nose.position.y = 2.35;
        body.add(hull, nose);
        for (let i = 0; i < 3; i++) {
          const fin = m(new THREE.BoxGeometry(0.06, 0.5, 0.45), accent);
          const a = (i / 3) * Math.PI * 2;
          fin.position.set(Math.cos(a) * 0.4, 0.4, Math.sin(a) * 0.4);
          fin.rotation.y = -a;
          body.add(fin);
        }
      } else if (/car|truck|bus|bike|motorcycle|train/.test(name)) {
        const chassis = m(new THREE.BoxGeometry(2, 0.5, 1), bodyMat);
        chassis.position.y = 0.55;
        const cabin = m(new THREE.BoxGeometry(1, 0.45, 0.9), accent);
        cabin.position.set(-0.1, 1.02, 0);
        body.add(chassis, cabin);
        for (const [x, z] of [[0.65, 0.52], [0.65, -0.52], [-0.65, 0.52], [-0.65, -0.52]]) {
          const wheel = m(new THREE.CylinderGeometry(0.27, 0.27, 0.18, 16), dark);
          wheel.rotation.x = Math.PI / 2;
          wheel.position.set(x, 0.3, z);
          body.add(wheel);
          rig.wheels.push(wheel);
        }
      } else if (/plane|jet|spaceship|ship|drone|satellite/.test(name)) {
        const hull = m(new THREE.CapsuleGeometry(0.28, 1.5, 6, 14), bodyMat);
        hull.rotation.z = Math.PI / 2;
        hull.position.y = 1.2;
        const wing = m(new THREE.BoxGeometry(0.6, 0.06, 2.4), accent);
        wing.position.y = 1.2;
        body.add(hull, wing);
      } else if (/ball|balloon|planet|sun|moon|meteor|asteroid/.test(name)) {
        const sphere = m(new THREE.SphereGeometry(0.45, 24, 18), bodyMat);
        sphere.position.y = /balloon/.test(name) ? 2 : 0.45;
        body.add(sphere);
        if (/balloon/.test(name)) {
          const string = m(new THREE.CylinderGeometry(0.01, 0.01, 1.5, 4), dark);
          string.position.y = 0.95;
          body.add(string);
        }
      } else {
        const box = m(new THREE.BoxGeometry(0.9, 0.9, 0.9), bodyMat);
        box.position.y = 0.45;
        body.add(box);
      }
    }
    return rig;
  }

  // ----- motion ------------------------------------------------------------------

  private animate(b: Built, t: number, progress: number): void {
    const centre = new THREE.Vector3();
    let travelling: THREE.Vector3 | null = null;

    for (const pl of b.placements) {
      const { rig } = pl;
      const n = Math.max(1, pl.actions.length);
      const slot = Math.min(n - 1, Math.floor(progress * n));
      const action = pl.actions[slot];
      const localP = clamp01(progress * n - slot);
      const localT = (localP * b.spec.durationSec) / n;
      resetRig(rig);
      rig.root.position.set(pl.baseX, 0, 0);
      rig.root.rotation.set(0, rig.character.kind === "creature" ? -0.7 : 0, 0);
      const moved = this.pose(rig, action?.motion ?? "idle", localT, localP, t);
      if (moved && !travelling) travelling = rig.root.position.clone();
      centre.add(rig.root.position);
    }
    if (b.placements.length) centre.divideScalar(b.placements.length);

    for (const pts of b.falling) {
      const pos = pts.geometry.getAttribute("position") as THREE.BufferAttribute;
      const base = pts.userData.base as Float32Array;
      const h = pts.userData.height as number;
      for (let i = 0; i < pos.count; i++) pos.setY(i, ((((base[i * 3 + 1] - t * 3.2) % h) + h) % h));
      pos.needsUpdate = true;
    }
    for (const pts of b.twinkles) {
      (pts.material as THREE.PointsMaterial).opacity = 0.45 + 0.45 * Math.sin(t * 5);
      pts.position.copy(centre);
      pts.rotation.y = t * 0.4;
    }
    for (const r of b.risers) {
      const { x, z, phase } = r.userData as { x: number; z: number; phase: number };
      const life = (t * 0.6 + phase) % 1;
      r.position.set(x + Math.sin(life * 6) * 0.2, life * 3.5, z);
      r.scale.setScalar(0.6 + life * 1.6);
      (r.material as THREE.MeshStandardMaterial).opacity = 0.9 * (1 - life);
    }
    for (const burst of b.bursts) {
      const k = (progress - burst.at) / 0.35;
      burst.group.visible = k > 0 && k < 1;
      burst.group.position.copy(centre).setY(1.2);
      for (const piece of burst.pieces) piece.mesh.position.copy(piece.dir).multiplyScalar(ease(clamp01(k)) * 3.2);
    }

    this.moveCamera(b, travelling ?? centre, progress, t);
  }

  /** Pose a rig for one motion verb. Returns true when the rig travels across the set. */
  private pose(rig: Rig, motion: string, t: number, p: number, globalT: number): boolean {
    const { body, head, armL, armR, legL, legR } = rig;
    const s = Math.sin;
    const kind = rig.character.kind;

    if (kind === "object") {
      const name = rig.character.name.toLowerCase();
      switch (motion) {
        case "fly":
          if (/rocket/.test(name)) {
            rig.root.position.y = ease(p) ** 1.6 * 9;
            body.rotation.z = s(t * 40) * 0.01;
          } else {
            rig.root.position.x += -4 + p * 8;
            rig.root.position.y = 1 + p * 2.5 + s(t * 2) * 0.3;
            body.rotation.z = -0.15;
          }
          return true;
        case "drive":
          rig.root.position.x += -6 + ease(p) * 12;
          for (const w of rig.wheels) w.rotation.y = t * 14;
          body.position.y = Math.abs(s(t * 12)) * 0.03;
          return true;
        case "grow":
          body.scale.setScalar(0.1 + 0.9 * clamp01(1 - (1 - p) ** 3));
          return false;
        case "explode":
          body.visible = p < 0.48;
          body.scale.setScalar(1 + clamp01((p - 0.35) / 0.13) * 0.4);
          return false;
        case "spin":
          body.rotation.y = t * 3;
          return false;
        default:
          rig.root.position.x += -1 + p * 2;
          body.position.y = s(t * 2) * 0.1;
          return false;
      }
    }

    if (kind === "creature") {
      const travel = ["walk", "run", "chase", "move", "custom", "land"].includes(motion);
      const speed = motion === "run" || motion === "chase" ? 14 : 7;
      rig.legs.forEach((leg, i) => (leg.rotation.z = s(t * speed + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.6));
      body.position.y = Math.abs(s(t * speed)) * 0.06;
      if (head) head.rotation.z = s(t * 2) * 0.1;
      if (motion === "jump" || motion === "flip") body.position.y = Math.abs(s(t * 3)) * 1.1;
      if (motion === "fall") body.rotation.x = ease(p) * 1.4;
      if (travel) {
        rig.root.position.x += -3.5 + p * 7;
        rig.root.rotation.y = 0;
        return true;
      }
      return false;
    }

    // Humanoid.
    const breathe = () => (body.scale.y = 1 + s(t * 2.2) * 0.012);
    const gait = (speed: number, amp: number) => {
      legL!.rotation.x = s(t * speed) * amp;
      legR!.rotation.x = -s(t * speed) * amp;
      armL!.rotation.x = -s(t * speed) * amp * 0.8;
      armR!.rotation.x = s(t * speed) * amp * 0.8;
      body.position.y = Math.abs(s(t * speed)) * 0.05;
    };

    switch (motion) {
      case "walk":
        gait(7, 0.55);
        rig.root.position.x += -2.5 + p * 5;
        rig.root.rotation.y = 0.9;
        return true;
      case "run":
      case "chase":
        gait(12, 0.95);
        body.rotation.x = 0.18;
        rig.root.position.x += -4.5 + p * 9;
        rig.root.rotation.y = 1.1;
        return true;
      case "jump": {
        const k = Math.abs(s(t * 3));
        rig.root.position.y = k * 1.1;
        legL!.rotation.x = legR!.rotation.x = -k * 0.5;
        armL!.rotation.z = -k * 2.4;
        armR!.rotation.z = k * 2.4;
        return false;
      }
      case "talk":
        breathe();
        if (head) head.rotation.x = s(t * 6) * 0.06;
        armR!.rotation.x = -0.6 + s(t * 2.4) * 0.35;
        armR!.rotation.z = 0.2;
        armL!.rotation.x = -0.3 + s(t * 1.7 + 1) * 0.25;
        return false;
      case "wave":
        breathe();
        armR!.rotation.z = 2.6 + s(t * 8) * 0.35;
        return false;
      case "dance":
        body.rotation.y = s(t * 3) * 0.5;
        body.position.y = Math.abs(s(t * 6)) * 0.12;
        armL!.rotation.z = -1.8 - s(t * 6) * 0.9;
        armR!.rotation.z = 1.8 - s(t * 6) * 0.9;
        legL!.rotation.x = s(t * 6) * 0.35;
        legR!.rotation.x = -s(t * 6) * 0.35;
        return false;
      case "cheer":
        rig.root.position.y = Math.abs(s(t * 6)) * 0.25;
        armL!.rotation.z = -2.7 + s(t * 12) * 0.2;
        armR!.rotation.z = 2.7 - s(t * 12) * 0.2;
        return false;
      case "point":
        breathe();
        armR!.rotation.x = -1.5;
        if (head) head.rotation.y = 0.2;
        return false;
      case "think":
        breathe();
        armR!.rotation.x = -2.3;
        armR!.rotation.z = -0.5;
        if (head) head.rotation.z = 0.15 + s(t) * 0.05;
        return false;
      case "look":
        breathe();
        if (head) head.rotation.y = s(t * 1.3) * 0.8;
        body.rotation.y = s(t * 0.6) * 0.3;
        return false;
      case "sit":
        body.position.y = -0.45;
        legL!.rotation.x = legR!.rotation.x = -1.4;
        breathe();
        return false;
      case "type":
        breathe();
        armL!.rotation.x = -1.2 + s(t * 20) * 0.06;
        armR!.rotation.x = -1.2 - s(t * 20) * 0.06;
        if (head) head.rotation.x = 0.2;
        return false;
      case "pickup": {
        const k = (1 - Math.cos(t * 2.5)) / 2;
        body.rotation.x = k * 0.8;
        armL!.rotation.x = armR!.rotation.x = -k * 1.3;
        return false;
      }
      case "sad":
        if (head) head.rotation.x = 0.45;
        body.rotation.x = 0.12;
        body.scale.y = 1 + s(t * 1.2) * 0.01;
        return false;
      case "laugh":
        body.rotation.z = s(t * 14) * 0.05;
        if (head) head.rotation.x = -0.25 + s(t * 14) * 0.08;
        armL!.rotation.z = -0.4;
        armR!.rotation.z = 0.4;
        return false;
      case "salute":
        armR!.rotation.x = -2.6;
        armR!.rotation.z = -0.6;
        return false;
      case "flip": {
        const cyc = (t % 1.6) / 1.6;
        const air = clamp01((cyc - 0.15) / 0.7);
        rig.root.position.y = s(air * Math.PI) * 1.6;
        body.rotation.x = -air * Math.PI * 2;
        body.position.y = 0;
        legL!.rotation.x = legR!.rotation.x = -s(air * Math.PI) * 1.2;
        return false;
      }
      case "fall": {
        const k = ease(clamp01(p * 1.6));
        rig.root.rotation.x = -k * 1.45;
        armL!.rotation.z = -k * 1.5;
        armR!.rotation.z = k * 1.5;
        return false;
      }
      case "fight": {
        legL!.rotation.x = 0.35;
        legR!.rotation.x = -0.35;
        const jab = (t * 3.5) % 2;
        armL!.rotation.x = jab < 1 ? -1.55 * s(Math.min(1, jab) * Math.PI) : -0.5;
        armR!.rotation.x = jab >= 1 ? -1.55 * s(Math.min(1, jab - 1) * Math.PI) : -0.5;
        body.rotation.y = s(t * 7) * 0.2;
        return false;
      }
      case "climb":
        armL!.rotation.z = -2.8 + s(t * 4) * 0.3;
        armR!.rotation.z = 2.8 + s(t * 4) * 0.3;
        legL!.rotation.x = s(t * 4) * 0.6;
        legR!.rotation.x = -s(t * 4) * 0.6;
        rig.root.position.y = p * 1.6;
        return false;
      case "throw": {
        const k = (t * 1.2) % 1;
        armR!.rotation.x = k < 0.6 ? 2 * (k / 0.6) * 0.6 : -2.4 * ((k - 0.6) / 0.4);
        body.rotation.y = k < 0.6 ? 0.4 : -0.3;
        return false;
      }
      case "land":
      case "stretch": {
        const k = Math.abs(s(t * 3));
        body.scale.set(1 + (1 - k) * 0.15, 0.85 + k * 0.2, 1 + (1 - k) * 0.15);
        rig.root.position.y = k * 0.6;
        return false;
      }
      case "fly":
        rig.root.position.y = 1.2 + s(t * 2) * 0.3;
        rig.root.position.x += -3 + p * 6;
        body.rotation.x = 0.9;
        armL!.rotation.z = -2.9;
        armR!.rotation.z = 2.9;
        return true;
      case "drive":
      case "custom":
      case "move":
        gait(5, 0.3);
        rig.root.position.x += -1.5 + p * 3;
        rig.root.rotation.y = 0.7;
        return true;
      default:
        breathe();
        armL!.rotation.z = -0.08 - s(t * 1.8) * 0.04;
        armR!.rotation.z = 0.08 + s(t * 1.8) * 0.04;
        void globalT;
        return false;
    }
  }

  private moveCamera(b: Built, target: THREE.Vector3, progress: number, t: number): void {
    const cam = b.camera;
    const { move, lens } = b.spec.camera;
    const aspectPush = this.aspect === "9:16" ? 1.75 : this.aspect === "1:1" ? 1.25 : 1;
    const base = Math.min(22, Math.max(4.5, 7 * (lens / 35) ** 0.85)) * aspectPush;
    const p = ease(progress);
    const look = new THREE.Vector3(target.x, 1.1 + target.y * 0.6, target.z);
    let angle = 0.3;
    let dist = base;
    let height = 1.9;

    switch (move) {
      case "dolly-in":
        dist = base * (1.45 - 0.6 * p);
        break;
      case "dolly-out":
        dist = base * (0.85 + 0.85 * p);
        height = 1.9 + p * 1.8;
        break;
      case "orbit":
        angle = -0.7 + p * 1.6;
        break;
      case "pan":
        angle = -0.35 + p * 0.7;
        look.x += -1.2 + p * 2.4;
        break;
      case "crane-up":
        height = 0.5 + p * 5.5;
        dist = base * (1.15 - p * 0.15);
        break;
      case "tracking":
        angle = 0.05;
        break;
      case "handheld":
        look.x += Math.sin(t * 1.7) * 0.08;
        look.y += Math.sin(t * 2.3) * 0.06;
        angle = 0.25 + Math.sin(t * 0.9) * 0.03;
        break;
      default:
        break;
    }
    cam.position.set(look.x + Math.sin(angle) * dist, height + (look.y - 1.1), look.z + Math.cos(angle) * dist);
    cam.lookAt(look);
  }

  // ----- 2D overlay ---------------------------------------------------------------

  private composite(t: number, index: number, local: number): void {
    const { ctx, width: w, height: h } = this;
    const scene = this.plan.scenes[index];
    ctx.drawImage(this.renderer.domElement, 0, 0, w, h);
    const u = Math.min(w, h) / 720;

    // Cinematic letterbox to 2.39:1 inside a landscape frame.
    if (this.style === "cinematic" && w > h) {
      const bar = Math.max(0, (h - w / 2.39) / 2);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, bar);
      ctx.fillRect(0, h - bar, w, bar);
    }

    // Scene tag.
    ctx.font = `600 ${Math.round(15 * u)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textBaseline = "top";
    const tag = `S${index + 1} · ${scene.beat || scene.title}`.toUpperCase();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    const tw = ctx.measureText(tag).width;
    roundRect(ctx, 18 * u, 18 * u, tw + 20 * u, 28 * u, 8 * u);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(tag, 28 * u, 25 * u);

    // Narration subtitle.
    const titleCard = index === 0 && local < 2.4;
    if (scene.narration && !titleCard) {
      ctx.font = `500 ${Math.round(24 * u)}px system-ui, -apple-system, Segoe UI, sans-serif`;
      const lines = wrap(ctx, scene.narration, w * 0.8).slice(0, 3);
      const lh = 32 * u;
      const boxH = lines.length * lh + 18 * u;
      const y = h - boxH - 34 * u;
      const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      roundRect(ctx, (w - maxW) / 2 - 16 * u, y, maxW + 32 * u, boxH, 12 * u);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      lines.forEach((l, i) => ctx.fillText(l, w / 2, y + 9 * u + i * lh));
      ctx.textAlign = "left";
    }

    // Title card over the first seconds.
    if (titleCard) {
      const a = local < 1.8 ? 1 : 1 - (local - 1.8) / 0.6;
      ctx.fillStyle = `rgba(8,10,20,${0.55 * a})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = a;
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.round(54 * u)}px system-ui, -apple-system, Segoe UI, sans-serif`;
      wrap(ctx, this.plan.title, w * 0.85)
        .slice(0, 2)
        .forEach((l, i, arr) => ctx.fillText(l, w / 2, h / 2 - 20 * u - (arr.length - 1 - i) * 60 * u));
      ctx.font = `400 ${Math.round(22 * u)}px system-ui, -apple-system, Segoe UI, sans-serif`;
      wrap(ctx, this.plan.logline, w * 0.7)
        .slice(0, 2)
        .forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + 40 * u + i * 30 * u));
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
    }

    // Fades at cuts and at the very start and end.
    const fade = 0.35;
    const toEnd = scene.durationSec - local;
    let dark = 0;
    if (local < fade && index > 0) dark = 1 - local / fade;
    if (toEnd < fade && index < this.plan.scenes.length - 1) dark = Math.max(dark, 1 - toEnd / fade);
    if (t < 0.4) dark = Math.max(dark, 1 - t / 0.4);
    if (this.duration - t < 0.6) dark = Math.max(dark, 1 - (this.duration - t) / 0.6);
    if (dark > 0) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(1, dark)})`;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

function resetRig(rig: Rig): void {
  rig.root.position.set(0, 0, 0);
  rig.root.rotation.set(0, 0, 0);
  rig.body.position.set(0, 0, 0);
  rig.body.rotation.set(0, 0, 0);
  rig.body.scale.set(1, 1, 1);
  rig.body.visible = true;
  for (const part of [rig.head, rig.armL, rig.armR, rig.legL, rig.legR, ...rig.legs]) part?.rotation.set(0, 0, 0);
}

function disposeBuilt(b: Built): void {
  for (const d of b.disposables) d.dispose();
  b.scene.traverse((o) => {
    if (o instanceof THREE.Points || o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const m = o.material as THREE.Material | THREE.Material[];
      (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
    }
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}
