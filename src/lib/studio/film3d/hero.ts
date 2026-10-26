// ---------------------------------------------------------------------------
// The hero: a toy-figure character built in code from a Hero3D spec.
//
// ONE builder, one palette, one size rule — the 3D form of the Kids flow's
// craft line, "the character is the constant". Every pose is a parameter of
// `poseHero`, never a separate model, so he cannot drift between shots.
//
// Rig (all Object3D pivots, the character faces +z):
//   root → body (bob/jump) → hips → spine (lean) → chest → head
//                                              ↳ shoulderL/R → elbowL/R → hand
//                               ↳ hipL/R → kneeL/R → foot
// The character's right side is -x. Arm swing forward = negative x rotation;
// raising an arm out to the side = rotation z (right arm negative, left positive).
// ---------------------------------------------------------------------------

import * as THREE from "three";
import type { Expression, Hero3D, Look, Move } from "./plan";
import { clamp, heroHeight, rand } from "./director";

export interface HeroRig {
  root: THREE.Group;
  body: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
  chest: THREE.Group;
  head: THREE.Group;
  shoulderL: THREE.Group;
  shoulderR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
  handR: THREE.Object3D;
  hipL: THREE.Group;
  hipR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  eyes: THREE.Object3D[];
  brows: THREE.Object3D[];
  mouths: Record<"smile" | "sad" | "open" | "line" | "grin", THREE.Object3D>;
  cheeks: THREE.Object3D[];
  cape?: THREE.Object3D;
  height: number;
  dims: Dims;
  dispose: () => void;
}

interface Dims {
  thigh: number;
  shin: number;
  torso: number;
  torsoR: number;
  headR: number;
  upper: number;
  fore: number;
  limb: number;
}

function dimsFor(build: Hero3D["build"]): Dims {
  if (build === "adult") return { thigh: 0.4, shin: 0.4, torso: 0.52, torsoR: 0.17, headR: 0.17, upper: 0.27, fore: 0.25, limb: 0.058 };
  if (build === "teen") return { thigh: 0.31, shin: 0.31, torso: 0.42, torsoR: 0.145, headR: 0.19, upper: 0.21, fore: 0.2, limb: 0.05 };
  return { thigh: 0.18, shin: 0.17, torso: 0.3, torsoR: 0.14, headR: 0.225, upper: 0.14, fore: 0.13, limb: 0.045 };
}

/** Lighten toward white (storybook pastel) or keep; darken for shading accents. */
export function shade(hex: string, k: number): THREE.Color {
  const c = new THREE.Color(hex);
  if (k > 0) c.lerp(new THREE.Color("#ffffff"), k);
  else c.multiplyScalar(1 + k);
  return c;
}

/** A material factory for one look, cached by colour so a film shares them. */
export class Materials {
  private cache = new Map<string, THREE.Material>();
  constructor(readonly look: Look) {}

  get(hex: string, opts: { emissive?: number; map?: THREE.Texture; key?: string; side?: THREE.Side } = {}): THREE.Material {
    const key = `${hex}|${opts.emissive ?? 0}|${opts.key ?? ""}|${opts.side ?? 0}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const color = this.look === "storybook" ? shade(hex, 0.22) : new THREE.Color(hex);
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: this.look === "clay" ? 0.95 : this.look === "storybook" ? 0.8 : this.look === "neon" ? 0.35 : 0.42,
      metalness: 0,
      map: opts.map ?? null,
      side: opts.side ?? THREE.FrontSide,
      emissive: opts.emissive ? color.clone() : new THREE.Color(0x000000),
      emissiveIntensity: opts.emissive ?? 0,
    });
    this.cache.set(key, m);
    return m;
  }

  dispose() {
    for (const m of this.cache.values()) {
      (m as THREE.MeshStandardMaterial).map?.dispose();
      m.dispose();
    }
    this.cache.clear();
  }
}

/** A small repeating cloth texture: stripes or dots in a lighter shade. */
function patternTexture(base: string, pattern: "stripes" | "dots"): THREE.Texture | undefined {
  if (typeof document === "undefined") return undefined;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (!g) return undefined;
  g.fillStyle = base;
  g.fillRect(0, 0, 64, 64);
  const light = `#${shade(base, 0.55).getHexString()}`;
  g.fillStyle = light;
  if (pattern === "stripes") {
    g.fillRect(0, 0, 64, 14);
    g.fillRect(0, 32, 64, 14);
  } else {
    for (const [x, y] of [[12, 12], [44, 12], [28, 34], [12, 54], [44, 54]]) {
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(pattern === "stripes" ? 1 : 3, pattern === "stripes" ? 3 : 3);
  return tex;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  m.receiveShadow = false;
  return m;
}

function group(name: string, parent?: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  parent?.add(g);
  return g;
}

/** Put a mesh on the head's surface at (x, y) (in head radii), facing outward. */
function onHead(m: THREE.Object3D, R: number, x: number, y: number, lift = 0.01): THREE.Object3D {
  const zz = Math.sqrt(Math.max(0.01, 1 - x * x - y * y));
  const n = new THREE.Vector3(x, y, zz).normalize();
  m.position.copy(n.clone().multiplyScalar(R * (1 + lift)));
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  return m;
}

export function buildHero(spec: Hero3D, mats: Materials): HeroRig {
  const d = dimsFor(spec.build);
  const R = d.headR;
  const legLen = d.thigh + d.shin + d.limb;
  const geos: THREE.BufferGeometry[] = [];
  const G = <T extends THREE.BufferGeometry>(g: T): T => {
    geos.push(g);
    return g;
  };

  const skin = mats.get(spec.skin);
  const skinDark = mats.get(`#${shade(spec.skin, -0.12).getHexString()}`);
  const hairM = mats.get(spec.hair);
  const tex = spec.pattern !== "plain" ? patternTexture(spec.top, spec.pattern) : undefined;
  const topM = mats.get(spec.top, tex ? { map: tex, key: `pat-${spec.pattern}` } : {});
  const topPlain = mats.get(spec.top);
  const bottomM = mats.get(spec.bottom);
  const shoeM = mats.get(spec.shoes);
  const accentM = mats.get(spec.accent, { emissive: mats.look === "neon" ? 0.6 : 0 });
  const ink = mats.get("#1b1210");
  const white = mats.get("#ffffff", { emissive: 0.15 });
  const iris = mats.get(spec.eyes);
  const blush = mats.get("#f08a8a");
  const mouthIn = mats.get("#7a2430");

  const root = group("hero");
  const body = group("body", root);
  const hips = group("hips", body, 0, legLen, 0);

  // Pelvis joins the legs to the torso, in the bottom colour.
  const pelvis = mesh(G(new THREE.SphereGeometry(d.torsoR * 0.92, 20, 14)), spec.bottomKind === "skirt" || spec.topKind === "dress" ? topPlain : bottomM);
  pelvis.scale.set(1, 0.7, 0.85);
  pelvis.position.y = 0.01;
  hips.add(pelvis);

  const spine = group("spine", hips);
  const torso = mesh(G(new THREE.CapsuleGeometry(d.torsoR, d.torso * 0.62, 6, 20)), topM);
  torso.scale.set(1, 1, 0.84);
  torso.position.y = d.torso * 0.45;
  spine.add(torso);

  if (spec.topKind === "hoodie") {
    const hood = mesh(G(new THREE.TorusGeometry(d.torsoR * 0.75, d.torsoR * 0.32, 10, 20)), topPlain);
    hood.rotation.x = Math.PI / 2 - 0.4;
    hood.position.set(0, d.torso * 0.92, -d.torsoR * 0.45);
    spine.add(hood);
    const pocket = mesh(G(new THREE.BoxGeometry(d.torsoR * 1.1, d.torso * 0.22, 0.02)), mats.get(`#${shade(spec.top, -0.15).getHexString()}`));
    pocket.position.set(0, d.torso * 0.22, d.torsoR * 0.86);
    spine.add(pocket);
  }
  if (spec.topKind === "jacket") {
    const zip = mesh(G(new THREE.BoxGeometry(0.018, d.torso * 0.85, 0.02)), accentM);
    zip.position.set(0, d.torso * 0.45, d.torsoR * 0.84);
    spine.add(zip);
  }
  if (spec.topKind === "dress" || spec.bottomKind === "skirt") {
    const skirtM = spec.topKind === "dress" ? topM : bottomM;
    const skirt = mesh(G(new THREE.CylinderGeometry(d.torsoR * 0.95, d.torsoR * 1.75, d.thigh * 1.15, 20, 1, true)), skirtM);
    (skirt.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    skirt.position.y = -d.thigh * 0.45;
    hips.add(skirt);
  }

  const chest = group("chest", spine, 0, d.torso * 0.86, 0);

  // --- head ---------------------------------------------------------------
  const head = group("head", chest, 0, R * 0.92, 0);
  const skull = mesh(G(new THREE.SphereGeometry(R, 32, 24)), skin);
  skull.scale.set(1, 0.96, 0.94);
  head.add(skull);
  for (const s of [-1, 1]) {
    const ear = mesh(G(new THREE.SphereGeometry(R * 0.2, 12, 10)), skin);
    ear.scale.set(0.55, 0.9, 0.6);
    ear.position.set(s * R * 0.95, 0, 0);
    head.add(ear);
  }
  const nose = mesh(G(new THREE.SphereGeometry(R * 0.085, 10, 8)), skinDark, false);
  head.add(onHead(nose, R * 0.94, 0, -0.12, 0.02));

  const eyes: THREE.Object3D[] = [];
  const brows: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    const ball = mesh(G(new THREE.SphereGeometry(R * 0.14, 14, 12)), ink, false);
    ball.scale.set(0.82, 1.08, 0.45);
    eye.add(ball);
    const ring = mesh(G(new THREE.SphereGeometry(R * 0.1, 12, 10)), iris, false);
    ring.scale.set(0.82, 1.05, 0.3);
    ring.position.z = R * 0.04;
    eye.add(ring);
    const glint = mesh(G(new THREE.SphereGeometry(R * 0.04, 8, 6)), white, false);
    glint.position.set(R * 0.035, R * 0.05, R * 0.065);
    eye.add(glint);
    head.add(onHead(eye, R * 0.94, s * 0.34, 0.06, 0.0));
    eyes.push(eye);
    const brow = mesh(G(new THREE.CapsuleGeometry(R * 0.028, R * 0.16, 3, 6)), hairM, false);
    brow.rotation.z = Math.PI / 2;
    const bg = new THREE.Group();
    bg.add(brow);
    head.add(onHead(bg, R * 0.95, s * 0.34, 0.36, 0.02));
    bg.userData.side = s;
    brows.push(bg);
  }
  const cheeks: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const cheek = mesh(G(new THREE.CircleGeometry(R * 0.11, 16)), blush, false);
    (cheek.material as THREE.MeshStandardMaterial).transparent = true;
    (cheek.material as THREE.MeshStandardMaterial).opacity = 0.55;
    head.add(onHead(cheek, R * 0.95, s * 0.55, -0.16, 0.03));
    cheeks.push(cheek);
  }

  const mouthAt = (m: THREE.Object3D) => head.add(onHead(m, R * 0.94, 0, -0.34, 0.03));
  const smile = mesh(G(new THREE.TorusGeometry(R * 0.17, R * 0.032, 6, 18, Math.PI)), ink, false);
  smile.rotation.z = Math.PI;
  const smileG = new THREE.Group();
  smileG.add(smile);
  smile.position.y = R * 0.06;
  mouthAt(smileG);
  const sad = mesh(G(new THREE.TorusGeometry(R * 0.13, R * 0.03, 6, 18, Math.PI)), ink, false);
  const sadG = new THREE.Group();
  sadG.add(sad);
  sad.position.y = -R * 0.1;
  mouthAt(sadG);
  const open = mesh(G(new THREE.SphereGeometry(R * 0.11, 14, 10)), mouthIn, false);
  open.scale.set(1, 1.2, 0.35);
  const openG = new THREE.Group();
  openG.add(open);
  mouthAt(openG);
  const line = mesh(G(new THREE.CapsuleGeometry(R * 0.025, R * 0.16, 3, 6)), ink, false);
  line.rotation.z = Math.PI / 2;
  const lineG = new THREE.Group();
  lineG.add(line);
  mouthAt(lineG);
  const grin = mesh(G(new THREE.CircleGeometry(R * 0.2, 20, Math.PI, Math.PI)), mouthIn, false);
  const grinG = new THREE.Group();
  grinG.add(grin);
  grin.position.y = R * 0.06;
  mouthAt(grinG);

  // --- hair ---------------------------------------------------------------
  const hairRoot = new THREE.Group();
  head.add(hairRoot);
  const capTheta = spec.hairStyle === "buzz" ? 0.5 : 0.53;
  if (spec.hairStyle !== "afro") {
    const cap = mesh(G(new THREE.SphereGeometry(R * (spec.hairStyle === "buzz" ? 1.02 : 1.07), 28, 16, 0, Math.PI * 2, 0, Math.PI * capTheta)), hairM);
    cap.rotation.x = -0.5;
    cap.scale.set(1.02, 1, 1);
    hairRoot.add(cap);
  }
  const seedOf = (n: number) => rand(spec.name.length * 977 + 13, n);
  switch (spec.hairStyle) {
    case "curly":
      for (let i = 0; i < 26; i++) {
        const a = seedOf(i) * Math.PI * 2;
        const el = 0.15 + seedOf(i + 50) * 1.05;
        const v = new THREE.Vector3(Math.cos(a) * Math.sin(el), Math.cos(el), Math.sin(a) * Math.sin(el));
        if (v.z > 0.55 && v.y < 0.75) continue;
        const b = mesh(G(new THREE.SphereGeometry(R * (0.2 + seedOf(i + 90) * 0.08), 10, 8)), hairM);
        b.position.copy(v.multiplyScalar(R * 1.04));
        hairRoot.add(b);
      }
      break;
    case "afro": {
      const fro = mesh(G(new THREE.SphereGeometry(R * 1.48, 28, 20)), hairM);
      fro.position.set(0, R * 0.38, -R * 0.28);
      fro.scale.set(1, 0.92, 0.95);
      hairRoot.add(fro);
      break;
    }
    case "long": {
      const back = mesh(G(new THREE.CapsuleGeometry(R * 0.82, R * 1.0, 6, 18)), hairM);
      back.position.set(0, -R * 0.45, -R * 0.42);
      back.scale.set(1.05, 1, 0.55);
      hairRoot.add(back);
      for (const s of [-1, 1]) {
        const lock = mesh(G(new THREE.CapsuleGeometry(R * 0.2, R * 0.9, 4, 10)), hairM);
        lock.position.set(s * R * 0.82, -R * 0.45, R * 0.12);
        hairRoot.add(lock);
      }
      break;
    }
    case "ponytail": {
      const tail = mesh(G(new THREE.CapsuleGeometry(R * 0.2, R * 0.85, 4, 12)), hairM);
      tail.position.set(0, -R * 0.05, -R * 1.18);
      tail.rotation.x = 0.55;
      hairRoot.add(tail);
      const band = mesh(G(new THREE.TorusGeometry(R * 0.19, R * 0.05, 8, 14)), accentM);
      band.position.set(0, R * 0.32, -R * 0.98);
      band.rotation.x = 1.2;
      hairRoot.add(band);
      break;
    }
    case "puffs":
      for (const s of [-1, 1]) {
        const puff = mesh(G(new THREE.SphereGeometry(R * 0.45, 18, 14)), hairM);
        puff.position.set(s * R * 0.82, R * 0.78, -R * 0.12);
        hairRoot.add(puff);
      }
      break;
    case "spiky":
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const spike = mesh(G(new THREE.ConeGeometry(R * 0.2, R * 0.55, 8)), hairM);
        const v = new THREE.Vector3(Math.cos(a) * 0.55, 0.82, Math.sin(a) * 0.55 - 0.15).normalize();
        spike.position.copy(v.clone().multiplyScalar(R * 1.0));
        spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
        hairRoot.add(spike);
      }
      break;
    case "bun": {
      const bun = mesh(G(new THREE.SphereGeometry(R * 0.42, 16, 12)), hairM);
      bun.position.set(0, R * 1.05, -R * 0.3);
      hairRoot.add(bun);
      break;
    }
    default: {
      // short: a soft fringe over the forehead
      for (let i = 0; i < 5; i++) {
        const f = mesh(G(new THREE.SphereGeometry(R * 0.22, 10, 8)), hairM);
        const x = (i - 2) * 0.24;
        f.position.copy(new THREE.Vector3(x, 0.62, Math.sqrt(Math.max(0, 1 - x * x - 0.38))).multiplyScalar(R * 0.98));
        f.scale.set(1, 0.7, 0.7);
        hairRoot.add(f);
      }
    }
  }

  // --- accessories --------------------------------------------------------
  let cape: THREE.Object3D | undefined;
  switch (spec.accessory) {
    case "cap": {
      const crown = mesh(G(new THREE.SphereGeometry(R * 1.12, 26, 12, 0, Math.PI * 2, 0, Math.PI * 0.42)), accentM);
      crown.rotation.x = -0.2;
      head.add(crown);
      const brim = mesh(G(new THREE.CylinderGeometry(R * 0.78, R * 0.78, R * 0.06, 20, 1, false, -Math.PI / 2, Math.PI)), accentM);
      brim.position.set(0, R * 0.52, R * 0.62);
      brim.rotation.x = 0.18;
      brim.scale.set(1, 1, 0.85);
      head.add(brim);
      const button = mesh(G(new THREE.SphereGeometry(R * 0.09, 8, 6)), white);
      button.position.set(0, R * 1.13, -R * 0.2);
      head.add(button);
      break;
    }
    case "glasses":
      for (const s of [-1, 1]) {
        const rim = mesh(G(new THREE.TorusGeometry(R * 0.2, R * 0.032, 8, 20)), accentM, false);
        head.add(onHead(rim, R * 1.0, s * 0.34, 0.06, 0.06));
      }
      {
        const bridge = mesh(G(new THREE.BoxGeometry(R * 0.26, R * 0.04, R * 0.04)), accentM, false);
        head.add(onHead(bridge, R * 1.0, 0, 0.1, 0.1));
      }
      break;
    case "headphones": {
      const band = mesh(G(new THREE.TorusGeometry(R * 1.12, R * 0.07, 8, 28, Math.PI)), accentM);
      head.add(band);
      for (const s of [-1, 1]) {
        const cup = mesh(G(new THREE.CylinderGeometry(R * 0.3, R * 0.3, R * 0.2, 18)), accentM);
        cup.rotation.z = Math.PI / 2;
        cup.position.set(s * R * 1.08, 0, 0);
        head.add(cup);
      }
      break;
    }
    case "bow":
      for (const s of [-1, 1]) {
        const loop = mesh(G(new THREE.SphereGeometry(R * 0.24, 12, 10)), accentM);
        loop.scale.set(1.2, 0.75, 0.5);
        loop.position.set(R * (0.45 + s * 0.24), R * 0.92, R * 0.1);
        head.add(loop);
      }
      break;
    case "crown": {
      const gold = mats.get("#f4c542", { emissive: 0.15 });
      const ring = mesh(G(new THREE.CylinderGeometry(R * 0.62, R * 0.58, R * 0.32, 20, 1, true)), gold);
      (ring.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      ring.position.y = R * 1.0;
      head.add(ring);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const pt = mesh(G(new THREE.ConeGeometry(R * 0.12, R * 0.3, 6)), gold);
        pt.position.set(Math.sin(a) * R * 0.6, R * 1.28, Math.cos(a) * R * 0.6);
        head.add(pt);
      }
      break;
    }
    case "backpack": {
      const pack = mesh(G(new THREE.BoxGeometry(d.torsoR * 1.5, d.torso * 0.85, d.torsoR * 0.9)), accentM);
      pack.position.set(0, -d.torso * 0.35, -d.torsoR * 1.15);
      chest.add(pack);
      const flap = mesh(G(new THREE.SphereGeometry(d.torsoR * 0.78, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), mats.get(`#${shade(spec.accent, -0.18).getHexString()}`));
      flap.position.set(0, d.torso * 0.06, -d.torsoR * 1.15);
      flap.scale.set(1, 0.5, 0.62);
      chest.add(flap);
      break;
    }
    case "scarf": {
      const wrap = mesh(G(new THREE.TorusGeometry(d.torsoR * 0.72, d.torsoR * 0.28, 10, 22)), accentM);
      wrap.rotation.x = Math.PI / 2;
      wrap.position.y = d.torsoR * 0.1;
      chest.add(wrap);
      const tail = mesh(G(new THREE.BoxGeometry(d.torsoR * 0.42, d.torso * 0.55, d.torsoR * 0.16)), accentM);
      tail.position.set(d.torsoR * 0.35, -d.torso * 0.25, d.torsoR * 0.8);
      tail.rotation.z = 0.15;
      chest.add(tail);
      break;
    }
    case "cape": {
      const pivot = new THREE.Group();
      pivot.position.set(0, d.torsoR * 0.1, -d.torsoR * 0.8);
      const cloth = mesh(G(new THREE.PlaneGeometry(d.torsoR * 2.6, d.torso + d.thigh + d.shin * 0.6, 4, 6)), mats.get(spec.accent, { side: THREE.DoubleSide, key: "cape" }));
      cloth.position.y = -(d.torso + d.thigh + d.shin * 0.6) / 2;
      pivot.add(cloth);
      chest.add(pivot);
      cape = pivot;
      break;
    }
  }

  // --- arms ---------------------------------------------------------------
  const shoulderW = d.torsoR + d.limb * 0.6;
  const sleeveFull = spec.topKind === "hoodie" || spec.topKind === "jacket";
  const sleeveless = spec.topKind === "dress";
  const makeArm = (s: number) => {
    const shoulder = group(s < 0 ? "shoulderR" : "shoulderL", chest, s * shoulderW, -d.limb * 0.6, 0);
    const upper = mesh(G(new THREE.CapsuleGeometry(d.limb, d.upper, 4, 12)), skin);
    upper.position.y = -d.upper / 2;
    shoulder.add(upper);
    if (!sleeveless) {
      const sleeve = mesh(G(new THREE.CapsuleGeometry(d.limb * 1.3, sleeveFull ? d.upper : d.upper * 0.45, 4, 12)), topPlain);
      sleeve.position.y = sleeveFull ? -d.upper / 2 : -d.upper * 0.18;
      shoulder.add(sleeve);
    }
    const elbow = group(s < 0 ? "elbowR" : "elbowL", shoulder, 0, -d.upper, 0);
    const fore = mesh(G(new THREE.CapsuleGeometry(d.limb * 0.95, d.fore, 4, 12)), sleeveFull ? topPlain : skin);
    fore.position.y = -d.fore / 2;
    elbow.add(fore);
    const hand = mesh(G(new THREE.SphereGeometry(d.limb * 1.45, 12, 10)), skin);
    hand.position.y = -d.fore - d.limb * 0.6;
    elbow.add(hand);
    return { shoulder, elbow, hand };
  };
  const armL = makeArm(1);
  const armR = makeArm(-1);

  // --- legs ---------------------------------------------------------------
  const hipW = d.torsoR * 0.5;
  const longBottom = spec.bottomKind === "pants";
  const bareLegs = spec.bottomKind === "skirt" || spec.topKind === "dress";
  const makeLeg = (s: number) => {
    const hip = group(s < 0 ? "hipR" : "hipL", hips, s * hipW, 0, 0);
    const thigh = mesh(G(new THREE.CapsuleGeometry(d.limb * 1.2, d.thigh, 4, 12)), bareLegs ? skin : bottomM);
    thigh.position.y = -d.thigh / 2;
    hip.add(thigh);
    const knee = group(s < 0 ? "kneeR" : "kneeL", hip, 0, -d.thigh, 0);
    const shin = mesh(G(new THREE.CapsuleGeometry(d.limb * 1.05, d.shin, 4, 12)), longBottom ? bottomM : skin);
    shin.position.y = -d.shin / 2;
    knee.add(shin);
    const shoe = mesh(G(new THREE.SphereGeometry(d.limb * 1.7, 14, 10)), shoeM);
    shoe.scale.set(0.95, 0.62, 1.45);
    shoe.position.set(0, -d.shin - d.limb * 0.55, d.limb * 0.7);
    knee.add(shoe);
    const sole = mesh(G(new THREE.CylinderGeometry(d.limb * 1.55, d.limb * 1.55, d.limb * 0.35, 14)), white);
    sole.scale.set(0.95, 1, 1.45);
    sole.position.set(0, -d.shin - d.limb * 1.0, d.limb * 0.7);
    knee.add(sole);
    return { hip, knee };
  };
  const legL = makeLeg(1);
  const legR = makeLeg(-1);

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).receiveShadow = false;
  });

  return {
    root,
    body,
    hips,
    spine,
    chest,
    head,
    shoulderL: armL.shoulder,
    shoulderR: armR.shoulder,
    elbowL: armL.elbow,
    elbowR: armR.elbow,
    handR: armR.hand,
    hipL: legL.hip,
    hipR: legR.hip,
    kneeL: legL.knee,
    kneeR: legR.knee,
    eyes,
    brows,
    mouths: { smile: smileG, sad: sadG, open: openG, line: lineG, grin: grinG },
    cheeks,
    cape,
    height: heroHeight(spec.build),
    dims: d,
    dispose: () => geos.forEach((g) => g.dispose()),
  };
}

export interface PoseState {
  move: Move;
  phase: number;
  expression: Expression;
  blink: number;
  talk: number;
  lookYaw: number;
  facing: number;
  /** World travel speed (for the cape). */
  speed: number;
}

const TAU = Math.PI * 2;

/** Set every joint of the rig for one moment. Pure function of the state. */
export function poseHero(rig: HeroRig, s: PoseState): void {
  const d = rig.dims;
  const H = rig.height;
  const p = s.phase;
  // neutral
  rig.root.rotation.set(0, s.facing, 0);
  rig.body.position.set(0, 0, 0);
  rig.body.rotation.set(0, 0, 0);
  rig.hips.rotation.set(0, 0, 0);
  rig.spine.rotation.set(0, 0, 0);
  rig.spine.scale.set(1, 1, 1);
  rig.head.rotation.set(0, s.lookYaw, 0);
  rig.shoulderL.rotation.set(0, 0, 0.12);
  rig.shoulderR.rotation.set(0, 0, -0.12);
  rig.elbowL.rotation.set(0, 0, 0);
  rig.elbowR.rotation.set(0, 0, 0);
  rig.hipL.rotation.set(0, 0, 0);
  rig.hipR.rotation.set(0, 0, 0);
  rig.kneeL.rotation.set(0, 0, 0);
  rig.kneeR.rotation.set(0, 0, 0);
  const breathe = Math.sin(p * 2.4) * 0.012;
  rig.spine.scale.set(1, 1 + breathe, 1 + breathe * 0.6);

  const legLen = d.thigh + d.shin + d.limb;
  switch (s.move) {
    case "walk":
    case "run": {
      const run = s.move === "run";
      const f = run ? 3.1 : 1.9;
      const a = p * f * TAU;
      const swing = run ? 0.95 : 0.5;
      rig.hipL.rotation.x = -Math.sin(a) * swing;
      rig.hipR.rotation.x = Math.sin(a) * swing;
      rig.kneeL.rotation.x = Math.max(0, Math.sin(a + 1.6)) * (run ? 1.5 : 0.7);
      rig.kneeR.rotation.x = Math.max(0, Math.sin(a + 1.6 + Math.PI)) * (run ? 1.5 : 0.7);
      rig.shoulderL.rotation.x = Math.sin(a) * (run ? 1.0 : 0.5);
      rig.shoulderR.rotation.x = -Math.sin(a) * (run ? 1.0 : 0.5);
      rig.elbowL.rotation.x = -(run ? 1.3 : 0.35);
      rig.elbowR.rotation.x = -(run ? 1.3 : 0.35);
      rig.spine.rotation.x = run ? 0.2 : 0.04;
      rig.spine.rotation.y = Math.sin(a) * (run ? 0.12 : 0.06);
      rig.body.position.y = Math.abs(Math.sin(a)) * (run ? 0.06 : 0.025) * H;
      rig.head.rotation.x = run ? -0.12 : 0;
      break;
    }
    case "jump":
    case "cheer": {
      const cyc = s.move === "cheer" ? 0.7 : 1.0;
      const q = (p % cyc) / cyc;
      const air = q > 0.2 && q < 0.85 ? Math.sin(((q - 0.2) / 0.65) * Math.PI) : 0;
      const crouch = q <= 0.2 ? Math.sin((q / 0.2) * Math.PI) : q >= 0.85 ? Math.sin(((q - 0.85) / 0.15) * Math.PI) : 0;
      const hop = s.move === "cheer" ? 0.14 : 0.42;
      rig.body.position.y = air * hop * H - crouch * 0.06 * H;
      rig.hipL.rotation.x = rig.hipR.rotation.x = -crouch * 0.7 - air * 0.3;
      rig.kneeL.rotation.x = rig.kneeR.rotation.x = crouch * 1.2 + air * 0.6;
      const up = s.move === "cheer" ? 2.7 : 0.6 + air * 2.0;
      rig.shoulderL.rotation.z = up;
      rig.shoulderR.rotation.z = -up;
      rig.elbowL.rotation.x = rig.elbowR.rotation.x = -0.2;
      rig.spine.rotation.x = -air * 0.08 + crouch * 0.2;
      rig.head.rotation.x = -0.15;
      break;
    }
    case "wave": {
      rig.shoulderR.rotation.z = -2.5;
      rig.shoulderR.rotation.x = -0.25;
      rig.elbowR.rotation.z = Math.sin(p * 9) * 0.55 - 0.2;
      rig.shoulderL.rotation.z = 0.18;
      rig.spine.rotation.z = Math.sin(p * 2.2) * 0.04;
      rig.head.rotation.z = Math.sin(p * 2.2 + 0.5) * 0.08;
      break;
    }
    case "dance": {
      const a = p * 2.2 * TAU;
      rig.hips.rotation.z = Math.sin(a) * 0.12;
      rig.spine.rotation.z = -Math.sin(a) * 0.18;
      rig.body.position.y = Math.abs(Math.sin(a)) * 0.04 * H;
      rig.shoulderL.rotation.z = 1.4 + Math.sin(a) * 1.1;
      rig.shoulderR.rotation.z = -1.4 + Math.sin(a) * 1.1;
      rig.elbowL.rotation.x = rig.elbowR.rotation.x = -0.8;
      rig.kneeL.rotation.x = Math.max(0, Math.sin(a)) * 0.6;
      rig.kneeR.rotation.x = Math.max(0, -Math.sin(a)) * 0.6;
      rig.hipL.rotation.x = -Math.max(0, Math.sin(a)) * 0.4;
      rig.hipR.rotation.x = -Math.max(0, -Math.sin(a)) * 0.4;
      rig.head.rotation.z = Math.sin(a + 0.6) * 0.15;
      rig.root.rotation.y = s.facing + Math.sin(p * 0.9) * 0.6;
      break;
    }
    case "sit":
    case "sleep": {
      rig.body.position.y = -legLen * 0.72;
      rig.hipL.rotation.x = rig.hipR.rotation.x = -1.45;
      rig.kneeL.rotation.x = rig.kneeR.rotation.x = 1.35;
      rig.hipL.rotation.z = 0.12;
      rig.hipR.rotation.z = -0.12;
      rig.shoulderL.rotation.x = rig.shoulderR.rotation.x = -0.6;
      rig.elbowL.rotation.x = rig.elbowR.rotation.x = -0.7;
      if (s.move === "sleep") {
        rig.head.rotation.z = 0.35;
        rig.head.rotation.x = 0.25;
        rig.spine.rotation.x = 0.15 + Math.sin(p * 1.4) * 0.02;
      }
      break;
    }
    case "point": {
      rig.shoulderR.rotation.x = -1.55;
      rig.shoulderR.rotation.z = -0.15;
      rig.elbowR.rotation.x = -0.05;
      rig.head.rotation.y = s.lookYaw - 0.2;
      rig.spine.rotation.x = 0.05;
      break;
    }
    case "sad": {
      rig.head.rotation.x = 0.38;
      rig.spine.rotation.x = 0.16;
      rig.shoulderL.rotation.set(0.15, 0, 0.04);
      rig.shoulderR.rotation.set(0.15, 0, -0.04);
      rig.body.position.y = -0.01 * H + Math.sin(p * 1.2) * 0.004 * H;
      break;
    }
    case "reach": {
      const hopT = clamp(p / 0.9);
      const hop = Math.sin(hopT * Math.PI);
      rig.body.position.y = hop * 0.3 * H;
      rig.shoulderR.rotation.x = -2.85;
      rig.shoulderR.rotation.z = -0.1;
      rig.elbowR.rotation.x = -0.05;
      rig.shoulderL.rotation.z = 0.9;
      rig.spine.rotation.x = -0.12;
      rig.head.rotation.x = -0.4;
      rig.hipL.rotation.x = -0.35 * hop;
      rig.kneeL.rotation.x = 0.8 * hop;
      rig.hipR.rotation.x = 0.25 * hop;
      rig.kneeR.rotation.x = 0.35 * hop;
      break;
    }
    case "look": {
      rig.shoulderL.rotation.x = -2.2;
      rig.shoulderL.rotation.z = 0.5;
      rig.elbowL.rotation.x = -2.0;
      rig.spine.rotation.x = -0.04;
      break;
    }
    case "talk": {
      rig.shoulderR.rotation.x = -0.6 - Math.sin(p * 3.1) * 0.25;
      rig.elbowR.rotation.x = -1.2;
      rig.shoulderL.rotation.x = -0.3 - Math.sin(p * 2.3 + 1) * 0.15;
      rig.elbowL.rotation.x = -0.9;
      rig.head.rotation.z = Math.sin(p * 1.7) * 0.06;
      break;
    }
    case "tumble": {
      // On his back, laughing, legs kicking — the payoff tumble.
      rig.body.position.y = -legLen * 0.75;
      rig.body.rotation.x = -1.05;
      rig.hipL.rotation.x = -1.2 + Math.sin(p * 9) * 0.35;
      rig.hipR.rotation.x = -1.2 - Math.sin(p * 9) * 0.35;
      rig.kneeL.rotation.x = 0.6;
      rig.kneeR.rotation.x = 0.6;
      rig.shoulderL.rotation.z = 2.4;
      rig.shoulderR.rotation.z = -2.4;
      break;
    }
    default: {
      // idle: weight shift and a little arm life
      rig.spine.rotation.z = Math.sin(p * 0.9) * 0.025;
      rig.head.rotation.z = Math.sin(p * 0.7 + 1) * 0.04;
      rig.shoulderL.rotation.x = Math.sin(p * 1.1) * 0.05;
      rig.shoulderR.rotation.x = Math.sin(p * 1.1 + 1) * 0.05;
    }
  }

  // Cape streams back with speed.
  if (rig.cape) rig.cape.rotation.x = -(0.08 + Math.min(1, s.speed / 2.6) * 0.9 + Math.sin(p * 7) * 0.06);

  // --- the face ---------------------------------------------------------
  const e = s.expression;
  const open = clamp(1 - s.blink * 0.94, 0.06, 1);
  for (const eye of rig.eyes) eye.scale.set(1, e === "delight" ? open * 0.55 : e === "wow" ? open * 1.18 : open, 1);
  for (const b of rig.brows) {
    const side = b.userData.side as number;
    const tilt = e === "sad" ? -0.32 : e === "focus" ? 0.3 : e === "wow" ? 0 : e === "delight" ? -0.1 : 0;
    b.rotation.z = side * tilt;
    b.position.y = b.userData.baseY ?? (b.userData.baseY = b.position.y);
    b.position.y = (b.userData.baseY as number) + (e === "wow" ? 0.025 : e === "delight" ? 0.012 : e === "focus" ? -0.008 : 0) * (rig.dims.headR / 0.225);
  }
  const talking = s.talk > 0.12;
  const pickMouth: keyof HeroRig["mouths"] =
    talking ? "open"
    : e === "smile" ? "smile"
    : e === "delight" ? "grin"
    : e === "wow" ? "open"
    : e === "sad" ? "sad"
    : "line";
  for (const [k, m] of Object.entries(rig.mouths)) m.visible = k === pickMouth;
  const om = rig.mouths.open;
  const oy = talking ? 0.45 + s.talk * 0.75 : 1.15;
  om.scale.set(talking ? 1.1 : 0.85, oy, 1);
  for (const c of rig.cheeks) c.visible = e === "smile" || e === "delight" || e === "sleepy";
}
