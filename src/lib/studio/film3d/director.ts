// ---------------------------------------------------------------------------
// The director: one moment of the film, as plain numbers.
//
// `frameAt(film, t)` answers everything the renderer needs for time t — which
// world and light, where the hero stands and what his body is doing, where
// the thing he wants is, where the camera sits and looks, which caption shows
// and how much of the screen is faded. It is pure and deterministic (seeded,
// never the clock), so the browser preview, the browser MP4 and the PC's HD
// render all show the very same film, and it can be unit-tested.
//
// Space: the hero walks along +x on a path at z = 0; the camera lives on the
// +z side looking back toward -z. 1 unit ≈ 1 metre; a kid is ~1.05 tall.
// ---------------------------------------------------------------------------

import type { Aspect, Beat3D, BeatRole, Expression, Film3D, Move, Prop, Shot, TimeOfDay, World } from "./plan";

export type Vec3 = [number, number, number];

export type PropMode = "with" | "leaving" | "ahead" | "almost" | "caught" | "none";

export interface FrameState {
  t: number;
  beatIndex: number;
  /** 0..1 through the current beat. */
  u: number;
  role: BeatRole;
  world: World;
  time: TimeOfDay;
  /** A cut happened on this beat (for scene caching). */
  sceneKey: string;
  hero: {
    pos: Vec3;
    facing: number;
    move: Move;
    /** Seconds into the move's cycle — slowed to a crawl in the silence. */
    phase: number;
    expression: Expression;
    blink: number;
    talk: number;
    lookYaw: number;
  };
  prop: { kind: Prop; mode: PropMode; pos: Vec3; spin: number };
  camera: { pos: Vec3; target: Vec3; fov: number; roll: number };
  caption: { text: string; alpha: number };
  title: { text: string; alpha: number };
  /** 0 = clear; >0 fades to black (open/close) — `flash` fades to white. */
  fade: number;
  flash: number;
  /** Music: how full the score is here, 0 (silent) to 1 (everything). */
  energy: number;
}

/** Deterministic noise from a seed: a small hash, 0..1. */
export function rand(seed: number, n: number): number {
  let x = (seed ^ Math.imul(n + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export function clamp(v: number, lo = 0, hi = 1): number {
  return Math.min(hi, Math.max(lo, v));
}

export function smooth(u: number): number {
  const x = clamp(u);
  return x * x * (3 - 2 * x);
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

/** Height of the hero for framing, by build. */
export function heroHeight(build: "kid" | "teen" | "adult"): number {
  return build === "adult" ? 1.75 : build === "teen" ? 1.45 : 1.05;
}

/** Travel speed of a move, m/s. */
export function speedOf(move: Move): number {
  return move === "run" ? 2.6 : move === "walk" ? 1.1 : move === "tumble" ? 0.4 : 0;
}

export function beatAt(film: Film3D, t: number): { beat: Beat3D; index: number } {
  const beats = film.beats;
  let index = 0;
  for (let i = 0; i < beats.length; i++) if (t >= beats[i].start - 1e-6) index = i;
  return { beat: beats[index], index };
}

export function durationOf(film: Film3D): number {
  return film.beats.length ? film.beats[film.beats.length - 1].end : 0;
}

/** The rush is four quick cuts inside one beat — its own little montage. */
const RUSH: { move: Move; shot: Shot }[] = [
  { move: "run", shot: "low" },
  { move: "jump", shot: "follow" },
  { move: "run", shot: "close" },
  { move: "jump", shot: "wide" },
];

function propMode(role: BeatRole, prop: Prop): PropMode {
  if (prop === "none") return "none";
  switch (role) {
    case "hook":
    case "return":
      return "with";
    case "problem":
      return "leaving";
    case "journey":
    case "rush":
      return "ahead";
    case "silence":
      return "almost";
    case "payoff":
      return "caught";
  }
}

/** How full the score is at each role — the shape the music is built on. */
export const ENERGY: Record<BeatRole, number> = {
  hook: 0.35,
  problem: 0.5,
  journey: 0.7,
  rush: 1,
  silence: 0,
  payoff: 0.9,
  return: 0.3,
};

/** Wider lens for a tall frame, so a wide still reads as wide. */
function fovFor(aspect: Aspect, base: number): number {
  return aspect === "9:16" ? base * 1.45 : aspect === "1:1" ? base * 1.15 : base;
}

/** Camera distance multiplier: a tall frame needs to stand further back to fit the world. */
function backFor(aspect: Aspect): number {
  return aspect === "9:16" ? 1.15 : 1;
}

export function frameAt(film: Film3D, tIn: number): FrameState {
  const total = durationOf(film);
  const t = clamp(tIn, 0, Math.max(0, total - 1e-4));
  const { beat, index } = beatAt(film, t);
  const len = Math.max(0.01, beat.end - beat.start);
  const local = t - beat.start;
  const u = clamp(local / len);
  const seed = film.seed;
  let H = heroHeight(film.hero.build);

  // --- what he does ---------------------------------------------------------
  let move = beat.move;
  let shot = beat.shot;
  let subU = u;
  let subLocal = local;
  let cut = 0;
  if (beat.role === "rush") {
    cut = Math.min(3, Math.floor(u * 4));
    move = RUSH[cut].move;
    shot = RUSH[cut].shot;
    subU = u * 4 - cut;
    subLocal = subU * (len / 4);
  }
  const slow = beat.role === "silence" ? 0.12 : 1;
  const phase = subLocal * slow + (beat.role === "silence" ? 0.42 : 0);

  // Travel: centred on the beat so the camera's mid-beat framing is on the path.
  const speed = speedOf(move);
  const travel = speed * (beat.role === "rush" ? len / 4 : len);
  const x = speed > 0 ? -travel / 2 + speed * (beat.role === "rush" ? subLocal : local) : 0;
  const pos: Vec3 = [x, 0, 0];
  // Facing: travelling → toward +x; standing → three-quarters to camera.
  const facing = speed > 0 ? Math.PI / 2 : move === "look" || move === "point" ? 0.9 : 0.35;

  // Blinks: every 2–4 s on a seeded schedule, ~0.12 s each.
  let blink = 0;
  {
    let at = rand(seed, 7) * 2;
    let k = 0;
    while (at < t + 0.2 && k < 400) {
      const d = t - at;
      if (d >= 0 && d < 0.13) blink = Math.sin((d / 0.13) * Math.PI);
      at += 2 + rand(seed, 100 + k) * 2;
      k++;
    }
  }
  const expression: Expression = beat.role === "silence" ? "focus" : beat.expression;
  if (expression === "sleepy" || move === "sleep") blink = 1;
  // Talk while a caption shows on a talking/waving beat — a mouth flap on 2s.
  const talking = move === "talk" || (beat.caption.trim() && (move === "wave" || move === "idle" || move === "cheer") && u > 0.15 && u < 0.7);
  const talk = talking ? clamp(0.5 + 0.5 * Math.sin(t * 15.7) * Math.sin(t * 4.3 + 1)) : 0;
  const lookYaw = move === "look" ? Math.sin(local * 1.2) * 0.6 : 0;

  // --- the thing he wants ---------------------------------------------------
  const mode = propMode(beat.role, beat.prop);
  const handY = H * 0.95;
  let propPos: Vec3 = [x, handY, 0];
  switch (mode) {
    case "with":
      propPos = beat.prop === "kite" || beat.prop === "balloon" || beat.prop === "star" || beat.prop === "rocket"
        ? [x + 1.2 + Math.sin(t * 0.9) * 0.3, H * 2.4 + Math.sin(t * 1.3) * 0.2, -0.6]
        : beat.prop === "puppy" || beat.prop === "ball" || beat.prop === "robot"
          ? [x + 0.75, 0, 0.35]
          : [x + 0.28, H * 0.55, 0.2];
      break;
    case "leaving": {
      const e = smooth(u);
      propPos = beat.prop === "puppy" || beat.prop === "ball" || beat.prop === "robot"
        ? [x + lerp(0.8, 7, e), 0, lerp(0.3, -0.5, e)]
        : [x + lerp(0.6, 3.6, e), lerp(H * 1.4, H * 3.0, e), lerp(0, -1.4, e)];
      break;
    }
    case "ahead":
      propPos = beat.prop === "puppy" || beat.prop === "ball" || beat.prop === "robot"
        ? [x + 3.2, 0, 0]
        : [x + 4.2, H * 2.6 + Math.sin(t * 1.1) * 0.25, -1.2];
      break;
    case "almost":
      propPos = [x + 0.35, H * 1.75 + 0.04 * Math.sin(t * 2), 0];
      break;
    case "caught":
      propPos = beat.prop === "kite" || beat.prop === "balloon"
        ? [x + 0.4, H * 1.9, -0.2]
        : beat.prop === "puppy" || beat.prop === "robot"
          ? [x + 0.55, 0, 0.3]
          : [x + 0.22, H * 1.2, 0.18];
      break;
    case "none":
      break;
  }

  // --- the camera ----------------------------------------------------------
  const back = backFor(film.aspect);
  const sway = (n: number, amp: number) => (rand(seed, index * 13 + n) - 0.5) * amp;
  const hx = x;
  // Sitting, sleeping or on his back he is shorter: frame the body he has now.
  const posture = move === "sit" || move === "sleep" ? 0.62 : move === "tumble" ? 0.35 : 1;
  H = H * posture;
  const chest = H * 0.6;
  let cam: Vec3 = [hx, H * 0.9, 4 * back];
  let target: Vec3 = [hx, chest, 0];
  let fov = 38;
  // Front three-quarter: in front of where he faces, toward the camera side.
  // Standing he half-faces us; running he faces +x, so the camera leads him.
  const fx = Math.sin(facing);
  const fz = Math.cos(facing);
  const fl = Math.hypot(fx * 0.6, fz * 0.6 + 0.8);
  const ox = (fx * 0.6) / fl;
  const oz = (fz * 0.6 + 0.8) / fl;
  const front = (dist: number, y: number): Vec3 => [hx + ox * dist * back, y, oz * dist * back];
  switch (shot) {
    case "wide":
      cam = speed > 0 ? [hx + sway(1, 2), H * 1.6, 7.5 * back] : [hx + 0.8 + sway(1, 1.2), H * 1.35, 5.6 * back];
      target = speed > 0 ? [hx + 0.3, H * 0.7, -1] : [hx + 0.2, H * 0.85, -0.5];
      fov = 40;
      break;
    case "medium":
      cam = front(3.2, H * 1.0);
      cam[0] += sway(2, 0.6);
      target = [hx, H * 0.62, 0];
      fov = 34;
      break;
    case "close":
      cam = front(1.55, H * 0.92);
      target = [hx, H * 0.82, 0];
      fov = 30;
      break;
    case "low":
      cam = front(2.5, 0.22);
      target = [hx, H * 0.95, 0];
      fov = 44;
      break;
    case "high":
      cam = [hx - 0.8, H * 4.2, 4.2 * back];
      target = [hx, 0.2, 0];
      fov = 40;
      break;
    case "follow":
      cam = [hx - 2.6, H * 1.25, 2.8 * back];
      target = [hx + 1.4, H * 0.75, 0];
      fov = 42;
      break;
    case "orbit": {
      const a = lerp(-0.55, 0.55, smooth(subU)) + Math.atan2(ox, oz);
      const r = 3.6 * back;
      cam = [hx + Math.sin(a) * r, H * 1.1, Math.cos(a) * r];
      target = [hx, H * 0.6, 0];
      fov = 36;
      break;
    }
    case "push": {
      const r = lerp(5.5, 2.1, smooth(subU));
      cam = front(r, lerp(H * 1.1, H * 1.0, subU));
      target = [hx, lerp(H * 0.65, H * 1.05, subU), 0];
      fov = lerp(38, 32, subU);
      break;
    }
    case "overhead":
      cam = [hx + 0.01, H * 6.5, 1.2];
      target = [hx, 0, 0];
      fov = 42;
      break;
  }
  // When the thing he wants is getting away (or up ahead in the sky), lean the
  // frame toward it so both are in the shot.
  if ((mode === "leaving" || mode === "almost") && shot !== "close" && shot !== "overhead") {
    const k = mode === "leaving" ? 0.4 : 0.25;
    target = [lerp(target[0], propPos[0], k), lerp(target[1], propPos[1], k), lerp(target[2], propPos[2], k * 0.5)];
    fov *= mode === "leaving" ? 1.15 : 1;
  }
  // A slow drift on every shot, so no frame is dead still (a held silence stays held).
  const drift = beat.role === "silence" ? 0 : 1;
  cam = [cam[0] + Math.sin(t * 0.37 + index) * 0.08 * drift, cam[1] + Math.sin(t * 0.53 + index * 2) * 0.04 * drift, cam[2]];
  // The payoff lands with a short shake.
  let roll = 0;
  if (beat.role === "payoff" && local < 0.45) {
    const k = (1 - local / 0.45) * 0.05;
    cam = [cam[0] + Math.sin(t * 61) * k, cam[1] + Math.sin(t * 47) * k, cam[2]];
    roll = Math.sin(t * 39) * k * 0.4;
  }
  // When he travels, the camera travels with him (already in hx); for the
  // wide shot, the camera lags so he crosses the frame.
  if (shot === "wide" && speed > 0) {
    const cx = lerp(-travel * 0.3, travel * 0.3, beat.role === "rush" ? subU : u);
    cam = [cx, cam[1], cam[2]];
    target = [cx + 0.3, target[1], target[2]];
  }

  // --- words and fades ------------------------------------------------------
  const cap = film.captions ? beat.caption.trim() : "";
  const capIn = clamp((local - 0.25) / 0.3);
  const capOut = clamp((beat.end - t - 0.15) / 0.3);
  const caption = { text: cap, alpha: cap ? Math.min(capIn, capOut) : 0 };
  const titleAlpha = Math.min(clamp((t - 0.4) / 0.5), clamp((2.8 - t) / 0.5));
  const title = { text: film.title, alpha: index === 0 ? titleAlpha : 0 };
  const fade = Math.max(clamp(1 - t / 0.5), clamp(1 - (total - t) / 0.8));
  const flash = beat.role === "payoff" ? clamp(1 - local / 0.22) * 0.85 : 0;

  return {
    t,
    beatIndex: index,
    u,
    role: beat.role,
    world: beat.world,
    time: beat.time,
    sceneKey: `${beat.world}:${beat.time}`,
    hero: { pos, facing, move, phase, expression, blink, talk, lookYaw },
    prop: { kind: beat.prop, mode, pos: propPos, spin: t },
    camera: { pos: cam, target, fov: fovFor(film.aspect, fov), roll },
    caption,
    title: film.bare ? { ...title, alpha: 0 } : title,
    fade: film.bare ? 0 : fade,
    flash: film.bare ? 0 : flash,
    energy: ENERGY[beat.role],
  };
}

/** Output size for an aspect at a given short edge (720 → 1280×720). */
export function sizeFor(aspect: Aspect, short: number): { width: number; height: number } {
  const even = (n: number) => Math.round(n / 2) * 2;
  if (aspect === "9:16") return { width: short, height: even((short * 16) / 9) };
  if (aspect === "1:1") return { width: short, height: short };
  return { width: even((short * 16) / 9), height: short };
}

/** The moments worth looking at in a contact sheet: the middle of every beat (each rush cut too). */
export function keyMoments(film: Film3D): number[] {
  const out: number[] = [];
  for (const b of film.beats) {
    if (b.role === "rush") for (let k = 0; k < 4; k++) out.push(b.start + ((k + 0.5) / 4) * (b.end - b.start));
    else out.push((b.start + b.end) / 2);
  }
  return out;
}
