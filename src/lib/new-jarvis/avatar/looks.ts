// ---------------------------------------------------------------------------
// Jarvis's avatar — what it can look like.
//
// The avatar is ONE procedural body: a sphere whose every vertex is pushed out
// to a radius chosen by a "form" function of its direction. Morphing between a
// wolf and a robot is just blending two radii per vertex, which is why every
// change is a fluid melt rather than a swap. The same radius functions run in
// the vertex shader (components/new-jarvis/avatar/shaders.ts) and here, where
// they place the eyes, brows and mouth on the surface — so the face sits on
// the head whatever shape the head is mid-morph.
//
// Pure: no three.js, no DOM. Tested in looks.test.ts.
// ---------------------------------------------------------------------------

export const FORMS = ["humanoid", "robot", "wolf", "cat", "dragon", "alien", "orb", "crystal", "blob"] as const;
export type FormId = (typeof FORMS)[number];

export const MATERIALS = ["holo", "glass", "metal", "plasma", "matte", "wire"] as const;
export type MaterialId = (typeof MATERIALS)[number];

export const EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised", "thinking", "calm", "excited"] as const;
export type Emotion = (typeof EMOTIONS)[number];

export const GESTURES = ["nod", "shake", "tilt", "spin", "bounce", "wave"] as const;
export type Gesture = (typeof GESTURES)[number];

export interface AvatarLook {
  form: FormId;
  /** Main colour, `#rrggbb`. */
  primary: string;
  /** Second colour of the gradient, `#rrggbb`. */
  secondary: string;
  /** Eye colour, `#rrggbb`. */
  eye: string;
  material: MaterialId;
  /** 0–1.5: how much the body glows at its rim. */
  glow: number;
  /** 0–2: how bright the eyes are. */
  eyeGlow: number;
  /** 0.5–1.4: overall size. */
  scale: number;
  /** 0–2: how high and slow it floats. */
  float: number;
  /** A GLB/GLTF to load instead of the procedural body (loaded only when set). */
  model?: string;
}

export const DEFAULT_LOOK: AvatarLook = {
  form: "humanoid",
  primary: "#47e8ff",
  secondary: "#7c5cff",
  eye: "#ffffff",
  material: "holo",
  glow: 1,
  eyeGlow: 1.2,
  scale: 1,
  float: 1,
};

/** The looks it cycles through on its own, one every few seconds. */
export const PRESETS: { name: string; look: AvatarLook }[] = [
  { name: "Cyan hologram", look: DEFAULT_LOOK },
  { name: "Chrome robot", look: { ...DEFAULT_LOOK, form: "robot", primary: "#c9d6e8", secondary: "#3a4a66", eye: "#47e8ff", material: "metal", glow: 0.7, eyeGlow: 1.6 } },
  { name: "Frost wolf", look: { ...DEFAULT_LOOK, form: "wolf", primary: "#5ea8ff", secondary: "#bff8ff", eye: "#e6fbff", material: "holo", glow: 1.2 } },
  { name: "Ember dragon", look: { ...DEFAULT_LOOK, form: "dragon", primary: "#ff7a2f", secondary: "#ffd166", eye: "#fff1a8", material: "plasma", glow: 1.3, eyeGlow: 1.8 } },
  { name: "Prism crystal", look: { ...DEFAULT_LOOK, form: "crystal", primary: "#b794ff", secondary: "#47e8ff", eye: "#ffffff", material: "glass", glow: 1.1 } },
  { name: "Neon cat", look: { ...DEFAULT_LOOK, form: "cat", primary: "#ff4fd8", secondary: "#47e8ff", eye: "#d4ff3a", material: "wire", glow: 1.2, eyeGlow: 1.7 } },
  { name: "Violet alien", look: { ...DEFAULT_LOOK, form: "alien", primary: "#7cff9e", secondary: "#7c5cff", eye: "#05080f", material: "matte", glow: 0.8, eyeGlow: 0.6 } },
  { name: "Plasma orb", look: { ...DEFAULT_LOOK, form: "orb", primary: "#47e8ff", secondary: "#ff4fd8", eye: "#ffffff", material: "plasma", glow: 1.4 } },
  { name: "Lava blob", look: { ...DEFAULT_LOOK, form: "blob", primary: "#ff3d5a", secondary: "#ffb02e", eye: "#fff4d6", material: "plasma", glow: 1.2 } },
  { name: "Gold android", look: { ...DEFAULT_LOOK, form: "humanoid", primary: "#ffd27a", secondary: "#8a5a12", eye: "#47e8ff", material: "metal", glow: 0.6, eyeGlow: 1.5 } },
];

export function formIndex(form: FormId): number {
  return Math.max(0, FORMS.indexOf(form));
}

export function materialIndex(m: MaterialId): number {
  return Math.max(0, MATERIALS.indexOf(m));
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
const HEX = /^#[0-9a-f]{6}$/i;

/** Anything saved or said, made safe to draw: unknown forms and bad colours fall back. */
export function clampLook(raw: Partial<AvatarLook> | null | undefined, base: AvatarLook = DEFAULT_LOOK): AvatarLook {
  const r = raw ?? {};
  const model = typeof r.model === "string" && /^(https?:\/\/|\/)[^\s"'<>]+\.(glb|gltf)(\?[^\s"'<>]*)?$/i.test(r.model) ? r.model : undefined;
  return {
    form: (FORMS as readonly string[]).includes(r.form as string) ? (r.form as FormId) : base.form,
    primary: HEX.test(r.primary ?? "") ? r.primary!.toLowerCase() : base.primary,
    secondary: HEX.test(r.secondary ?? "") ? r.secondary!.toLowerCase() : base.secondary,
    eye: HEX.test(r.eye ?? "") ? r.eye!.toLowerCase() : base.eye,
    material: (MATERIALS as readonly string[]).includes(r.material as string) ? (r.material as MaterialId) : base.material,
    glow: clamp(r.glow ?? base.glow, 0, 1.5),
    eyeGlow: clamp(r.eyeGlow ?? base.eyeGlow, 0, 2),
    scale: clamp(r.scale ?? base.scale, 0.5, 1.4),
    float: clamp(r.float ?? base.float, 0, 2),
    ...(model ? { model } : {}),
  };
}

// --- the shape of each form --------------------------------------------------
// Directions are unit vectors with +y up and +z toward the viewer. Each form is
// a radius for a direction; the GLSL in shaders.ts is a line-for-line port, so
// change both together (looks.test.ts pins a few values).

export type Vec3 = [number, number, number];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** A soft bump centred on direction `c`: 1 at the centre, falling off with `k`. */
const bump = (d: Vec3, c: Vec3, k: number) => Math.exp(-k * (1 - dot(d, c)));
const ellipsoid = (d: Vec3, a: number, b: number, c: number) =>
  1 / Math.sqrt((d[0] / a) ** 2 + (d[1] / b) ** 2 + (d[2] / c) ** 2);
const superEllipsoid = (d: Vec3, a: number, b: number, c: number, p: number) =>
  (Math.abs(d[0] / a) ** p + Math.abs(d[1] / b) ** p + Math.abs(d[2] / c) ** p) ** (-1 / p);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

const EAR_L = norm([-0.5, 0.85, 0.1]);
const EAR_R = norm([0.5, 0.85, 0.1]);
const CAT_L = norm([-0.6, 0.78, 0.15]);
const CAT_R = norm([0.6, 0.78, 0.15]);
const HORN_L = norm([-0.45, 0.8, -0.4]);
const HORN_R = norm([0.45, 0.8, -0.4]);
const SNOUT = norm([0, -0.25, 0.97]);
const MUZZLE = norm([0, -0.3, 0.95]);
const DSNOUT = norm([0, -0.15, 0.99]);
const NOSE = norm([0, -0.05, 1]);
const UP: Vec3 = [0, 1, 0];

/** The surface radius of `form` in direction `d` (unit vector). */
export function formRadius(form: number, d: Vec3): number {
  switch (form) {
    case 0: {
      // humanoid: an egg, narrower at the jaw, a nose
      const a = 0.8 - 0.12 * Math.max(0, -d[1]);
      return ellipsoid(d, a, 1.0, 0.86) + 0.06 * bump(d, NOSE, 60);
    }
    case 1:
      // robot: a rounded box with an antenna
      return superEllipsoid(d, 0.86, 0.92, 0.8, 6) + 0.32 * bump(d, UP, 400);
    case 2:
      // wolf: snout and tall ears
      return ellipsoid(d, 0.8, 0.85, 0.85) + 0.55 * bump(d, SNOUT, 10) + 0.55 * bump(d, EAR_L, 40) + 0.55 * bump(d, EAR_R, 40);
    case 3:
      // cat: round head, pointed ears, small muzzle
      return ellipsoid(d, 0.86, 0.82, 0.8) + 0.4 * bump(d, CAT_L, 45) + 0.4 * bump(d, CAT_R, 45) + 0.15 * bump(d, MUZZLE, 14);
    case 4:
      // dragon: long snout, swept horns
      return ellipsoid(d, 0.78, 0.85, 0.95) + 0.7 * bump(d, DSNOUT, 8) + 0.75 * bump(d, HORN_L, 60) + 0.75 * bump(d, HORN_R, 60);
    case 5: {
      // alien: huge cranium, tiny chin
      const a = 0.5 + 0.42 * smoothstep(-1, 0.6, d[1]);
      return ellipsoid(d, a, 1.05, a);
    }
    case 6:
      // orb: a sphere (the shader adds its ripple)
      return 0.9;
    case 7: {
      // crystal: faceted, taller than wide
      const q: Vec3 = [Math.abs(d[0]), Math.abs(d[1]) / 1.3, Math.abs(d[2])];
      const m = Math.max(q[0], q[1], q[2], (q[0] + q[1] + q[2]) / Math.sqrt(3) / 0.82);
      return 0.82 / m;
    }
    default:
      // blob: a sphere (the shader adds the slow liquid noise)
      return 0.85;
  }
}

export interface FaceRig {
  eyeL: Vec3;
  eyeR: Vec3;
  mouth: Vec3;
  /** Eye half-size (x, y) in head units. */
  eyeSize: [number, number];
  /** Pupil size as a fraction of the eye (x, y); 0 = no pupil (a visor). */
  pupil: [number, number];
  /** Eye tilt, radians (positive = outer corner up). */
  eyeTilt: number;
  mouthWidth: number;
  /** 0–1: whether it has brows. */
  brows: number;
}

/** Where the face sits on each form, as directions from the centre. */
export const FACES: FaceRig[] = [
  { eyeL: norm([-0.32, 0.14, 0.94]), eyeR: norm([0.32, 0.14, 0.94]), mouth: norm([0, -0.38, 0.92]), eyeSize: [0.085, 0.07], pupil: [0.5, 0.5], eyeTilt: 0, mouthWidth: 0.2, brows: 1 },
  { eyeL: norm([-0.3, 0.12, 0.95]), eyeR: norm([0.3, 0.12, 0.95]), mouth: norm([0, -0.34, 0.94]), eyeSize: [0.15, 0.05], pupil: [0, 0], eyeTilt: 0, mouthWidth: 0.28, brows: 0 },
  { eyeL: norm([-0.33, 0.24, 0.91]), eyeR: norm([0.33, 0.24, 0.91]), mouth: norm([0, -0.5, 0.87]), eyeSize: [0.1, 0.06], pupil: [0.45, 0.6], eyeTilt: 0.35, mouthWidth: 0.24, brows: 0.6 },
  { eyeL: norm([-0.32, 0.12, 0.94]), eyeR: norm([0.32, 0.12, 0.94]), mouth: norm([0, -0.38, 0.92]), eyeSize: [0.1, 0.1], pupil: [0.22, 0.85], eyeTilt: 0.2, mouthWidth: 0.16, brows: 0.3 },
  { eyeL: norm([-0.36, 0.26, 0.9]), eyeR: norm([0.36, 0.26, 0.9]), mouth: norm([0, -0.42, 0.9]), eyeSize: [0.1, 0.055], pupil: [0.2, 0.85], eyeTilt: 0.4, mouthWidth: 0.3, brows: 1 },
  { eyeL: norm([-0.3, 0.02, 0.95]), eyeR: norm([0.3, 0.02, 0.95]), mouth: norm([0, -0.45, 0.89]), eyeSize: [0.17, 0.1], pupil: [0, 0], eyeTilt: 0.45, mouthWidth: 0.1, brows: 0 },
  { eyeL: norm([-0.28, 0.12, 0.95]), eyeR: norm([0.28, 0.12, 0.95]), mouth: norm([0, -0.3, 0.95]), eyeSize: [0.12, 0.12], pupil: [0.4, 0.4], eyeTilt: 0, mouthWidth: 0.22, brows: 0 },
  { eyeL: norm([-0.25, 0.15, 0.95]), eyeR: norm([0.25, 0.15, 0.95]), mouth: norm([0, -0.3, 0.95]), eyeSize: [0.08, 0.08], pupil: [0.35, 0.35], eyeTilt: 0, mouthWidth: 0.16, brows: 0 },
  { eyeL: norm([-0.3, 0.16, 0.94]), eyeR: norm([0.3, 0.16, 0.94]), mouth: norm([0, -0.32, 0.94]), eyeSize: [0.11, 0.13], pupil: [0.45, 0.45], eyeTilt: 0, mouthWidth: 0.24, brows: 0.4 },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => norm([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);

/** The face part-way through a morph from form `a` to form `b`. */
export function faceBetween(a: number, b: number, t: number): FaceRig {
  const A = FACES[a] ?? FACES[0];
  const B = FACES[b] ?? FACES[0];
  return {
    eyeL: lerp3(A.eyeL, B.eyeL, t),
    eyeR: lerp3(A.eyeR, B.eyeR, t),
    mouth: lerp3(A.mouth, B.mouth, t),
    eyeSize: [lerp(A.eyeSize[0], B.eyeSize[0], t), lerp(A.eyeSize[1], B.eyeSize[1], t)],
    pupil: [lerp(A.pupil[0], B.pupil[0], t), lerp(A.pupil[1], B.pupil[1], t)],
    eyeTilt: lerp(A.eyeTilt, B.eyeTilt, t),
    mouthWidth: lerp(A.mouthWidth, B.mouthWidth, t),
    brows: lerp(A.brows, B.brows, t),
  };
}

/** A point on the surface part-way through a morph — where a face part goes. */
export function surfacePoint(a: number, b: number, t: number, d: Vec3): Vec3 {
  const r = lerp(formRadius(a, d), formRadius(b, d), t);
  return [d[0] * r, d[1] * r, d[2] * r];
}

/** The next preset in the cycle, never the same as the current one. */
export function nextPreset(i: number): number {
  return (i + 1) % PRESETS.length;
}

/** "#47e8ff" → [r, g, b] in 0–1. */
export function hexToRgb(hex: string): Vec3 {
  const n = parseInt(hex.replace("#", ""), 16);
  if (!Number.isFinite(n)) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
