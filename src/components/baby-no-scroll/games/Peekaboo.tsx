"use client";

// ---------------------------------------------------------------------------
// Peekaboo — the oldest game there is, played with a meadow.
//
// Peekaboo is how babies learn that things still exist when they can't see
// them, and the joy of it is the surprise landing on a beat: hide, wait,
// "boo!". So every hiding spot here is huge (a palm, not a fingertip), the
// animal pops out with a big overshoot and a wobble the moment it is touched,
// it says something in its own silly voice, waves, and then ducks back down —
// and the animal behind each bush is reshuffled every time, so the same bush
// is never quite the same surprise twice.
//
// Nothing is ever wrong. A tap on bare grass grows a flower with a chime; a
// tap on the sky throws stars; a drag sprinkles sparkles and pops every spot
// it passes over. No score, no timer, no end.
//
// Drawing: the meadow is painted once per screen size, and each hiding spot's
// artwork is painted once into its own small offscreen canvas (a "back" and
// a "front"), so a rustling bush is one drawImage with a wobble transform
// rather than forty paths a frame. The animal is drawn live between its
// spot's back and front, clipped at the spot's edge so it rises from behind.
// ---------------------------------------------------------------------------

import { GameCanvas, type CanvasGame, type GameEnv, type GamePointer } from "./GameCanvas";
import { audio, note } from "@/lib/baby-no-scroll/audio";
import { CANDY, Particles, TAU, clamp, easeOutBack, hsl, pick, rand, spring } from "@/lib/baby-no-scroll/fx";

export function Peekaboo() {
  return <GameCanvas create={createPeekaboo} />;
}

/** Each screen corner holds the parent's lock; no hiding spot may reach into one. */
const CORNER = 120;
const MAX_FLOWERS = 30;
/** How long an animal stays out before ducking back, in seconds. */
const STAY = 2.5;

// --- sound -------------------------------------------------------------------

interface Sweep {
  type?: OscillatorType;
  /** [seconds from start, Hz]. The first entry is the starting pitch. */
  pitch: Array<[number, number]>;
  dur: number;
  gain?: number;
  attack?: number;
  delay?: number;
  reverb?: number;
  filter?: { type: BiquadFilterType; freq: number; q?: number };
  vibrato?: { rate: number; depth: number };
}

function sweep(o: Sweep): void {
  const a = audio();
  if (!a) return;
  const { type = "sine", pitch, dur, gain = 0.2, attack = 0.01, delay = 0, reverb = 0.2, filter, vibrato } = o;
  const c = a.ctx;
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(pitch[0][1], t);
  for (let i = 1; i < pitch.length; i++) osc.frequency.exponentialRampToValueAtTime(pitch[i][1], t + pitch[i][0]);
  if (vibrato) {
    const lfo = c.createOscillator();
    lfo.frequency.value = vibrato.rate;
    const depth = c.createGain();
    depth.gain.value = vibrato.depth;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let head: AudioNode = osc;
  if (filter) {
    const f = c.createBiquadFilter();
    f.type = filter.type;
    f.frequency.value = filter.freq;
    f.Q.value = filter.q ?? 1;
    osc.connect(f);
    head = f;
  }
  head.connect(env);
  env.connect(a.out);
  if (reverb > 0) {
    const send = c.createGain();
    send.gain.value = reverb;
    env.connect(send).connect(a.room);
  }
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(c: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(c);
  if (!b) {
    b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(c, b);
  }
  return b;
}

function hiss(o: { dur: number; from: number; to: number; gain?: number; type?: BiquadFilterType; q?: number; delay?: number }): void {
  const a = audio();
  if (!a) return;
  const c = a.ctx;
  const t = c.currentTime + (o.delay ?? 0);
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const f = c.createBiquadFilter();
  f.type = o.type ?? "bandpass";
  f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.from, t);
  f.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(o.gain ?? 0.12, t + o.dur * 0.2);
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f).connect(env).connect(a.out);
  src.start(t, Math.random() * Math.max(0, 1.9 - o.dur));
  src.stop(t + o.dur + 0.05);
}

type Animal = "bunny" | "chick" | "puppy" | "kitten" | "frog" | "duck" | "bear" | "owl";
const ANIMALS: readonly Animal[] = ["bunny", "chick", "puppy", "kitten", "frog", "duck", "bear", "owl"];

/**
 * Each animal's "voice". Not realistic on purpose: these are the sounds a
 * grown-up makes FOR the animal when reading a picture book — a shape of
 * pitch, short and bright, that a baby can learn to tell apart.
 */
function voice(kind: Animal, delay = 0): void {
  switch (kind) {
    case "chick":
      for (let k = 0; k < 3; k++) sweep({ pitch: [[0, 2300], [0.07, 3300]], dur: 0.09, gain: 0.12, delay: delay + k * 0.11 });
      break;
    case "frog":
      // Ribbit: two quick trains of low clicks — "rib" then "bit", a step lower.
      for (let g = 0; g < 2; g++)
        for (let k = 0; k < 6; k++)
          sweep({ type: "square", pitch: [[0, 190 - g * 35]], dur: 0.03, gain: 0.1, delay: delay + g * 0.24 + k * 0.028, filter: { type: "lowpass", freq: 900 }, reverb: 0.1 });
      break;
    case "duck":
      // Quack: a buzzy sawtooth through two narrow formant filters, which is
      // what makes it nasal rather than just a buzz.
      for (const d of [0, 0.24]) {
        sweep({ type: "sawtooth", pitch: [[0, 420], [0.16, 300]], dur: 0.19, gain: 0.13, delay: delay + d, filter: { type: "bandpass", freq: 1000, q: 4 } });
        sweep({ type: "sawtooth", pitch: [[0, 420], [0.16, 300]], dur: 0.19, gain: 0.07, delay: delay + d, filter: { type: "bandpass", freq: 2400, q: 5 } });
      }
      break;
    case "puppy":
      for (const d of [0, 0.22]) {
        sweep({ type: "sawtooth", pitch: [[0, 640], [0.12, 260]], dur: 0.15, gain: 0.12, delay: delay + d, filter: { type: "lowpass", freq: 1700 } });
        hiss({ dur: 0.06, from: 2500, to: 1200, gain: 0.05, delay: delay + d });
      }
      break;
    case "kitten":
      sweep({ type: "triangle", pitch: [[0, 560], [0.18, 920], [0.45, 520]], dur: 0.5, gain: 0.16, attack: 0.04, delay, vibrato: { rate: 7, depth: 16 }, filter: { type: "lowpass", freq: 2600 } });
      break;
    case "owl":
      sweep({ pitch: [[0, 420], [0.25, 360]], dur: 0.32, gain: 0.18, attack: 0.06, delay, reverb: 0.4 });
      sweep({ pitch: [[0, 400], [0.3, 340]], dur: 0.38, gain: 0.18, attack: 0.06, delay: delay + 0.4, reverb: 0.4 });
      break;
    case "bunny":
      for (let k = 0; k < 3; k++) sweep({ pitch: [[0, 1200], [0.06, 1750]], dur: 0.08, gain: 0.1, delay: delay + k * 0.1 });
      break;
    case "bear":
      sweep({ type: "triangle", pitch: [[0, 200], [0.15, 270], [0.38, 210]], dur: 0.42, gain: 0.2, attack: 0.04, delay, vibrato: { rate: 9, depth: 10 }, filter: { type: "lowpass", freq: 900 } });
      break;
  }
}

/** "Peek-a-BOO!" as three notes: two quick, then the high one held. */
function sting(): void {
  const r = Math.floor(rand(0, 3));
  [r + 4, r + 2, r + 7].forEach((n, i) =>
    note(n, { type: "triangle", duration: i === 2 ? 0.7 : 0.25, gain: i === 2 ? 0.14 : 0.1, delay: [0, 0.11, 0.24][i], reverb: 0.4 }),
  );
}

function rustleSound(pond: boolean, soft = 1): void {
  if (pond) {
    hiss({ dur: 0.32, from: 1800, to: 500, gain: 0.12 * soft });
    sweep({ pitch: [[0, 260], [0.1, 760]], dur: 0.14, gain: 0.14 * soft, reverb: 0.35 });
  } else {
    hiss({ dur: 0.22, from: 4200, to: 2400, gain: 0.08 * soft, type: "highpass" });
    hiss({ dur: 0.2, from: 3600, to: 2000, gain: 0.06 * soft, type: "highpass", delay: 0.1 });
  }
}

// --- painting ------------------------------------------------------------------

function paint(w: number, h: number, dpr: number, draw: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  const c = cv.getContext("2d");
  if (c) {
    c.scale(dpr, dpr);
    draw(c);
  }
  return cv;
}

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + k, y);
  c.arcTo(x + w, y, x + w, y + h, k);
  c.arcTo(x + w, y + h, x, y + h, k);
  c.arcTo(x, y + h, x, y, k);
  c.arcTo(x, y, x + w, y, k);
  c.closePath();
}

function ball(c: CanvasRenderingContext2D, x: number, y: number, r: number, h: number, s: number, l: number): void {
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.08, x, y, r * 1.05);
  g.addColorStop(0, hsl(h, s, Math.min(96, l + 16)));
  g.addColorStop(0.6, hsl(h, s, l));
  g.addColorStop(1, hsl(h, s, l - 14));
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
}

function shadow(c: CanvasRenderingContext2D, y: number, rx: number, ry: number): void {
  c.fillStyle = "rgba(30,80,30,0.25)";
  c.beginPath();
  c.ellipse(0, y, rx, ry, 0, 0, TAU);
  c.fill();
}

type SpotKind = "bush" | "tree" | "fence" | "pond" | "pot" | "box" | "log";

/** Per-kind geometry in r units: where the animal sits when out, and how far the art reaches. */
const GEO: Record<SpotKind, { upY: number; bottom: number; hitDy: number }> = {
  bush: { upY: -0.5, bottom: 1.3, hitDy: -0.1 },
  tree: { upY: -0.9, bottom: 2.65, hitDy: -0.3 },
  fence: { upY: -0.4, bottom: 1.15, hitDy: -0.1 },
  pond: { upY: 0.45, bottom: 0.85, hitDy: -0.1 },
  pot: { upY: 0.15, bottom: 1.55, hitDy: -0.05 },
  box: { upY: 0.15, bottom: 1.35, hitDy: -0.05 },
  log: { upY: -0.25, bottom: 0.85, hitDy: -0.1 },
};
/** The line (r units below the spot's y) above which the animal is drawn. */
const CLIP = 0.3;
/** Where the animal waits when hidden: far enough down that even bunny ears are below the clip. */
const DOWN = 2.15;

function leafy(c: CanvasRenderingContext2D, blobs: Array<[number, number, number]>, r: number, hue: number): void {
  for (const [x, y, s] of blobs) ball(c, x * r, y * r, s * r, hue, 55, 40);
  c.fillStyle = hsl(hue - 10, 70, 70, 0.6);
  for (const [x, y, s] of blobs) {
    c.beginPath();
    c.ellipse((x - s * 0.3) * r, (y - s * 0.45) * r, s * r * 0.28, s * r * 0.12, -0.5, 0, TAU);
    c.fill();
  }
}

function paintSpot(c: CanvasRenderingContext2D, kind: SpotKind, part: "back" | "front", r: number): void {
  const ext = GEO[kind].bottom;
  if (part === "back") shadow(c, ext * r - r * 0.05, r * 1.4, r * 0.18);
  switch (kind) {
    case "bush":
    case "tree": {
      if (part === "back") return;
      if (kind === "tree") {
        const tg = c.createLinearGradient(-r * 0.3, 0, r * 0.3, 0);
        tg.addColorStop(0, "#7a4a2c");
        tg.addColorStop(0.5, "#a8693f");
        tg.addColorStop(1, "#6e4127");
        c.fillStyle = tg;
        c.beginPath();
        c.moveTo(-r * 0.22, r * 0.4);
        c.lineTo(-r * 0.26, r * 2.3);
        c.quadraticCurveTo(-r * 0.32, r * 2.6, -r * 0.55, r * 2.65);
        c.lineTo(r * 0.55, r * 2.65);
        c.quadraticCurveTo(r * 0.32, r * 2.6, r * 0.26, r * 2.3);
        c.lineTo(r * 0.22, r * 0.4);
        c.closePath();
        c.fill();
        c.fillStyle = "#4a2a18";
        c.beginPath();
        c.ellipse(r * 0.02, r * 1.55, r * 0.1, r * 0.15, 0, 0, TAU);
        c.fill();
        leafy(c, [[-0.85, 0.2, 0.62], [0.85, 0.2, 0.62], [-0.45, -0.35, 0.68], [0.45, -0.35, 0.68], [0, 0.35, 0.8], [0, -0.6, 0.6]], r, 118);
        c.fillStyle = "#ff4d5e";
        for (const [x, y] of [[-0.7, 0.1], [0.55, -0.4], [0.2, 0.55], [-0.3, -0.6], [0.85, 0.45]]) {
          c.beginPath();
          c.arc(x * r, y * r, r * 0.09, 0, TAU);
          c.fill();
          c.fillStyle = "rgba(255,255,255,0.7)";
          c.beginPath();
          c.arc(x * r - r * 0.03, y * r - r * 0.03, r * 0.025, 0, TAU);
          c.fill();
          c.fillStyle = "#ff4d5e";
        }
      } else {
        leafy(c, [[-0.8, 0.5, 0.6], [0.8, 0.5, 0.6], [-0.38, 0.05, 0.62], [0.38, 0.0, 0.66], [0, 0.6, 0.72], [-0.05, -0.2, 0.52]], r, 128);
        for (const [x, y, hue] of [[-0.6, 0.1, 330], [0.3, -0.35, 52], [0.7, 0.4, 300], [-0.2, 0.6, 52], [0.05, 0.15, 330]]) {
          c.fillStyle = hsl(hue, 95, 78);
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * TAU;
            c.beginPath();
            c.arc(x * r + Math.cos(a) * r * 0.06, y * r + Math.sin(a) * r * 0.06, r * 0.05, 0, TAU);
            c.fill();
          }
          c.fillStyle = "#ffd23e";
          c.beginPath();
          c.arc(x * r, y * r, r * 0.04, 0, TAU);
          c.fill();
        }
      }
      return;
    }
    case "fence": {
      if (part === "back") {
        // A tuft of long grass behind the fence, so the gaps show green, not sky.
        c.fillStyle = "#58b847";
        c.beginPath();
        c.ellipse(0, r * 0.7, r * 1.4, r * 0.55, 0, 0, TAU);
        c.fill();
        return;
      }
      const n = 5;
      for (let i = 0; i < n; i++) {
        const x = -1.2 * r + (i * 2.4 * r) / (n - 1);
        const g = c.createLinearGradient(x - r * 0.18, 0, x + r * 0.18, 0);
        g.addColorStop(0, "#fffaf0");
        g.addColorStop(1, "#e6d8c2");
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(x - r * 0.18, r * 1.15);
        c.lineTo(x - r * 0.18, -r * 0.3);
        c.lineTo(x, -r * 0.52);
        c.lineTo(x + r * 0.18, -r * 0.3);
        c.lineTo(x + r * 0.18, r * 1.15);
        c.closePath();
        c.fill();
      }
      c.fillStyle = "#e9dcc6";
      rr(c, -r * 1.4, r * 0.0, r * 2.8, r * 0.2, r * 0.06);
      c.fill();
      rr(c, -r * 1.4, r * 0.7, r * 2.8, r * 0.2, r * 0.06);
      c.fill();
      // A climbing flower on the fence.
      c.fillStyle = "#ff8fb1";
      for (const [x, y] of [[-0.8, 0.45], [0.95, 0.3]]) {
        c.beginPath();
        c.arc(x * r, y * r, r * 0.1, 0, TAU);
        c.fill();
      }
      return;
    }
    case "pond": {
      if (part === "back") {
        c.fillStyle = "#8a7a5a";
        c.beginPath();
        c.ellipse(0, r * 0.38, r * 1.45, r * 0.5, 0, 0, TAU);
        c.fill();
        const g = c.createLinearGradient(0, -r * 0.1, 0, r * 0.8);
        g.addColorStop(0, "#9ee8ff");
        g.addColorStop(1, "#3aa6e0");
        c.fillStyle = g;
        c.beginPath();
        c.ellipse(0, r * 0.35, r * 1.35, r * 0.42, 0, 0, TAU);
        c.fill();
        c.strokeStyle = "rgba(255,255,255,0.6)";
        c.lineWidth = Math.max(2, r * 0.03);
        c.beginPath();
        c.ellipse(-r * 0.5, r * 0.25, r * 0.35, r * 0.08, 0, 0, TAU);
        c.stroke();
        return;
      }
      // Lily pad and reeds frame the water without hiding it.
      c.fillStyle = "#3fae4a";
      c.beginPath();
      c.moveTo(r * 0.75, r * 0.55);
      c.arc(r * 0.75, r * 0.55, r * 0.26, 0.3, TAU - 0.3);
      c.closePath();
      c.fill();
      c.fillStyle = "#ff9ec4";
      c.beginPath();
      c.arc(r * 0.68, r * 0.45, r * 0.09, 0, TAU);
      c.fill();
      c.strokeStyle = "#4a9a3a";
      c.lineWidth = Math.max(2, r * 0.06);
      c.lineCap = "round";
      for (const [x, hgt] of [[-1.3, 1.0], [-1.18, 0.75], [-1.05, 0.9]]) {
        c.beginPath();
        c.moveTo(x * r, r * 0.6);
        c.quadraticCurveTo(x * r - r * 0.1, r * (0.6 - hgt / 2), x * r + r * 0.05, r * (0.6 - hgt));
        c.stroke();
      }
      c.fillStyle = "#8a5a3c";
      for (const [x, hgt] of [[-1.3, 1.0], [-1.05, 0.9]]) {
        c.beginPath();
        c.ellipse(x * r + r * 0.03, r * (0.6 - hgt) + r * 0.12, r * 0.06, r * 0.14, 0, 0, TAU);
        c.fill();
      }
      c.fillStyle = "#b9b2a6";
      for (const [x, y, s] of [[-0.6, 0.78, 0.14], [0.1, 0.82, 0.12], [0.9, 0.74, 0.12], [-1.05, 0.62, 0.1]]) {
        c.beginPath();
        c.ellipse(x * r, y * r, s * r * 1.3, s * r * 0.8, 0, 0, TAU);
        c.fill();
      }
      return;
    }
    case "pot": {
      if (part === "back") {
        c.fillStyle = "#4d8f3a";
        for (const a of [-0.5, 0.5]) {
          c.save();
          c.rotate(a);
          c.beginPath();
          c.ellipse(0, -r * 0.6, r * 0.18, r * 0.5, 0, 0, TAU);
          c.fill();
          c.restore();
        }
        c.fillStyle = "#5a3a22";
        c.beginPath();
        c.ellipse(0, r * 0.02, r * 0.95, r * 0.2, 0, 0, TAU);
        c.fill();
        return;
      }
      const g = c.createLinearGradient(-r, 0, r, 0);
      g.addColorStop(0, "#c8643a");
      g.addColorStop(0.4, "#ec8a57");
      g.addColorStop(1, "#b5552e");
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(-r * 1.0, r * 0.22);
      c.lineTo(-r * 0.72, r * 1.55);
      c.lineTo(r * 0.72, r * 1.55);
      c.lineTo(r * 1.0, r * 0.22);
      c.closePath();
      c.fill();
      c.fillStyle = "rgba(255,255,255,0.75)";
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        c.arc(-r * 0.56 + i * r * 0.28, r * 0.8, r * 0.06, 0, TAU);
        c.fill();
      }
      c.fillStyle = g;
      rr(c, -r * 1.1, -r * 0.1, r * 2.2, r * 0.34, r * 0.1);
      c.fill();
      c.fillStyle = "rgba(255,255,255,0.3)";
      rr(c, -r * 0.95, -r * 0.06, r * 1.4, r * 0.07, r * 0.035);
      c.fill();
      return;
    }
    case "box": {
      if (part === "back") {
        c.fillStyle = "#c8995c";
        for (const side of [-1, 1]) {
          c.beginPath();
          c.moveTo(side * r * 1.05, -r * 0.05);
          c.lineTo(side * r * 1.45, -r * 0.6);
          c.lineTo(side * r * 0.45, -r * 0.5);
          c.lineTo(side * r * 0.05, -r * 0.05);
          c.closePath();
          c.fill();
        }
        c.fillStyle = "#6b4a28";
        c.fillRect(-r * 1.0, -r * 0.1, r * 2.0, r * 0.3);
        return;
      }
      const g = c.createLinearGradient(0, -r * 0.05, 0, r * 1.35);
      g.addColorStop(0, "#f2c27f");
      g.addColorStop(1, "#d49a55");
      c.fillStyle = g;
      rr(c, -r * 1.05, -r * 0.05, r * 2.1, r * 1.4, r * 0.08);
      c.fill();
      c.fillStyle = "rgba(255,255,255,0.35)";
      c.fillRect(-r * 0.15, -r * 0.05, r * 0.3, r * 1.4);
      // A big friendly star sticker.
      c.fillStyle = "#ff6b8b";
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 ? r * 0.13 : r * 0.3;
        const a = (i / 10) * TAU - Math.PI / 2;
        const x = r * 0.55 + Math.cos(a) * rad;
        const y = r * 0.65 + Math.sin(a) * rad;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.closePath();
      c.fill();
      c.fillStyle = "#6cc3ff";
      c.beginPath();
      c.arc(-r * 0.55, r * 0.7, r * 0.22, 0, TAU);
      c.fill();
      return;
    }
    case "log": {
      if (part === "back") return;
      const g = c.createLinearGradient(0, -r * 0.25, 0, r * 0.85);
      g.addColorStop(0, "#a9744a");
      g.addColorStop(1, "#6e4428");
      c.fillStyle = g;
      rr(c, -r * 1.4, -r * 0.25, r * 2.6, r * 1.08, r * 0.5);
      c.fill();
      c.strokeStyle = "rgba(60,30,15,0.35)";
      c.lineWidth = Math.max(2, r * 0.04);
      for (const y of [0.05, 0.35, 0.6]) {
        c.beginPath();
        c.moveTo(-r * 1.1, y * r);
        c.lineTo(r * 0.7, y * r + r * 0.03);
        c.stroke();
      }
      c.fillStyle = "#e8c38f";
      c.beginPath();
      c.ellipse(r * 1.18, r * 0.29, r * 0.3, r * 0.54, 0, 0, TAU);
      c.fill();
      c.strokeStyle = "#b8895a";
      c.lineWidth = Math.max(1.5, r * 0.03);
      for (const k of [0.65, 0.35]) {
        c.beginPath();
        c.ellipse(r * 1.18, r * 0.29, r * 0.3 * k, r * 0.54 * k, 0, 0, TAU);
        c.stroke();
      }
      c.fillStyle = "#79c25a";
      c.beginPath();
      c.ellipse(-r * 0.6, -r * 0.2, r * 0.5, r * 0.12, 0, Math.PI, TAU);
      c.fill();
      // A spotted mushroom on top.
      c.fillStyle = "#fff4e0";
      c.fillRect(-r * 0.95, -r * 0.48, r * 0.12, r * 0.26);
      c.fillStyle = "#ff4d5e";
      c.beginPath();
      c.ellipse(-r * 0.89, -r * 0.48, r * 0.22, r * 0.16, 0, Math.PI, TAU);
      c.fill();
      c.fillStyle = "#fff";
      for (const [x, y] of [[-0.98, -0.55], [-0.82, -0.58], [-0.9, -0.5]]) {
        c.beginPath();
        c.arc(x * r, y * r, r * 0.03, 0, TAU);
        c.fill();
      }
      return;
    }
  }
}

function paintMeadow(c: CanvasRenderingContext2D, w: number, h: number, horizon: number): void {
  const sky = c.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#7fd2ff");
  sky.addColorStop(0.7, "#cdf1ff");
  sky.addColorStop(1, "#fff4dc");
  c.fillStyle = sky;
  c.fillRect(0, 0, w, horizon + 4);
  // A faint rainbow behind the hills.
  const rc = w * 0.5;
  const rr0 = Math.max(w, horizon * 2) * 0.42;
  c.lineWidth = Math.max(6, rr0 * 0.045);
  [0, 28, 52, 135, 200, 270].forEach((hue, i) => {
    c.strokeStyle = hsl(hue, 90, 70, 0.32);
    c.beginPath();
    c.arc(rc, horizon + rr0 * 0.15, rr0 - i * c.lineWidth, Math.PI, TAU);
    c.stroke();
  });
  const hills = (base: number, amp: number, a: number, color: string) => {
    c.beginPath();
    c.moveTo(0, h);
    for (let x = 0; x <= w + 16; x += 16) c.lineTo(x, base - Math.abs(Math.sin(x * a + 0.5)) * amp);
    c.lineTo(w, h);
    c.closePath();
    c.fillStyle = color;
    c.fill();
  };
  hills(horizon + 6, h * 0.06, 0.004, "#bfeaa4");
  hills(horizon + h * 0.04, h * 0.05, 0.006, "#98dc7c");
  const g = c.createLinearGradient(0, horizon + h * 0.04, 0, h);
  g.addColorStop(0, "#86d76a");
  g.addColorStop(1, "#5cbf4a");
  c.fillStyle = g;
  c.fillRect(0, horizon + h * 0.05, w, h);
  // Grass blades and tiny daisies: texture, so the meadow reads as a meadow.
  c.strokeStyle = "rgba(50,140,45,0.55)";
  c.lineWidth = 2;
  c.lineCap = "round";
  for (let i = 0; i < (w * h) / 2600; i++) {
    const x = Math.random() * w;
    const y = horizon + h * 0.06 + Math.random() * (h - horizon);
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + rand(-3, 3), y - rand(5, 10));
    c.stroke();
  }
  for (let i = 0; i < w / 14; i++) {
    const x = Math.random() * w;
    const y = horizon + h * 0.07 + Math.random() * (h - horizon);
    c.fillStyle = "rgba(255,255,255,0.9)";
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU;
      c.beginPath();
      c.arc(x + Math.cos(a) * 2.5, y + Math.sin(a) * 2.5, 1.8, 0, TAU);
      c.fill();
    }
    c.fillStyle = "#ffd23e";
    c.beginPath();
    c.arc(x, y, 1.5, 0, TAU);
    c.fill();
  }
}

function makeCloud(): HTMLCanvasElement {
  return paint(220, 110, 1, (c) => {
    const puffs: Array<[number, number, number]> = [[55, 70, 30], [92, 52, 40], [138, 56, 36], [170, 74, 27], [110, 80, 32]];
    c.fillStyle = "rgba(190,225,245,0.9)";
    for (const [x, y, r] of puffs) {
      c.beginPath();
      c.arc(x + 3, y + 5, r, 0, TAU);
      c.fill();
    }
    c.fillStyle = "#fff";
    for (const [x, y, r] of puffs) {
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
    }
  });
}

// --- animals ---------------------------------------------------------------------

interface Anim {
  t: number;
  blink: boolean;
  happy: boolean;
  /** Raised-paw wave angle; 0 = paws down. */
  wave: number;
  /** 0..1 how open the mouth is. */
  mouth: number;
  /** -1..1 where the pupils look. */
  look: number;
}

function eyes(c: CanvasRenderingContext2D, gap: number, y: number, r: number, a: Anim): void {
  for (const ex of [-gap, gap]) {
    if (a.happy || a.blink) {
      c.strokeStyle = "#2a1838";
      c.lineWidth = r * 0.38;
      c.lineCap = "round";
      c.beginPath();
      if (a.happy) c.arc(ex, y + r * 0.25, r * 0.65, Math.PI * 1.15, Math.PI * 1.85);
      else {
        c.moveTo(ex - r * 0.6, y);
        c.quadraticCurveTo(ex, y + r * 0.35, ex + r * 0.6, y);
      }
      c.stroke();
      continue;
    }
    c.fillStyle = "#241634";
    c.beginPath();
    c.ellipse(ex + a.look * r * 0.15, y, r * 0.85, r, 0, 0, TAU);
    c.fill();
    // Two highlights: the trick that makes a dot of ink look wet and alive.
    c.fillStyle = "#fff";
    c.beginPath();
    c.arc(ex + a.look * r * 0.15 - r * 0.25, y - r * 0.35, r * 0.32, 0, TAU);
    c.fill();
    c.beginPath();
    c.arc(ex + a.look * r * 0.15 + r * 0.3, y + r * 0.35, r * 0.14, 0, TAU);
    c.fill();
  }
}

function cheeks(c: CanvasRenderingContext2D, gap: number, y: number, r: number): void {
  c.fillStyle = "rgba(255,110,140,0.5)";
  c.beginPath();
  c.ellipse(-gap, y, r, r * 0.6, 0, 0, TAU);
  c.ellipse(gap, y, r, r * 0.6, 0, 0, TAU);
  c.fill();
}

function mouth(c: CanvasRenderingContext2D, y: number, w: number, open: number): void {
  if (open > 0.05) {
    c.fillStyle = "#6a2040";
    c.beginPath();
    c.ellipse(0, y + w * 0.2 * open, w * 0.55, w * 0.65 * open, 0, 0, TAU);
    c.fill();
    c.fillStyle = "#ff8fa8";
    c.beginPath();
    c.ellipse(0, y + w * 0.45 * open, w * 0.35, w * 0.25 * open, 0, 0, TAU);
    c.fill();
    return;
  }
  c.strokeStyle = "#5a1d3a";
  c.lineWidth = Math.max(1.5, w * 0.22);
  c.lineCap = "round";
  c.beginPath();
  c.arc(-w * 0.45, y - w * 0.05, w * 0.45, 0.2, Math.PI - 0.4);
  c.moveTo(w * 0.9, y);
  c.arc(w * 0.45, y - w * 0.05, w * 0.45, 0.4, Math.PI - 0.2);
  c.stroke();
}

function body(c: CanvasRenderingContext2D, s: number, h: number, sat: number, l: number, belly: string): void {
  const g = c.createRadialGradient(-s * 0.3, -s * 0.7, s * 0.1, 0, -s * 0.45, s);
  g.addColorStop(0, hsl(h, sat, Math.min(96, l + 12)));
  g.addColorStop(1, hsl(h, sat, l - 10));
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(0, -s * 0.45, s * 0.85, s * 0.58, 0, 0, TAU);
  c.fill();
  c.fillStyle = belly;
  c.beginPath();
  c.ellipse(0, -s * 0.35, s * 0.5, s * 0.38, 0, 0, TAU);
  c.fill();
}

function paws(c: CanvasRenderingContext2D, s: number, color: string, a: Anim): void {
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(-s * 0.55, -s * 0.18, s * 0.26, s * 0.2, 0, 0, TAU);
  c.fill();
  if (a.wave) {
    c.save();
    c.translate(s * 0.62, -s * 0.55);
    c.rotate(-1.1 + a.wave);
    c.beginPath();
    c.ellipse(0, -s * 0.38, s * 0.19, s * 0.36, 0, 0, TAU);
    c.fill();
    c.fillStyle = "rgba(255,150,170,0.7)";
    c.beginPath();
    c.arc(0, -s * 0.6, s * 0.08, 0, TAU);
    c.fill();
    c.restore();
  } else {
    c.beginPath();
    c.ellipse(s * 0.55, -s * 0.18, s * 0.26, s * 0.2, 0, 0, TAU);
    c.fill();
  }
}

function drawAnimal(c: CanvasRenderingContext2D, kind: Animal, s: number, a: Anim): void {
  const hy = -s * 1.35;
  switch (kind) {
    case "bunny": {
      const fur = "hsl(30 35% 95%)";
      body(c, s, 30, 35, 92, "#fff");
      // Ears flop a little on their own rhythm, faster when excited.
      const ear = Math.sin(a.t * (a.happy ? 14 : 3)) * (a.happy ? 0.18 : 0.06);
      for (const side of [-1, 1]) {
        c.save();
        c.translate(side * s * 0.36, hy - s * 0.75);
        c.rotate(side * (0.18 + ear));
        c.fillStyle = fur;
        c.beginPath();
        c.ellipse(0, -s * 0.55, s * 0.24, s * 0.72, 0, 0, TAU);
        c.fill();
        c.fillStyle = "#ffb3c8";
        c.beginPath();
        c.ellipse(0, -s * 0.5, s * 0.12, s * 0.55, 0, 0, TAU);
        c.fill();
        c.restore();
      }
      ball(c, 0, hy, s, 30, 35, 93);
      eyes(c, s * 0.38, hy - s * 0.05, s * 0.2, a);
      cheeks(c, s * 0.6, hy + s * 0.3, s * 0.16);
      c.fillStyle = "#ff8fb1";
      c.beginPath();
      c.ellipse(0, hy + s * 0.2, s * 0.1, s * 0.07, 0, 0, TAU);
      c.fill();
      mouth(c, hy + s * 0.38, s * 0.16, a.mouth);
      if (a.mouth < 0.05) {
        c.fillStyle = "#fff";
        c.fillRect(-s * 0.06, hy + s * 0.38, s * 0.12, s * 0.1);
      }
      paws(c, s, fur, a);
      return;
    }
    case "chick": {
      const wingFlap = a.happy || a.wave ? Math.sin(a.t * 22) * 0.5 : 0.1;
      for (const side of [-1, 1]) {
        c.save();
        c.translate(side * s * 0.95, -s * 0.9);
        c.rotate(side * (0.6 + wingFlap));
        c.fillStyle = "hsl(46 95% 58%)";
        c.beginPath();
        c.ellipse(0, -s * 0.2, s * 0.22, s * 0.42, 0, 0, TAU);
        c.fill();
        c.restore();
      }
      ball(c, 0, -s * 1.0, s * 1.1, 50, 95, 64);
      c.strokeStyle = "hsl(46 95% 55%)";
      c.lineWidth = s * 0.1;
      c.lineCap = "round";
      for (const k of [-1, 0, 1]) {
        c.beginPath();
        c.moveTo(k * s * 0.12, -s * 2.05);
        c.quadraticCurveTo(k * s * 0.35, -s * 2.45, k * s * 0.05 + s * 0.12, -s * 2.4);
        c.stroke();
      }
      eyes(c, s * 0.4, -s * 1.2, s * 0.2, a);
      cheeks(c, s * 0.65, -s * 0.85, s * 0.16);
      // The beak opens on its chirps.
      const open = a.mouth * s * 0.14;
      c.fillStyle = "#ff9a2e";
      c.beginPath();
      c.moveTo(-s * 0.18, -s * 0.95 - open * 0.3);
      c.lineTo(0, -s * 1.08 - open * 0.3);
      c.lineTo(s * 0.18, -s * 0.95 - open * 0.3);
      c.closePath();
      c.fill();
      c.fillStyle = "#f07a10";
      c.beginPath();
      c.moveTo(-s * 0.15, -s * 0.93 + open * 0.3);
      c.lineTo(0, -s * 0.8 + open * 0.6);
      c.lineTo(s * 0.15, -s * 0.93 + open * 0.3);
      c.closePath();
      c.fill();
      return;
    }
    case "puppy": {
      const fur = "hsl(32 60% 72%)";
      body(c, s, 32, 60, 70, "hsl(35 70% 88%)");
      const swing = Math.sin(a.t * (a.happy ? 12 : 2.5)) * (a.happy ? 0.25 : 0.08);
      for (const side of [-1, 1]) {
        c.save();
        c.translate(side * s * 0.78, hy - s * 0.45);
        c.rotate(side * (0.35 + swing));
        c.fillStyle = "hsl(24 45% 42%)";
        c.beginPath();
        c.ellipse(0, s * 0.35, s * 0.28, s * 0.58, 0, 0, TAU);
        c.fill();
        c.restore();
      }
      ball(c, 0, hy, s, 32, 60, 72);
      c.fillStyle = "hsl(24 45% 52%)";
      c.beginPath();
      c.ellipse(s * 0.38, hy - s * 0.08, s * 0.3, s * 0.32, 0.3, 0, TAU);
      c.fill();
      c.fillStyle = "hsl(35 70% 90%)";
      c.beginPath();
      c.ellipse(0, hy + s * 0.35, s * 0.48, s * 0.36, 0, 0, TAU);
      c.fill();
      eyes(c, s * 0.38, hy - s * 0.08, s * 0.2, a);
      cheeks(c, s * 0.62, hy + s * 0.32, s * 0.14);
      c.fillStyle = "#2a1a20";
      c.beginPath();
      c.ellipse(0, hy + s * 0.2, s * 0.14, s * 0.1, 0, 0, TAU);
      c.fill();
      mouth(c, hy + s * 0.42, s * 0.16, a.mouth);
      if (a.mouth < 0.05) {
        c.fillStyle = "#ff7f9e";
        c.beginPath();
        c.ellipse(s * 0.05, hy + s * 0.55, s * 0.09, s * 0.12, 0, 0, TAU);
        c.fill();
      }
      paws(c, s, fur, a);
      return;
    }
    case "kitten": {
      const fur = "hsl(28 85% 68%)";
      body(c, s, 28, 85, 66, "hsl(35 80% 90%)");
      const twitch = Math.sin(a.t * (a.happy ? 16 : 1.5)) * (a.happy ? 0.12 : 0.04);
      for (const side of [-1, 1]) {
        c.save();
        c.translate(side * s * 0.55, hy - s * 0.65);
        c.rotate(side * (0.25 + twitch));
        c.fillStyle = fur;
        c.beginPath();
        c.moveTo(-s * 0.3, s * 0.2);
        c.lineTo(0, -s * 0.5);
        c.lineTo(s * 0.3, s * 0.2);
        c.closePath();
        c.fill();
        c.fillStyle = "#ffb3c8";
        c.beginPath();
        c.moveTo(-s * 0.15, s * 0.12);
        c.lineTo(0, -s * 0.28);
        c.lineTo(s * 0.15, s * 0.12);
        c.closePath();
        c.fill();
        c.restore();
      }
      ball(c, 0, hy, s, 28, 85, 68);
      c.strokeStyle = "hsl(22 80% 50%)";
      c.lineWidth = s * 0.08;
      c.lineCap = "round";
      for (const k of [-1, 0, 1]) {
        c.beginPath();
        c.moveTo(k * s * 0.2, hy - s * 0.92);
        c.lineTo(k * s * 0.18, hy - s * 0.62);
        c.stroke();
      }
      eyes(c, s * 0.38, hy - s * 0.05, s * 0.21, a);
      cheeks(c, s * 0.6, hy + s * 0.3, s * 0.15);
      c.fillStyle = "#ff8fb1";
      c.beginPath();
      c.moveTo(-s * 0.08, hy + s * 0.18);
      c.lineTo(s * 0.08, hy + s * 0.18);
      c.lineTo(0, hy + s * 0.28);
      c.closePath();
      c.fill();
      mouth(c, hy + s * 0.36, s * 0.14, a.mouth);
      c.strokeStyle = "rgba(90,50,40,0.6)";
      c.lineWidth = Math.max(1, s * 0.03);
      for (const side of [-1, 1])
        for (const dy of [-0.05, 0.06]) {
          c.beginPath();
          c.moveTo(side * s * 0.35, hy + s * (0.28 + dy));
          c.lineTo(side * s * 0.85, hy + s * (0.22 + dy * 2));
          c.stroke();
        }
      paws(c, s, fur, a);
      return;
    }
    case "frog": {
      const skin = "hsl(110 60% 55%)";
      body(c, s, 110, 60, 52, "hsl(70 70% 82%)");
      c.fillStyle = skin;
      c.save();
      c.translate(0, hy + s * 0.15);
      const g = c.createRadialGradient(-s * 0.4, -s * 0.4, s * 0.1, 0, 0, s * 1.2);
      g.addColorStop(0, "hsl(105 70% 70%)");
      g.addColorStop(1, "hsl(115 55% 42%)");
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(0, 0, s * 1.15, s * 0.82, 0, 0, TAU);
      c.fill();
      c.restore();
      for (const side of [-1, 1]) ball(c, side * s * 0.5, hy - s * 0.55, s * 0.4, 110, 60, 58);
      for (const side of [-1, 1]) {
        c.fillStyle = "#fff";
        c.beginPath();
        c.arc(side * s * 0.5, hy - s * 0.58, s * 0.28, 0, TAU);
        c.fill();
      }
      eyes(c, s * 0.5, hy - s * 0.58, s * 0.17, a);
      cheeks(c, s * 0.75, hy + s * 0.2, s * 0.17);
      if (a.mouth > 0.05) mouth(c, hy + s * 0.25, s * 0.3, a.mouth);
      else {
        c.strokeStyle = "#2f5a2a";
        c.lineWidth = s * 0.07;
        c.lineCap = "round";
        c.beginPath();
        c.arc(0, hy - s * 0.05, s * 0.55, 0.45, Math.PI - 0.45);
        c.stroke();
      }
      paws(c, s, skin, a);
      return;
    }
    case "duck": {
      body(c, s, 45, 40, 94, "#fff");
      for (const side of [-1, 1]) {
        c.save();
        c.translate(side * s * 0.8, -s * 0.55);
        c.rotate(side * (0.5 + (a.happy || a.wave ? Math.sin(a.t * 20) * 0.4 : 0)));
        c.fillStyle = "hsl(45 30% 88%)";
        c.beginPath();
        c.ellipse(0, -s * 0.15, s * 0.2, s * 0.4, 0, 0, TAU);
        c.fill();
        c.restore();
      }
      ball(c, 0, hy, s, 45, 40, 95);
      c.strokeStyle = "hsl(45 30% 85%)";
      c.lineWidth = s * 0.1;
      c.lineCap = "round";
      c.beginPath();
      c.arc(s * 0.12, hy - s * 1.05, s * 0.16, Math.PI * 0.8, Math.PI * 2.2);
      c.stroke();
      eyes(c, s * 0.38, hy - s * 0.15, s * 0.2, a);
      cheeks(c, s * 0.62, hy + s * 0.18, s * 0.15);
      const open = a.mouth * s * 0.16;
      c.fillStyle = "#ffa531";
      c.beginPath();
      c.ellipse(0, hy + s * 0.22 - open * 0.4, s * 0.42, s * 0.14, 0, 0, TAU);
      c.fill();
      c.fillStyle = "#f08a1c";
      c.beginPath();
      c.ellipse(0, hy + s * 0.34 + open * 0.6, s * 0.34, s * 0.1, 0, 0, TAU);
      c.fill();
      c.fillStyle = "rgba(255,255,255,0.6)";
      c.beginPath();
      c.ellipse(-s * 0.15, hy + s * 0.17 - open * 0.4, s * 0.12, s * 0.04, 0, 0, TAU);
      c.fill();
      return;
    }
    case "bear": {
      const fur = "hsl(26 48% 48%)";
      body(c, s, 26, 48, 46, "hsl(32 50% 74%)");
      for (const side of [-1, 1]) {
        ball(c, side * s * 0.72, hy - s * 0.72, s * 0.32, 26, 48, 46);
        c.fillStyle = "hsl(20 60% 75%)";
        c.beginPath();
        c.arc(side * s * 0.72, hy - s * 0.72, s * 0.16, 0, TAU);
        c.fill();
      }
      ball(c, 0, hy, s, 26, 48, 50);
      c.fillStyle = "hsl(32 50% 78%)";
      c.beginPath();
      c.ellipse(0, hy + s * 0.32, s * 0.45, s * 0.34, 0, 0, TAU);
      c.fill();
      eyes(c, s * 0.38, hy - s * 0.1, s * 0.19, a);
      cheeks(c, s * 0.62, hy + s * 0.28, s * 0.14);
      c.fillStyle = "#2a1a20";
      c.beginPath();
      c.ellipse(0, hy + s * 0.18, s * 0.15, s * 0.1, 0, 0, TAU);
      c.fill();
      mouth(c, hy + s * 0.42, s * 0.15, a.mouth);
      paws(c, s, fur, a);
      return;
    }
    case "owl": {
      body(c, s, 268, 35, 60, "hsl(40 60% 88%)");
      c.strokeStyle = "hsl(268 30% 55%)";
      c.lineWidth = s * 0.05;
      for (const [x, y] of [[-0.18, -0.45], [0.18, -0.45], [0, -0.25]]) {
        c.beginPath();
        c.moveTo((x - 0.08) * s, y * s);
        c.lineTo(x * s, (y + 0.07) * s);
        c.lineTo((x + 0.08) * s, y * s);
        c.stroke();
      }
      const flap = a.happy || a.wave ? Math.sin(a.t * 18) * 0.5 : 0;
      for (const side of [-1, 1]) {
        c.save();
        c.translate(side * s * 0.8, -s * 0.7);
        c.rotate(side * (0.3 + flap));
        c.fillStyle = "hsl(268 35% 48%)";
        c.beginPath();
        c.ellipse(0, s * 0.05, s * 0.22, s * 0.48, 0, 0, TAU);
        c.fill();
        c.restore();
      }
      for (const side of [-1, 1]) {
        c.fillStyle = "hsl(268 35% 55%)";
        c.beginPath();
        c.moveTo(side * s * 0.75, hy - s * 0.45);
        c.lineTo(side * s * 0.72, hy - s * 1.15);
        c.lineTo(side * s * 0.3, hy - s * 0.8);
        c.closePath();
        c.fill();
      }
      ball(c, 0, hy, s, 268, 35, 62);
      for (const side of [-1, 1]) {
        c.fillStyle = "hsl(40 70% 92%)";
        c.beginPath();
        c.arc(side * s * 0.4, hy - s * 0.05, s * 0.38, 0, TAU);
        c.fill();
      }
      eyes(c, s * 0.4, hy - s * 0.05, s * 0.22, a);
      c.fillStyle = "#ffa531";
      c.beginPath();
      c.moveTo(-s * 0.1, hy + s * 0.22);
      c.lineTo(0, hy + s * 0.42 + a.mouth * s * 0.1);
      c.lineTo(s * 0.1, hy + s * 0.22);
      c.closePath();
      c.fill();
      cheeks(c, s * 0.68, hy + s * 0.35, s * 0.13);
      return;
    }
  }
}

// --- the game ----------------------------------------------------------------------

interface Spot {
  kind: SpotKind;
  x: number;
  y: number;
  r: number;
  animal: Animal;
  state: "hidden" | "up" | "down";
  tState: number;
  /** How long this pop stays out; a tap while out extends it. */
  stay: number;
  rise: number;
  from: number;
  sq: number;
  sqV: number;
  rustle: number;
  giggle: number;
  mouthFrom: number;
  mouthTo: number;
  blinkAt: number;
  look: number;
  back: HTMLCanvasElement | null;
  front: HTMLCanvasElement | null;
}

interface Flower {
  x: number;
  y: number;
  age: number;
  hue: number;
  size: number;
  petals: number;
  phase: number;
  dying: number;
}

interface Butterfly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
  phase: number;
  gx: number;
  gy: number;
  goalT: number;
  boost: number;
  size: number;
}

/** Hiding-spot layouts as fractions of the screen. Portrait stacks, landscape spreads. */
const PORTRAIT: Array<[SpotKind, number, number]> = [
  ["tree", 0.27, 0.36],
  ["fence", 0.73, 0.38],
  ["pot", 0.72, 0.55],
  ["bush", 0.3, 0.57],
  ["pond", 0.3, 0.78],
  ["box", 0.72, 0.74],
];
const LANDSCAPE: Array<[SpotKind, number, number]> = [
  ["tree", 0.2, 0.4],
  ["fence", 0.44, 0.46],
  ["log", 0.66, 0.5],
  ["pot", 0.86, 0.45],
  ["bush", 0.3, 0.78],
  ["pond", 0.52, 0.82],
  ["box", 0.74, 0.78],
];

function createPeekaboo(env: GameEnv): CanvasGame {
  const reduced = env.reduced;
  let W = 0;
  let H = 0;
  let horizon = 0;
  let meadow: HTMLCanvasElement | null = null;
  const cloudImg = makeCloud();
  let clouds: Array<{ x: number; y: number; s: number; speed: number }> = [];
  let spots: Spot[] = [];
  let flowers: Flower[] = [];
  let butterflies: Butterfly[] = [];
  const fx = new Particles(260);
  const drags = new Map<number, { x: number; y: number; spot: number }>();
  let now = 0;
  let lastTrailNote = -1;
  let teaser = 4;

  const unusedAnimal = (except: Animal | null): Animal => {
    const showing = new Set(spots.filter((s) => s.state !== "hidden").map((s) => s.animal));
    const assigned = new Set(spots.map((s) => s.animal));
    const fresh = ANIMALS.filter((a) => a !== except && !assigned.has(a));
    if (fresh.length) return pick(fresh);
    const ok = ANIMALS.filter((a) => a !== except && !showing.has(a));
    return pick(ok.length ? ok : ANIMALS);
  };

  const layout = (w: number, h: number) => {
    W = w;
    H = h;
    const portrait = h > w * 1.05;
    horizon = h * (portrait ? 0.2 : 0.28);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    meadow = paint(w, h, dpr, (c) => paintMeadow(c, w, h, horizon));
    const r = portrait ? clamp(Math.min(w * 0.155, h * 0.08), 48, 110) : clamp(Math.min(h * 0.115, w * 0.075), 48, 120);
    const plan = portrait ? PORTRAIT : LANDSCAPE;
    const old = spots;
    spots = plan.map(([kind, fx0, fy0], i) => {
      const prev = old.find((s) => s.kind === kind);
      const s: Spot = {
        kind,
        x: fx0 * w,
        y: fy0 * h,
        r,
        animal: prev?.animal ?? ANIMALS[i % ANIMALS.length],
        state: prev?.state ?? "hidden",
        tState: prev?.tState ?? 0,
        stay: prev?.stay ?? STAY,
        rise: prev?.rise ?? 0,
        from: prev?.from ?? 0,
        sq: 0,
        sqV: 0,
        rustle: 0,
        giggle: 0,
        mouthFrom: -1,
        mouthTo: -1,
        blinkAt: rand(1, 4),
        look: 0,
        back: null,
        front: null,
      };
      // Keep every spot, and the animal that pops out of it, clear of the
      // parent's corner squares.
      const g = GEO[kind];
      const top = s.y + (g.upY - 2.3 * 0.55) * r;
      const bot = s.y + g.bottom * r;
      if (top < CORNER || bot > h - CORNER) {
        const left = s.x - 1.45 * r;
        const right = s.x + 1.45 * r;
        if (left < CORNER) s.x += CORNER - left;
        if (right > w - CORNER) s.x -= right - (w - CORNER);
      }
      s.back = paint(4 * r, 5.2 * r, dpr, (c) => {
        c.translate(2 * r, 2.2 * r);
        paintSpot(c, kind, "back", r);
      });
      s.front = paint(4 * r, 5.2 * r, dpr, (c) => {
        c.translate(2 * r, 2.2 * r);
        paintSpot(c, kind, "front", r);
      });
      return s;
    });
    if (!old.length) {
      // First deal: every spot a different animal, in a random order.
      const deck = [...ANIMALS].sort(() => Math.random() - 0.5);
      spots.forEach((s, i) => (s.animal = deck[i % deck.length]));
    }
    const n = clamp(Math.round(w / 300), 2, 5);
    clouds = Array.from({ length: n }, (_, i) => ({
      x: ((i + rand(0, 0.8)) / n) * (w + 220) - 110,
      y: rand(0.08, 0.5) * horizon,
      s: rand(0.45, 0.8) * clamp(w / 900, 0.6, 1.2),
      speed: rand(5, 12) * (reduced ? 0.3 : 1),
    }));
    const bs = clamp(Math.min(w, h) * 0.035, 14, 30);
    if (!butterflies.length) {
      butterflies = Array.from({ length: reduced ? 2 : 3 }, () => ({
        x: rand(0.2, 0.8) * w,
        y: rand(0.3, 0.8) * h,
        vx: 0,
        vy: 0,
        hue: pick([300, 195, 42, 340, 265]),
        phase: rand(0, TAU),
        gx: w / 2,
        gy: h / 2,
        goalT: 0,
        boost: 0,
        size: bs,
      }));
    } else for (const b of butterflies) b.size = bs;
  };

  const hitSpot = (x: number, y: number): number => {
    let best = -1;
    let score = Infinity;
    spots.forEach((s, i) => {
      const g = GEO[s.kind];
      const hitR = s.r * (s.kind === "tree" ? 1.55 : 1.45);
      let d = Math.hypot(x - s.x, y - (s.y + g.hitDy * s.r)) / hitR;
      if (s.state !== "hidden") {
        // An animal that is out is part of the target too: tap its face.
        const ay = s.y + (DOWN + (g.upY - DOWN) * s.rise) * s.r - 1.35 * 0.55 * s.r;
        d = Math.min(d, Math.hypot(x - s.x, y - ay) / (s.r * 0.8));
      }
      if (d < 1 && d < score) {
        score = d;
        best = i;
      }
    });
    return best;
  };

  const leaves = (s: Spot) => {
    if (s.kind === "pond") {
      fx.burst(s.x, s.y + s.r * 0.3, { count: 14, shapes: ["dot"], hues: [195, 190, 205], speed: [120, 300], gravity: 700, life: [0.5, 0.9], size: [3, 6], up: 200 });
    } else if (s.kind === "bush" || s.kind === "tree") {
      fx.burst(s.x, s.y - s.r * 0.3, { count: 10, shapes: ["confetti"], hues: [110, 125, 90], speed: [80, 240], gravity: 260, life: [0.6, 1.1], size: [4, 8], up: 120 });
    } else {
      fx.burst(s.x, s.y, { count: 8, shapes: ["star"], speed: [100, 260], gravity: 300, life: [0.5, 0.9], size: [5, 9], up: 120 });
    }
  };

  const pop = (s: Spot) => {
    s.rustle = 1;
    leaves(s);
    rustleSound(s.kind === "pond");
    if (s.state === "up") {
      // Already out: giggle, say it again, and stay a bit longer.
      s.giggle = 1;
      s.stay = Math.max(s.stay, s.tState + 1.6);
      s.mouthFrom = now;
      s.mouthTo = now + 0.55;
      voice(s.animal);
      fx.burst(s.x, s.y + GEO[s.kind].upY * s.r - s.r * 1.2, { count: 6, shapes: ["heart"], hues: [340, 350, 0], speed: [40, 120], gravity: -60, drag: 0.4, life: [0.8, 1.3], size: [7, 11], up: 60 });
      return;
    }
    s.from = s.rise;
    s.state = "up";
    s.tState = 0;
    s.stay = STAY;
    s.sq = 0.38;
    s.sqV = 0;
    s.giggle = 0.6;
    s.look = rand(-1, 1);
    sting();
    voice(s.animal, 0.3);
    s.mouthFrom = now + 0.3;
    s.mouthTo = now + 0.85;
  };

  const sprout = (x: number, y: number) => {
    flowers.push({ x, y, age: 0, hue: pick([350, 300, 52, 195, 18, 265]), size: clamp(Math.min(W, H) * rand(0.045, 0.065), 22, 52), petals: pick([5, 6, 8]), phase: rand(0, TAU), dying: -1 });
    const alive = flowers.filter((f) => f.dying < 0);
    if (alive.length > MAX_FLOWERS) alive[0].dying = 0;
    fx.burst(x, y - 20, { count: 10, shapes: ["star", "dot"], speed: [60, 200], gravity: 120, life: [0.5, 0.9], size: [3, 7] });
    note(Math.floor(clamp(x / W, 0, 0.99) * 8) + 3, { type: "sine", duration: 0.9, gain: 0.13, reverb: 0.5 });
    note(Math.floor(clamp(x / W, 0, 0.99) * 8) + 7, { type: "triangle", duration: 0.5, gain: 0.05, reverb: 0.5, delay: 0.08 });
  };

  const sky = (x: number, y: number) => {
    fx.burst(x, y, { count: 16, shapes: ["star"], hues: [52, 42, 195, 300], speed: [100, 320], gravity: 160, life: [0.6, 1.1], size: [5, 10] });
    note(Math.floor(clamp(x / W, 0, 0.99) * 5) + 8, { type: "sine", duration: 0.8, gain: 0.12, reverb: 0.6 });
    note(Math.floor(clamp(x / W, 0, 0.99) * 5) + 10, { type: "sine", duration: 0.7, gain: 0.08, reverb: 0.6, delay: 0.1 });
  };

  const hitButterfly = (x: number, y: number): Butterfly | null => {
    for (const b of butterflies) if (Math.hypot(x - b.x, y - b.y) < b.size * 2.2 + 12) return b;
    return null;
  };

  const goalFor = (b: Butterfly) => {
    for (let k = 0; k < 6; k++) {
      b.gx = rand(0.1, 0.9) * W;
      b.gy = rand(0.1, 0.85) * H;
      const corner = (b.gx < CORNER || b.gx > W - CORNER) && (b.gy < CORNER || b.gy > H - CORNER);
      if (!corner) break;
    }
    b.goalT = rand(2, 5);
  };

  const update = (dt: number) => {
    for (const s of spots) {
      s.tState += dt;
      s.rustle = Math.max(0, s.rustle - dt * 2.2);
      s.giggle = Math.max(0, s.giggle - dt * 1.2);
      [s.sq, s.sqV] = spring(s.sq, s.sqV, 0, dt, 220, 9);
      s.blinkAt -= dt;
      if (s.blinkAt < -0.14) s.blinkAt = rand(1.5, 3.5);
      if (s.state === "up") {
        const k = Math.min(1, s.tState / 0.5);
        s.rise = s.from + (1 - s.from) * easeOutBack(k, 2.4);
        if (s.tState > s.stay) {
          s.state = "down";
          s.from = s.rise;
          s.tState = 0;
          s.sqV = -3;
          // A tiny "whoop" down, so leaving is part of the joke, not an ending.
          sweep({ pitch: [[0, 700], [0.25, 260]], dur: 0.28, gain: 0.08 });
        }
      } else if (s.state === "down") {
        const k = Math.min(1, s.tState / 0.32);
        s.rise = s.from * (1 - k * k);
        if (k >= 1) {
          s.state = "hidden";
          s.rise = 0;
          s.rustle = 0.6;
          // The shuffle: who is behind this bush next time is a surprise.
          s.animal = unusedAnimal(s.animal);
        }
      }
    }
    if (!reduced) {
      // Now and then a hidden spot gives a little wiggle: something is in there.
      teaser -= dt;
      if (teaser <= 0) {
        teaser = rand(3.5, 6.5);
        const hidden = spots.filter((s) => s.state === "hidden");
        if (hidden.length) pick(hidden).rustle = 0.45;
      }
    }
    for (const f of flowers) {
      f.age += dt;
      if (f.dying >= 0) f.dying += dt;
    }
    flowers = flowers.filter((f) => f.dying < 0.4);
    for (const c of clouds) {
      c.x += c.speed * dt;
      if (c.x > W + 120) c.x = -220 * c.s - 20;
    }
    for (const b of butterflies) {
      b.goalT -= dt;
      if (b.goalT <= 0 || Math.hypot(b.gx - b.x, b.gy - b.y) < 30) goalFor(b);
      b.boost = Math.max(0, b.boost - dt);
      const speed = (reduced ? 40 : 70) * (1 + b.boost * 2.5);
      const dx = b.gx - b.x;
      const dy = b.gy - b.y;
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, dt * 1.5);
      b.vx += ((dx / d) * speed - b.vx) * k;
      b.vy += ((dy / d) * speed - b.vy) * k;
      b.phase += dt * (reduced ? 9 : 14) * (1 + b.boost);
      // The bob of a fluttering flight: lift on every wingbeat.
      const flutter = Math.sin(b.phase) * (reduced ? 10 : 26);
      b.x += b.vx * dt;
      b.y += (b.vy + flutter) * dt;
    }
    fx.update(dt);
  };

  const drawSpot = (ctx: CanvasRenderingContext2D, s: Spot, t: number) => {
    const r = s.r;
    const wob = Math.sin(t * 38) * 0.07 * s.rustle;
    const place = (img: HTMLCanvasElement | null) => {
      if (!img) return;
      ctx.save();
      // Rustle pivots at the base, like a real bush shaking from the root.
      ctx.translate(s.x, s.y + r);
      ctx.rotate(wob);
      ctx.scale(1 + s.rustle * 0.04, 1 - s.rustle * 0.02);
      ctx.drawImage(img, -2 * r, -3.2 * r, 4 * r, 5.2 * r);
      ctx.restore();
    };
    place(s.back);
    if (s.state !== "hidden" && s.rise > 0.001) {
      const g = GEO[s.kind];
      const ay = s.y + (DOWN + (g.upY - DOWN) * s.rise) * r;
      const sz = r * 0.55;
      const since = now - s.mouthFrom;
      const talking = now >= s.mouthFrom && now <= s.mouthTo;
      const anim: Anim = {
        t,
        blink: s.blinkAt < 0,
        happy: s.giggle > 0.35 && !talking,
        wave: s.state === "up" && s.tState > 0.55 && s.tState < 1.9 ? Math.sin((s.tState - 0.55) * 11) * 0.55 : 0,
        mouth: talking ? 0.5 + 0.5 * Math.abs(Math.sin(since * 22)) : 0,
        look: s.look,
      };
      ctx.save();
      ctx.beginPath();
      ctx.rect(s.x - 3 * r, s.y - 5 * r, 6 * r, 5 * r + CLIP * r);
      ctx.clip();
      ctx.translate(s.x, ay);
      ctx.rotate(Math.sin(t * 24) * 0.1 * s.giggle);
      ctx.scale(1 - s.sq * 0.5, 1 + s.sq);
      drawAnimal(ctx, s.animal, sz, anim);
      ctx.restore();
      if (s.kind === "pond") {
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = Math.max(2, r * 0.04);
        const k = (t * 1.5) % 1;
        ctx.globalAlpha = 1 - k;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y + CLIP * r, r * (0.6 + k * 0.5), r * (0.12 + k * 0.08), 0, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    place(s.front);
  };

  const drawFlower = (ctx: CanvasRenderingContext2D, f: Flower, t: number) => {
    const grow = easeOutBack(Math.min(1, f.age / 0.45), 2);
    const open = easeOutBack(clamp((f.age - 0.2) / 0.4, 0, 1), 2.5);
    const fade = f.dying >= 0 ? 1 - f.dying / 0.4 : 1;
    const sz = f.size * fade;
    const sway = Math.sin(t * 1.6 + f.phase) * sz * (reduced ? 0.04 : 0.12);
    const hx = f.x + sway;
    const hy = f.y - sz * 1.6 * grow;
    ctx.strokeStyle = "#3f9e3a";
    ctx.lineWidth = Math.max(2, sz * 0.12);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.quadraticCurveTo(f.x, (f.y + hy) / 2, hx, hy);
    ctx.stroke();
    ctx.fillStyle = "#58b847";
    ctx.beginPath();
    ctx.ellipse(f.x + sz * 0.25, f.y - sz * 0.5 * grow, sz * 0.28 * grow, sz * 0.12 * grow, -0.5, 0, TAU);
    ctx.fill();
    if (open <= 0) return;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(Math.sin(t * 1.2 + f.phase) * 0.1);
    ctx.scale(open, open);
    for (let i = 0; i < f.petals; i++) {
      const a = (i / f.petals) * TAU;
      ctx.fillStyle = hsl(f.hue + (i % 2) * 12, 90, 72);
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * sz * 0.42, Math.sin(a) * sz * 0.42, sz * 0.32, sz * 0.2, a, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = "#ffd23e";
    ctx.beginPath();
    ctx.arc(0, 0, sz * 0.26, 0, TAU);
    ctx.fill();
    // A sleepy smiling face in the middle — the flower is happy to be here.
    ctx.strokeStyle = "#7a4a10";
    ctx.lineWidth = Math.max(1, sz * 0.04);
    ctx.beginPath();
    ctx.arc(-sz * 0.09, -sz * 0.03, sz * 0.05, Math.PI * 1.1, Math.PI * 1.9);
    ctx.moveTo(sz * 0.14, -sz * 0.03);
    ctx.arc(sz * 0.09, -sz * 0.03, sz * 0.05, Math.PI * 1.1, Math.PI * 1.9);
    ctx.moveTo(sz * 0.08, sz * 0.07);
    ctx.arc(0, sz * 0.05, sz * 0.08, 0.3, Math.PI - 0.3);
    ctx.stroke();
    ctx.restore();
  };

  const drawButterfly = (ctx: CanvasRenderingContext2D, b: Butterfly) => {
    const s = b.size;
    const flap = 0.25 + 0.75 * Math.abs(Math.sin(b.phase));
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(clamp(b.vx / 300, -0.4, 0.4));
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side * flap, 1);
      const g = ctx.createRadialGradient(s * 0.5, -s * 0.5, s * 0.1, s * 0.5, -s * 0.4, s);
      g.addColorStop(0, hsl(b.hue + 30, 95, 80));
      g.addColorStop(1, hsl(b.hue, 85, 58));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(s * 0.55, -s * 0.45, s * 0.6, s * 0.48, -0.5, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(s * 0.45, s * 0.35, s * 0.4, s * 0.32, 0.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.arc(s * 0.6, -s * 0.5, s * 0.14, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = "#3b2a4a";
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.12, s * 0.5, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#3b2a4a";
    ctx.lineWidth = Math.max(1, s * 0.06);
    ctx.beginPath();
    ctx.moveTo(-s * 0.05, -s * 0.45);
    ctx.quadraticCurveTo(-s * 0.2, -s * 0.85, -s * 0.3, -s * 0.9);
    ctx.moveTo(s * 0.05, -s * 0.45);
    ctx.quadraticCurveTo(s * 0.2, -s * 0.85, s * 0.3, -s * 0.9);
    ctx.stroke();
    ctx.restore();
  };

  return {
    resize: layout,

    frame(ctx, dt, t, w, h) {
      now = t;
      if (w !== W || h !== H || !meadow) layout(w, h);
      if (!meadow) return;
      update(dt);

      ctx.drawImage(meadow, 0, 0, w, h);
      for (const c of clouds) {
        const bob = reduced ? 0 : Math.sin(t * 0.4 + c.x * 0.01) * 3;
        ctx.drawImage(cloudImg, c.x, c.y + bob, 220 * c.s, 110 * c.s);
      }

      // Spots and flowers share one back-to-front order by where they meet the ground.
      const items: Array<{ y: number; spot?: Spot; flower?: Flower }> = [];
      for (const s of spots) items.push({ y: s.y + GEO[s.kind].bottom * s.r, spot: s });
      for (const f of flowers) items.push({ y: f.y, flower: f });
      items.sort((a, b) => a.y - b.y);
      for (const it of items) {
        if (it.spot) drawSpot(ctx, it.spot, t);
        else if (it.flower) drawFlower(ctx, it.flower, t);
      }

      for (const b of butterflies) drawButterfly(ctx, b);
      fx.draw(ctx);
    },

    down(p: GamePointer) {
      const i = hitSpot(p.x, p.y);
      drags.set(p.id, { x: p.x, y: p.y, spot: i });
      if (i >= 0) {
        pop(spots[i]);
        return;
      }
      const b = hitButterfly(p.x, p.y);
      if (b) {
        b.boost = 1.2;
        b.vy -= 240;
        b.gy = Math.max(H * 0.1, b.y - H * 0.3);
        [9, 11, 10, 12].forEach((n, k) => note(n, { type: "sine", duration: 0.35, gain: 0.09, delay: k * 0.06, reverb: 0.5 }));
        fx.burst(b.x, b.y, { count: 12, shapes: ["star", "dot"], hues: [b.hue, 52, 195], speed: [80, 220], gravity: 80, life: [0.5, 0.9], size: [3, 7] });
        return;
      }
      if (p.y < horizon + H * 0.04) sky(p.x, p.y);
      else sprout(p.x, p.y);
    },

    move(p: GamePointer) {
      const d = drags.get(p.id);
      if (!d) return;
      const dist = Math.hypot(p.x - d.x, p.y - d.y);
      if (dist < 14) return;
      d.x = p.x;
      d.y = p.y;
      // A sweeping hand leaves sparkles and pops every hiding spot it crosses.
      fx.burst(p.x, p.y, { count: 2, shapes: ["star", "dot"], speed: [20, 80], gravity: 60, life: [0.4, 0.8], size: [3, 6], hues: CANDY });
      if (now - lastTrailNote > 0.13) {
        lastTrailNote = now;
        note(Math.floor(clamp(p.x / Math.max(1, W), 0, 0.99) * 8) + 3, { type: "sine", duration: 0.4, gain: 0.06, reverb: 0.5 });
      }
      const i = hitSpot(p.x, p.y);
      if (i !== d.spot) {
        d.spot = i;
        if (i >= 0 && spots[i].state !== "up") pop(spots[i]);
      }
    },

    up(p: GamePointer) {
      drags.delete(p.id);
    },
  };
}
