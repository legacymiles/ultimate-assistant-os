"use client";

// ---------------------------------------------------------------------------
// Zoom — a toy town where every tap sends something down the road.
//
// The rule every game here keeps: a touch anywhere must answer at once. A
// vehicle that has to drive in from the far edge would make the baby wait, so
// it comes in from the edge NEAREST the finger, already at speed, and the horn
// sounds on the same frame as the touch. The finger also gets its own little
// starburst, so even a tap in the sky has an instant "I did that".
//
// Six vehicles, each with its own voice, because the sound is half the toy:
// a car's beep-beep, a bus's low two-note horn, a fire truck's siren, an ice
// cream van's tune, a rocket car's whoosh, and a train that chugs and whistles
// along its own track. Touching one makes it hop (sometimes a full flip);
// holding and dragging makes it follow the hand, and letting go flings it.
//
// The scenery that never moves — sky, hills, houses, road, rails — is painted
// once per screen size onto an offscreen canvas. Everything in the frame
// loop is something that animates.
// ---------------------------------------------------------------------------

import { GameCanvas, type CanvasGame, type GameEnv, type GamePointer } from "./GameCanvas";
import { audio, note } from "@/lib/baby-no-scroll/audio";
import { CANDY, Particles, TAU, clamp, glow, hsl, pick, rand, spring } from "@/lib/baby-no-scroll/fx";

export function Zoom() {
  return <GameCanvas create={createZoom} />;
}

/** Each screen corner holds the parent's lock; nothing a baby needs lives there. */
const CORNER = 120;
const MAX_VEHICLES = 10;
const MAX_PUFFS = 90;

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
  env.gain.setValueAtTime(gain, t + Math.max(attack, dur * 0.6));
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  if (filter) {
    const f = c.createBiquadFilter();
    f.type = filter.type;
    f.frequency.value = filter.freq;
    f.Q.value = filter.q ?? 1;
    osc.connect(f).connect(env);
  } else {
    osc.connect(env);
  }
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
  env.gain.linearRampToValueAtTime(o.gain ?? 0.15, t + o.dur * 0.2);
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f).connect(env).connect(a.out);
  src.start(t, Math.random() * Math.max(0, 1.9 - o.dur));
  src.stop(t + o.dur + 0.05);
}

type VKind = "car" | "bus" | "fire" | "icecream" | "rocket" | "train";

/** Each vehicle's voice. `short` is the hop version: same character, half the length. */
function horn(kind: VKind, pitch: number, short = false): void {
  switch (kind) {
    case "car": {
      // Beep-beep: two square waves a hair apart in pitch, so they beat
      // against each other the way a real horn's two trumpets do.
      const reps = short ? [0] : [0, 0.2];
      for (const d of reps) {
        sweep({ type: "square", pitch: [[0, pitch]], dur: 0.14, gain: 0.06, delay: d, filter: { type: "lowpass", freq: 1900 } });
        sweep({ type: "square", pitch: [[0, pitch * 1.013]], dur: 0.14, gain: 0.06, delay: d, filter: { type: "lowpass", freq: 1900 } });
      }
      break;
    }
    case "bus":
      sweep({ type: "sawtooth", pitch: [[0, 220]], dur: short ? 0.22 : 0.45, gain: 0.06, filter: { type: "lowpass", freq: 1100 } });
      sweep({ type: "sawtooth", pitch: [[0, 277]], dur: short ? 0.22 : 0.45, gain: 0.06, filter: { type: "lowpass", freq: 1100 } });
      break;
    case "fire": {
      const pts: Array<[number, number]> = [[0, 640]];
      const legs = short ? 2 : 4;
      for (let i = 1; i <= legs; i++) pts.push([i * 0.34, i % 2 ? 960 : 640]);
      sweep({ type: "triangle", pitch: pts, dur: legs * 0.34 + 0.05, gain: 0.11, attack: 0.04, reverb: 0.3 });
      break;
    }
    case "icecream": {
      const tune = short ? [5, 7, 9] : [5, 7, 6, 8, 9, 7, 10];
      tune.forEach((n, i) => {
        note(n, { type: "sine", duration: 0.3, gain: 0.11, delay: i * 0.14, reverb: 0.35 });
        note(n + 8, { type: "sine", duration: 0.25, gain: 0.04, delay: i * 0.14, reverb: 0.35 });
      });
      break;
    }
    case "rocket":
      hiss({ dur: short ? 0.4 : 0.8, from: 300, to: 4200, gain: 0.26, q: 1.4 });
      sweep({ pitch: [[0, 180], [short ? 0.35 : 0.7, 900]], dur: short ? 0.4 : 0.75, gain: 0.07 });
      break;
    case "train":
      // A two-pipe whistle with a little wobble, the way steam is never quite steady.
      sweep({ pitch: [[0, 700], [0.08, 740], [short ? 0.35 : 0.75, 720]], dur: short ? 0.4 : 0.8, gain: 0.11, attack: 0.05, vibrato: { rate: 6, depth: 6 }, reverb: 0.4 });
      sweep({ pitch: [[0, 880], [0.08, 932]], dur: short ? 0.4 : 0.8, gain: 0.07, attack: 0.05, vibrato: { rate: 6, depth: 6 }, reverb: 0.4 });
      break;
  }
}

function boing(): void {
  sweep({ pitch: [[0, 200], [0.09, 560], [0.28, 320]], dur: 0.3, gain: 0.16, vibrato: { rate: 22, depth: 30 } });
}

function chug(accent: boolean): void {
  hiss({ dur: 0.1, from: 2200, to: 500, gain: accent ? 0.11 : 0.06, q: 0.9 });
}

// --- painting helpers ----------------------------------------------------------

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

/** A rounded-rectangle path. Our own, so older tablets without ctx.roundRect still work. */
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

function vgrad(c: CanvasRenderingContext2D, y0: number, y1: number, hue: number, s = 85, l = 60): CanvasGradient {
  const g = c.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, hsl(hue, s, l + 14));
  g.addColorStop(0.5, hsl(hue, s, l));
  g.addColorStop(1, hsl(hue, s, l - 16));
  return g;
}

function hillLine(x: number, base: number, amp: number, a: number, b: number): number {
  return base - Math.abs(Math.sin(x * a)) * amp - Math.sin(x * b + 1.3) * amp * 0.35;
}

interface Layout {
  horizon: number;
  roadTop: number;
  roadBot: number;
  laneH: number;
  lanes: number[];
  S: number;
}

function paintScene(c: CanvasRenderingContext2D, w: number, h: number, L: Layout): void {
  const sky = c.createLinearGradient(0, 0, 0, L.horizon + h * 0.05);
  sky.addColorStop(0, "#5ec2ff");
  sky.addColorStop(0.6, "#aee6ff");
  sky.addColorStop(1, "#fff2cf");
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);

  // Far hills, with a little town on them.
  const farBase = L.horizon;
  c.beginPath();
  c.moveTo(0, h);
  for (let x = 0; x <= w + 16; x += 16) c.lineTo(x, hillLine(x, farBase, h * 0.09, 0.0045, 0.011));
  c.lineTo(w, h);
  c.closePath();
  c.fillStyle = "#aee78f";
  c.fill();
  const unit = Math.min(w, h);
  const houses = Math.max(3, Math.round(w / 170));
  for (let i = 0; i < houses; i++) {
    const x = ((i + rand(0.2, 0.8)) / houses) * w;
    const y = hillLine(x, farBase, h * 0.09, 0.0045, 0.011) + unit * 0.012;
    const s = unit * rand(0.035, 0.05);
    c.fillStyle = hsl(pick([18, 42, 195, 340, 265]), 70, 80);
    c.fillRect(x - s * 0.6, y - s, s * 1.2, s);
    c.fillStyle = hsl(pick([2, 350, 210, 20]), 70, 55);
    c.beginPath();
    c.moveTo(x - s * 0.8, y - s);
    c.lineTo(x, y - s * 1.7);
    c.lineTo(x + s * 0.8, y - s);
    c.closePath();
    c.fill();
    c.fillStyle = "#ffe98a";
    c.fillRect(x - s * 0.3, y - s * 0.7, s * 0.25, s * 0.25);
    c.fillStyle = "#8a5a3c";
    c.fillRect(x + s * 0.1, y - s * 0.5, s * 0.25, s * 0.5);
  }

  // Near hills with lollipop trees.
  const nearBase = L.roadTop - L.laneH * 0.05;
  c.beginPath();
  c.moveTo(0, h);
  for (let x = 0; x <= w + 16; x += 16) c.lineTo(x, hillLine(x, nearBase, h * 0.07, 0.0032, 0.008));
  c.lineTo(w, h);
  c.closePath();
  const ng = c.createLinearGradient(0, nearBase - h * 0.08, 0, nearBase + h * 0.05);
  ng.addColorStop(0, "#86da68");
  ng.addColorStop(1, "#5dbd4a");
  c.fillStyle = ng;
  c.fill();
  const trees = Math.max(4, Math.round(w / 140));
  for (let i = 0; i < trees; i++) {
    const x = ((i + rand(0.1, 0.9)) / trees) * w;
    const y = hillLine(x, nearBase, h * 0.07, 0.0032, 0.008) + unit * 0.02;
    const s = unit * rand(0.035, 0.055);
    c.fillStyle = "#8a5a3c";
    c.fillRect(x - s * 0.12, y - s * 1.2, s * 0.24, s * 1.2);
    const tg = c.createRadialGradient(x - s * 0.3, y - s * 1.9, s * 0.1, x, y - s * 1.6, s);
    tg.addColorStop(0, "#9ef07c");
    tg.addColorStop(1, "#3f9e3a");
    c.fillStyle = tg;
    c.beginPath();
    c.arc(x, y - s * 1.65, s * 0.8, 0, TAU);
    c.fill();
  }

  // Meadow under everything.
  c.fillStyle = "#6fcf55";
  c.fillRect(0, L.roadTop, w, h - L.roadTop);

  // The railway: gravel bed, sleepers, two shining rails.
  const rail = L.lanes[0];
  const bedTop = rail - L.laneH * 0.36;
  const bedBot = rail + L.laneH * 0.12;
  c.fillStyle = "#dcc9a6";
  c.fillRect(0, bedTop, w, bedBot - bedTop);
  c.fillStyle = "rgba(120,90,60,0.25)";
  for (let i = 0; i < w / 6; i++) c.fillRect(Math.random() * w, bedTop + Math.random() * (bedBot - bedTop), 3, 2);
  c.fillStyle = "#8a5f3e";
  const step = Math.max(18, L.S * 0.32);
  for (let x = step / 2; x < w; x += step) c.fillRect(x - step * 0.18, bedTop + 2, step * 0.36, bedBot - bedTop - 4);
  for (const y of [rail - L.laneH * 0.24, rail]) {
    c.fillStyle = "#9aa3b5";
    c.fillRect(0, y - 3, w, 5);
    c.fillStyle = "#e9eef7";
    c.fillRect(0, y - 3, w, 1.5);
  }

  // The road, with candy-striped kerbs.
  const top = L.roadTop + L.laneH * 1.02;
  const bot = L.roadBot;
  const rg = c.createLinearGradient(0, top, 0, bot);
  rg.addColorStop(0, "#666e80");
  rg.addColorStop(1, "#4f5668");
  c.fillStyle = rg;
  c.fillRect(0, top, w, bot - top);
  const kerb = Math.max(6, L.laneH * 0.08);
  const stripe = kerb * 3;
  for (const y of [top - kerb, bot]) {
    for (let x = 0, i = 0; x < w; x += stripe, i++) {
      c.fillStyle = i % 2 ? "#ffffff" : "#ff5a6e";
      c.fillRect(x, y, stripe, kerb);
    }
  }
  const mid = L.roadTop + L.laneH * 2.02;
  c.fillStyle = "#fff6c8";
  for (let x = 0; x < w; x += L.S * 0.9) c.fillRect(x, mid - 3, L.S * 0.5, 6);

  // Grass tufts and dot flowers: the texture of a toy-box landscape.
  for (let i = 0; i < w / 18; i++) {
    const x = Math.random() * w;
    const y = bot + kerb + Math.random() * Math.max(4, h - bot - kerb);
    c.fillStyle = hsl(pick([350, 52, 300, 200, 0]), 90, 72);
    c.beginPath();
    c.arc(x, y, rand(2, 4), 0, TAU);
    c.fill();
  }
  for (let i = 0; i < w / 14; i++) {
    const x = Math.random() * w;
    const y = L.roadTop + Math.random() * (bedTop - L.roadTop);
    c.fillStyle = "rgba(60,150,50,0.6)";
    c.fillRect(x, y, 2, 6);
  }
}

function makeCloud(): HTMLCanvasElement {
  return paint(240, 120, 1, (c) => {
    const puffs: Array<[number, number, number]> = [[60, 78, 34], [100, 58, 44], [150, 62, 40], [185, 82, 30], [120, 88, 36]];
    c.fillStyle = "rgba(180,215,240,0.9)";
    for (const [x, y, r] of puffs) {
      c.beginPath();
      c.arc(x + 3, y + 6, r, 0, TAU);
      c.fill();
    }
    c.fillStyle = "#ffffff";
    for (const [x, y, r] of puffs) {
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
    }
  });
}

// --- vehicles ------------------------------------------------------------------

interface Spec {
  /** Body length in S units. */
  len: number;
  /** Extra length trailing behind (train carriages). */
  tail: number;
  /** Height in S units, for touch hit-testing. */
  tall: number;
  /** Cruise speed as a fraction of screen width per second. */
  speed: number;
  wheel: number;
}

const SPEC: Record<VKind, Spec> = {
  car: { len: 1.7, tail: 0, tall: 1.05, speed: 0.55, wheel: 0.2 },
  bus: { len: 2.5, tail: 0, tall: 1.25, speed: 0.42, wheel: 0.22 },
  fire: { len: 2.3, tail: 0, tall: 1.3, speed: 0.5, wheel: 0.21 },
  icecream: { len: 2.0, tail: 0, tall: 1.9, speed: 0.4, wheel: 0.2 },
  rocket: { len: 1.9, tail: 0, tall: 1.1, speed: 0.95, wheel: 0.16 },
  train: { len: 1.9, tail: 3.2, tall: 1.4, speed: 0.36, wheel: 0.2 },
};

interface Vehicle {
  kind: VKind;
  lane: number;
  /** Ground line the wheels sit on; eases between lanes while dragged. */
  y: number;
  x: number;
  dir: 1 | -1;
  /** Signed px/s. */
  vel: number;
  cruise: number;
  hue: number;
  hues: number[];
  pitch: number;
  bob: number;
  bobV: number;
  hopY: number;
  hopV: number;
  flip: number;
  flipping: boolean;
  wheel: number;
  stretch: number;
  stretchV: number;
  follow: number | null;
  target: number;
  blink: number;
  happy: number;
  sfx: number;
  sfxCount: number;
  dust: number;
  age: number;
}

interface Puff {
  x: number;
  y: number;
  r: number;
  grow: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
}

function wheel(c: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, hue: number): void {
  c.fillStyle = "#2c2c3a";
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
  c.fillStyle = hsl(hue, 30, 88);
  c.beginPath();
  c.arc(x, y, r * 0.58, 0, TAU);
  c.fill();
  // Spokes: the only way a spinning circle looks like it is spinning.
  c.strokeStyle = hsl(hue, 70, 55);
  c.lineWidth = Math.max(1.5, r * 0.16);
  c.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    const k = a + (i / 3) * Math.PI;
    c.beginPath();
    c.moveTo(x + Math.cos(k) * r * 0.5, y + Math.sin(k) * r * 0.5);
    c.lineTo(x - Math.cos(k) * r * 0.5, y - Math.sin(k) * r * 0.5);
    c.stroke();
  }
  c.fillStyle = hsl(hue, 70, 55);
  c.beginPath();
  c.arc(x, y, r * 0.18, 0, TAU);
  c.fill();
  c.fillStyle = "rgba(255,255,255,0.35)";
  c.beginPath();
  c.arc(x - r * 0.3, y - r * 0.35, r * 0.22, 0, TAU);
  c.fill();
}

/** A friendly side-on face: two big eyes looking where it is going, and a grin. */
function face(c: CanvasRenderingContext2D, x: number, y: number, S: number, blink: boolean, happy: boolean): void {
  const er = S * 0.1;
  for (const ex of [x - S * 0.13, x + S * 0.13]) {
    if (happy) {
      c.strokeStyle = "#2a1838";
      c.lineWidth = er * 0.4;
      c.lineCap = "round";
      c.beginPath();
      c.arc(ex, y + er * 0.3, er * 0.7, Math.PI * 1.15, Math.PI * 1.85);
      c.stroke();
      continue;
    }
    const open = blink ? 0.15 : 1;
    c.fillStyle = "#fff";
    c.beginPath();
    c.ellipse(ex, y, er, er * 1.15 * open, 0, 0, TAU);
    c.fill();
    c.fillStyle = "#24163a";
    c.beginPath();
    c.ellipse(ex + er * 0.3, y + er * 0.1, er * 0.6, er * 0.7 * open, 0, 0, TAU);
    c.fill();
    if (!blink) {
      c.fillStyle = "#fff";
      c.beginPath();
      c.arc(ex + er * 0.12, y - er * 0.3, er * 0.25, 0, TAU);
      c.fill();
    }
  }
  c.fillStyle = "rgba(255,110,140,0.55)";
  c.beginPath();
  c.ellipse(x - S * 0.24, y + S * 0.12, S * 0.07, S * 0.04, 0, 0, TAU);
  c.ellipse(x + S * 0.26, y + S * 0.12, S * 0.07, S * 0.04, 0, 0, TAU);
  c.fill();
  c.strokeStyle = "#5a1d3a";
  c.lineWidth = Math.max(1.5, S * 0.035);
  c.lineCap = "round";
  c.beginPath();
  c.arc(x + S * 0.02, y + S * 0.08, S * 0.09, 0.25, Math.PI - 0.25);
  c.stroke();
}

function gloss(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  c.fillStyle = "rgba(255,255,255,0.35)";
  rr(c, x, y, w, h, h / 2);
  c.fill();
}

function glass(c: CanvasRenderingContext2D, y0: number, y1: number): CanvasGradient {
  const g = c.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, "#e6fbff");
  g.addColorStop(1, "#7cc8f0");
  return g;
}

function drawCar(c: CanvasRenderingContext2D, v: Vehicle, S: number, b: number): void {
  const L = SPEC.car.len * S;
  const wr = SPEC.car.wheel * S;
  c.save();
  c.translate(0, b);
  c.fillStyle = vgrad(c, -S, -S * 0.5, v.hue, 80, 66);
  rr(c, -L * 0.3, -S * 0.98, L * 0.55, S * 0.5, S * 0.2);
  c.fill();
  c.fillStyle = glass(c, -S * 0.9, -S * 0.56);
  rr(c, -L * 0.25, -S * 0.9, L * 0.45, S * 0.34, S * 0.14);
  c.fill();
  c.fillStyle = hsl(v.hue, 80, 62);
  c.fillRect(-L * 0.02, -S * 0.92, S * 0.06, S * 0.38);
  c.fillStyle = vgrad(c, -S * 0.62, -S * 0.2, v.hue);
  rr(c, -L / 2, -S * 0.62, L, S * 0.42, S * 0.18);
  c.fill();
  gloss(c, -L * 0.42, -S * 0.58, L * 0.6, S * 0.06);
  c.fillStyle = hsl(v.hue, 70, 38);
  for (const wx of [-L * 0.3, L * 0.3]) {
    c.beginPath();
    c.arc(wx, -wr, wr * 1.25, Math.PI, TAU);
    c.fill();
  }
  glow(c, L / 2 - S * 0.04, -S * 0.44, S * 0.2, "rgba(255,240,150,0.9)", 0.7);
  c.fillStyle = "#fff3a0";
  c.beginPath();
  c.arc(L / 2 - S * 0.06, -S * 0.44, S * 0.06, 0, TAU);
  c.fill();
  c.fillStyle = "#ff4d5e";
  c.fillRect(-L / 2, -S * 0.52, S * 0.06, S * 0.12);
  face(c, L * 0.17, -S * 0.42, S * 0.85, v.blink < 0, v.happy > 0);
  c.restore();
  const hub = v.hue + 180;
  wheel(c, -L * 0.3, -wr, wr, v.wheel, hub);
  wheel(c, L * 0.3, -wr, wr, v.wheel, hub);
}

function drawBus(c: CanvasRenderingContext2D, v: Vehicle, S: number, b: number): void {
  const L = SPEC.bus.len * S;
  const wr = SPEC.bus.wheel * S;
  c.save();
  c.translate(0, b);
  c.fillStyle = vgrad(c, -S * 1.2, -S * 0.2, v.hue, 95, 58);
  rr(c, -L / 2, -S * 1.2, L, S * 1.0, S * 0.2);
  c.fill();
  c.fillStyle = hsl(v.hue + 10, 95, 75);
  c.fillRect(-L / 2, -S * 1.2 + S * 0.04, L, S * 0.05);
  c.fillStyle = glass(c, -S * 1.08, -S * 0.72);
  for (let i = 0; i < 4; i++) {
    rr(c, -L * 0.46 + i * L * 0.165, -S * 1.08, L * 0.14, S * 0.34, S * 0.08);
    c.fill();
  }
  rr(c, L * 0.36, -S * 1.08, L * 0.12, S * 0.5, S * 0.08);
  c.fill();
  // Little passengers in the windows, one bobbing head each.
  for (let i = 0; i < 4; i++) {
    const px = -L * 0.39 + i * L * 0.165;
    c.fillStyle = hsl(CANDY[(i * 3 + Math.round(v.hue)) % CANDY.length], 70, 75);
    c.beginPath();
    c.arc(px, -S * 0.8 + Math.sin(v.age * 6 + i) * S * 0.02, S * 0.1, 0, TAU);
    c.fill();
    c.fillStyle = "#24163a";
    c.beginPath();
    c.arc(px - S * 0.03, -S * 0.82, S * 0.018, 0, TAU);
    c.arc(px + S * 0.04, -S * 0.82, S * 0.018, 0, TAU);
    c.fill();
  }
  c.fillStyle = "#ff5a6e";
  c.fillRect(-L / 2, -S * 0.66, L, S * 0.06);
  c.fillStyle = hsl(v.hue, 70, 40);
  for (const wx of [-L * 0.32, L * 0.32]) {
    c.beginPath();
    c.arc(wx, -wr, wr * 1.25, Math.PI, TAU);
    c.fill();
  }
  glow(c, L / 2 - S * 0.04, -S * 0.38, S * 0.22, "rgba(255,240,150,0.9)", 0.7);
  face(c, L * 0.18, -S * 0.42, S, v.blink < 0, v.happy > 0);
  c.restore();
  wheel(c, -L * 0.32, -wr, wr, v.wheel, 210);
  wheel(c, L * 0.32, -wr, wr, v.wheel, 210);
}

function drawFire(c: CanvasRenderingContext2D, v: Vehicle, S: number, b: number, t: number): void {
  const L = SPEC.fire.len * S;
  const wr = SPEC.fire.wheel * S;
  c.save();
  c.translate(0, b);
  c.fillStyle = vgrad(c, -S * 0.8, -S * 0.2, 2, 88, 55);
  rr(c, -L / 2, -S * 0.78, L * 0.66, S * 0.58, S * 0.12);
  c.fill();
  rr(c, L * 0.12, -S * 1.15, L * 0.38, S * 0.95, S * 0.2);
  c.fill();
  c.fillStyle = glass(c, -S * 1.05, -S * 0.72);
  rr(c, L * 0.2, -S * 1.05, L * 0.24, S * 0.32, S * 0.1);
  c.fill();
  c.fillStyle = "#ffffff";
  c.fillRect(-L / 2, -S * 0.42, L * 0.96, S * 0.06);
  // Ladder.
  c.strokeStyle = "#d9e1ee";
  c.lineWidth = Math.max(2, S * 0.04);
  c.beginPath();
  c.moveTo(-L * 0.48, -S * 0.86);
  c.lineTo(L * 0.1, -S * 0.86);
  c.moveTo(-L * 0.48, -S * 0.98);
  c.lineTo(L * 0.1, -S * 0.98);
  for (let x = -L * 0.46; x <= L * 0.1; x += S * 0.13) {
    c.moveTo(x, -S * 0.86);
    c.lineTo(x, -S * 0.98);
  }
  c.stroke();
  c.fillStyle = "#ffd54a";
  c.beginPath();
  c.arc(-L * 0.2, -S * 0.56, S * 0.15, 0, TAU);
  c.fill();
  c.fillStyle = "#b8860b";
  c.beginPath();
  c.arc(-L * 0.2, -S * 0.56, S * 0.06, 0, TAU);
  c.fill();
  // The siren light flips red/blue, glowing — the bit every toddler points at.
  const red = Math.floor(t * 6) % 2 === 0;
  const lightCol = red ? "#ff3b4e" : "#3b8bff";
  glow(c, L * 0.31, -S * 1.22, S * 0.45, red ? "rgba(255,60,80,0.8)" : "rgba(60,140,255,0.8)", 0.7);
  c.fillStyle = lightCol;
  rr(c, L * 0.24, -S * 1.28, L * 0.14, S * 0.14, S * 0.06);
  c.fill();
  c.fillStyle = hsl(2, 70, 35);
  for (const wx of [-L * 0.32, L * 0.3]) {
    c.beginPath();
    c.arc(wx, -wr, wr * 1.25, Math.PI, TAU);
    c.fill();
  }
  glow(c, L / 2 - S * 0.04, -S * 0.36, S * 0.2, "rgba(255,240,150,0.9)", 0.7);
  face(c, L * 0.32, -S * 0.5, S * 0.85, v.blink < 0, v.happy > 0);
  c.restore();
  wheel(c, -L * 0.32, -wr, wr, v.wheel, 45);
  wheel(c, L * 0.3, -wr, wr, v.wheel, 45);
}

function drawIceCream(c: CanvasRenderingContext2D, v: Vehicle, S: number, b: number): void {
  const L = SPEC.icecream.len * S;
  const wr = SPEC.icecream.wheel * S;
  c.save();
  c.translate(0, b);
  // The giant cone on the roof, which is the whole reason this van exists.
  const cx = -L * 0.08;
  c.fillStyle = "#e9b46a";
  c.beginPath();
  c.moveTo(cx, -S * 1.02);
  c.lineTo(cx - S * 0.2, -S * 1.45);
  c.lineTo(cx + S * 0.2, -S * 1.45);
  c.closePath();
  c.fill();
  c.strokeStyle = "rgba(150,90,30,0.5)";
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(cx - S * 0.12, -S * 1.45);
  c.lineTo(cx + S * 0.05, -S * 1.12);
  c.moveTo(cx + S * 0.12, -S * 1.45);
  c.lineTo(cx - S * 0.05, -S * 1.12);
  c.stroke();
  for (const [dy, r, hue] of [[-1.55, 0.21, 340], [-1.78, 0.17, 160]] as const) {
    const g = c.createRadialGradient(cx - S * r * 0.3, S * dy - S * r * 0.3, 1, cx, S * dy, S * r);
    g.addColorStop(0, hsl(hue, 90, 88));
    g.addColorStop(1, hsl(hue, 70, 66));
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx, S * dy, S * r, 0, TAU);
    c.fill();
  }
  c.fillStyle = "#ff3355";
  c.beginPath();
  c.arc(cx + S * 0.03, -S * 1.98, S * 0.06, 0, TAU);
  c.fill();

  c.fillStyle = vgrad(c, -S * 1.05, -S * 0.2, v.hue, 80, 78);
  rr(c, -L / 2, -S * 1.05, L, S * 0.85, S * 0.24);
  c.fill();
  c.fillStyle = "rgba(255,255,255,0.55)";
  for (const [px, py] of [[-0.42, -0.35], [-0.1, -0.3], [0.15, -0.38], [-0.28, -0.28]]) {
    c.beginPath();
    c.arc(px * L, py * S, S * 0.04, 0, TAU);
    c.fill();
  }
  c.fillStyle = "#fff6e0";
  rr(c, -L * 0.38, -S * 0.9, L * 0.48, S * 0.36, S * 0.06);
  c.fill();
  // Striped awning with a scalloped edge.
  const ax = -L * 0.4;
  const aw = L * 0.52;
  const n = 6;
  for (let i = 0; i < n; i++) {
    c.fillStyle = i % 2 ? "#ffffff" : hsl(v.hue + 180, 70, 62);
    c.fillRect(ax + (i * aw) / n, -S * 0.98, aw / n + 0.5, S * 0.12);
    c.beginPath();
    c.arc(ax + ((i + 0.5) * aw) / n, -S * 0.86, aw / n / 2, 0, Math.PI);
    c.fill();
  }
  c.fillStyle = glass(c, -S * 0.95, -S * 0.6);
  rr(c, L * 0.3, -S * 0.95, L * 0.16, S * 0.36, S * 0.1);
  c.fill();
  c.fillStyle = hsl(v.hue, 60, 55);
  for (const wx of [-L * 0.3, L * 0.3]) {
    c.beginPath();
    c.arc(wx, -wr, wr * 1.25, Math.PI, TAU);
    c.fill();
  }
  face(c, L * 0.24, -S * 0.4, S * 0.85, v.blink < 0, v.happy > 0);
  c.restore();
  wheel(c, -L * 0.3, -wr, wr, v.wheel, 300);
  wheel(c, L * 0.3, -wr, wr, v.wheel, 300);
}

function drawRocket(c: CanvasRenderingContext2D, v: Vehicle, S: number, b: number, t: number): void {
  const L = SPEC.rocket.len * S;
  const wr = SPEC.rocket.wheel * S;
  const power = clamp(Math.abs(v.vel) / Math.max(1, v.cruise), 0.4, 1.6);
  c.save();
  c.translate(0, b);
  // Flame: two flickering tongues, outer orange, inner yellow.
  const fl = S * (0.55 + 0.25 * Math.sin(t * 43) + 0.1 * Math.sin(t * 71)) * power;
  glow(c, -L / 2 - fl * 0.4, -S * 0.47, fl * 0.9, "rgba(255,170,60,0.8)", 0.8);
  c.fillStyle = "#ff8a3d";
  c.beginPath();
  c.moveTo(-L / 2 + 2, -S * 0.66);
  c.quadraticCurveTo(-L / 2 - fl * 0.6, -S * 0.62, -L / 2 - fl, -S * 0.47);
  c.quadraticCurveTo(-L / 2 - fl * 0.6, -S * 0.32, -L / 2 + 2, -S * 0.28);
  c.fill();
  c.fillStyle = "#fff06a";
  c.beginPath();
  c.moveTo(-L / 2 + 2, -S * 0.58);
  c.quadraticCurveTo(-L / 2 - fl * 0.35, -S * 0.55, -L / 2 - fl * 0.6, -S * 0.47);
  c.quadraticCurveTo(-L / 2 - fl * 0.35, -S * 0.39, -L / 2 + 2, -S * 0.36);
  c.fill();

  c.fillStyle = hsl(v.hue + 40, 85, 60);
  c.beginPath();
  c.moveTo(-L * 0.46, -S * 0.7);
  c.lineTo(-L * 0.52, -S * 1.12);
  c.lineTo(-L * 0.22, -S * 0.78);
  c.closePath();
  c.fill();
  c.fillStyle = vgrad(c, -S * 0.9, -S * 0.18, v.hue, 85, 62);
  c.beginPath();
  c.moveTo(-L / 2, -S * 0.22);
  c.lineTo(-L / 2, -S * 0.72);
  c.bezierCurveTo(-L * 0.1, -S * 0.95, L * 0.35, -S * 0.8, L / 2, -S * 0.42);
  c.bezierCurveTo(L * 0.35, -S * 0.2, 0, -S * 0.16, -L / 2, -S * 0.22);
  c.closePath();
  c.fill();
  c.fillStyle = "#ffffff";
  c.fillRect(-L * 0.45, -S * 0.5, L * 0.55, S * 0.05);
  c.fillStyle = glass(c, -S * 0.95, -S * 0.65);
  c.beginPath();
  c.ellipse(-L * 0.05, -S * 0.79, S * 0.22, S * 0.15, 0, Math.PI, TAU);
  c.fill();
  gloss(c, -L * 0.3, -S * 0.74, L * 0.4, S * 0.05);
  face(c, L * 0.2, -S * 0.52, S * 0.75, v.blink < 0, v.happy > 0);
  c.restore();
  wheel(c, -L * 0.28, -wr, wr, v.wheel, 55);
  wheel(c, L * 0.26, -wr, wr, v.wheel, 55);
}

function drawTrain(c: CanvasRenderingContext2D, v: Vehicle, S: number, b: number): void {
  const L = SPEC.train.len * S;
  const wr = SPEC.train.wheel * S;
  // Carriages first: they trail behind (negative x) and the engine overlaps them.
  for (let k = 0; k < 2; k++) {
    const cw = S * 1.45;
    const cx = -L / 2 - S * 0.12 - cw / 2 - k * (cw + S * 0.12);
    const cb = b * (k % 2 ? -0.7 : 0.8);
    c.strokeStyle = "#3a3a48";
    c.lineWidth = Math.max(2, S * 0.05);
    c.beginPath();
    c.moveTo(cx + cw / 2 - 2, -S * 0.35);
    c.lineTo(cx + cw / 2 + S * 0.14, -S * 0.35);
    c.stroke();
    c.save();
    c.translate(0, cb);
    const hue = v.hues[k];
    c.fillStyle = vgrad(c, -S * 1.15, -S * 0.25, hue, 80, 64);
    rr(c, cx - cw / 2, -S * 1.1, cw, S * 0.85, S * 0.14);
    c.fill();
    c.fillStyle = hsl(hue, 70, 42);
    rr(c, cx - cw / 2 - S * 0.04, -S * 1.18, cw + S * 0.08, S * 0.12, S * 0.06);
    c.fill();
    for (const ox of [-0.3, 0.3]) {
      c.fillStyle = glass(c, -S * 0.95, -S * 0.6);
      rr(c, cx + ox * cw - S * 0.2, -S * 0.98, S * 0.4, S * 0.36, S * 0.12);
      c.fill();
      c.fillStyle = hsl(CANDY[(k * 4 + (ox > 0 ? 2 : 5)) % CANDY.length], 70, 76);
      c.beginPath();
      c.arc(cx + ox * cw, -S * 0.72 + Math.sin(v.age * 5 + k + ox) * S * 0.02, S * 0.12, 0, TAU);
      c.fill();
      c.fillStyle = "#24163a";
      c.beginPath();
      c.arc(cx + ox * cw - S * 0.04, -S * 0.75, S * 0.02, 0, TAU);
      c.arc(cx + ox * cw + S * 0.04, -S * 0.75, S * 0.02, 0, TAU);
      c.fill();
    }
    c.restore();
    wheel(c, cx - cw * 0.3, -wr, wr, v.wheel, 45);
    wheel(c, cx + cw * 0.3, -wr, wr, v.wheel, 45);
  }

  c.save();
  c.translate(0, b);
  c.fillStyle = "#3a3a48";
  c.beginPath();
  c.moveTo(L / 2, -S * 0.36);
  c.lineTo(L / 2 + S * 0.22, -S * 0.08);
  c.lineTo(L / 2, -S * 0.08);
  c.closePath();
  c.fill();
  c.fillStyle = "#c03a3a";
  rr(c, -L / 2, -S * 0.42, L, S * 0.16, S * 0.05);
  c.fill();
  c.fillStyle = vgrad(c, -S * 0.95, -S * 0.33, v.hue, 80, 55);
  rr(c, -L * 0.12, -S * 0.95, L * 0.62, S * 0.6, S * 0.28);
  c.fill();
  c.fillStyle = "#ffd54a";
  for (const bx of [L * 0.05, L * 0.3]) c.fillRect(bx, -S * 0.95, S * 0.05, S * 0.6);
  c.fillStyle = "#ffd54a";
  c.beginPath();
  c.arc(L * 0.12, -S * 0.95, S * 0.12, Math.PI, TAU);
  c.fill();
  c.fillStyle = "#3a3a48";
  c.beginPath();
  c.moveTo(L * 0.3, -S * 0.92);
  c.lineTo(L * 0.27, -S * 1.32);
  c.lineTo(L * 0.45, -S * 1.32);
  c.lineTo(L * 0.42, -S * 0.92);
  c.closePath();
  c.fill();
  c.fillStyle = vgrad(c, -S * 1.3, -S * 0.3, v.hue + 160, 75, 58);
  rr(c, -L / 2, -S * 1.28, L * 0.4, S * 1.0, S * 0.1);
  c.fill();
  c.fillStyle = hsl(v.hue + 160, 60, 35);
  rr(c, -L / 2 - S * 0.06, -S * 1.38, L * 0.4 + S * 0.12, S * 0.13, S * 0.06);
  c.fill();
  c.fillStyle = glass(c, -S * 1.15, -S * 0.8);
  rr(c, -L * 0.44, -S * 1.15, L * 0.28, S * 0.34, S * 0.08);
  c.fill();
  gloss(c, -L * 0.08, -S * 0.9, L * 0.5, S * 0.06);
  face(c, L * 0.24, -S * 0.66, S * 0.85, v.blink < 0, v.happy > 0);
  c.restore();
  const xs = [-L * 0.32, -L * 0.02, L * 0.28];
  for (const x of xs) wheel(c, x, -wr, wr, v.wheel, 2);
  // The connecting rod, cranking round with the wheels.
  const ox = Math.cos(v.wheel) * wr * 0.5;
  const oy = Math.sin(v.wheel) * wr * 0.5;
  c.strokeStyle = "#cfd6e4";
  c.lineWidth = Math.max(2, S * 0.05);
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(xs[0] + ox, -wr + oy);
  c.lineTo(xs[2] + ox, -wr + oy);
  c.stroke();
}

// --- the game --------------------------------------------------------------------

function createZoom(env: GameEnv): CanvasGame {
  const reduced = env.reduced;
  let W = 0;
  let H = 0;
  let L: Layout = { horizon: 0, roadTop: 0, roadBot: 0, laneH: 0, lanes: [0, 0, 0], S: 60 };
  let scene: HTMLCanvasElement | null = null;
  const cloudImg = makeCloud();
  let clouds: Array<{ x: number; y: number; s: number; speed: number }> = [];
  const birds = Array.from({ length: 3 }, (_, i) => ({ x: rand(0, 1), y: rand(0.08, 0.26), phase: rand(0, TAU), speed: rand(0.025, 0.045), s: rand(0.7, 1.1), i }));
  let vehicles: Vehicle[] = [];
  let puffs: Puff[] = [];
  const fx = new Particles(240);
  const drags = new Map<number, { v: Vehicle; sx: number; sy: number; lx: number; lt: number; fv: number; following: boolean }>();
  let sunGiggle = 0;
  let sunSpin = 0;
  let lastKind: VKind = "car";

  const sun = () => {
    const r = clamp(Math.min(W, H) * 0.075, 36, 78);
    return { x: W - Math.max(CORNER + r + 40, W * 0.2), y: Math.max(CORNER * 0.5 + r * 0.5, H * 0.13), r };
  };

  const layout = (w: number, h: number) => {
    W = w;
    H = h;
    const portrait = h > w;
    const horizon = h * (portrait ? 0.46 : 0.42);
    const roadTop = h * (portrait ? 0.53 : 0.5);
    const roadBot = h * (portrait ? 0.93 : 0.95);
    const laneH = (roadBot - roadTop) / 3;
    const lanes = [0, 1, 2].map((i) => roadTop + laneH * (i + 0.82));
    const S = clamp(Math.min(laneH * 1.05, w * 0.2), 40, 140);
    L = { horizon, roadTop, roadBot, laneH, lanes, S };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    scene = paint(w, h, dpr, (c) => paintScene(c, w, h, L));
    const n = clamp(Math.round(w / 260), 3, 6);
    clouds = Array.from({ length: n }, (_, i) => ({
      x: ((i + rand(0, 0.8)) / n) * (w + 240) - 120,
      y: rand(0.05, 0.28) * horizon + 10,
      s: rand(0.5, 0.9) * clamp(w / 900, 0.6, 1.2),
      speed: rand(6, 16) * (reduced ? 0.3 : 1),
    }));
    for (const v of vehicles) v.y = L.lanes[v.lane];
  };

  const puff = (x: number, y: number, r: number, vx: number, vy: number, life: number, color: string, grow = 1.2) => {
    puffs.push({ x, y, r, grow, vx, vy, life, max: life, color });
    if (puffs.length > MAX_PUFFS) puffs.splice(0, puffs.length - MAX_PUFFS);
  };

  const spawn = (lane: number, tapX: number): Vehicle => {
    let kind: VKind;
    if (lane === 0) kind = "train";
    else {
      const pool: VKind[] = ["car", "car", "bus", "fire", "icecream", "rocket"];
      do kind = pick(pool);
      while (kind === lastKind && Math.random() < 0.8);
    }
    lastKind = kind;
    const sp = SPEC[kind];
    const dir: 1 | -1 = tapX < W / 2 ? 1 : -1;
    const half = (sp.len / 2) * L.S;
    const cruise = Math.max(160, sp.speed * W) * (reduced ? 0.75 : 1);
    const v: Vehicle = {
      kind,
      lane,
      y: L.lanes[lane],
      // Enter from the edge nearest the finger, nose just on screen, so the
      // answer to the tap is visible on the very next frame.
      x: dir > 0 ? -half * 0.6 : W + half * 0.6,
      dir,
      vel: dir * cruise * 1.8,
      cruise,
      hue: kind === "bus" ? 45 : kind === "fire" ? 2 : kind === "icecream" ? pick([330, 165, 280]) : kind === "rocket" ? pick([200, 270, 300]) : pick(CANDY),
      hues: [pick(CANDY), pick(CANDY)],
      pitch: pick([392, 440, 494, 523.25]),
      bob: 0,
      bobV: 0,
      hopY: 0,
      hopV: 0,
      flip: 0,
      flipping: false,
      wheel: 0,
      stretch: 0.32,
      stretchV: 0,
      follow: null,
      target: 0,
      blink: rand(1, 3),
      happy: 0,
      sfx: 0,
      sfxCount: 0,
      dust: 0,
      age: 0,
    };
    vehicles.push(v);
    if (vehicles.length > MAX_VEHICLES) {
      const idx = vehicles.findIndex((o) => o.follow === null && o !== v);
      if (idx >= 0) vehicles.splice(idx, 1);
    }
    horn(kind, v.pitch);
    return v;
  };

  const hop = (v: Vehicle) => {
    if (v.hopY < 0) {
      // Already airborne: a second tap just adds a little more lift.
      v.hopV -= L.S * 2;
    } else {
      v.hopV = -L.S * 7;
      v.flipping = v.kind !== "train" && Math.random() < 0.5;
      v.flip = 0;
    }
    v.happy = 1.2;
    v.stretch = -0.2;
    boing();
    horn(v.kind, v.pitch, true);
    fx.burst(v.x, v.y - L.S * 0.6, { count: 12, shapes: ["star", "dot"], speed: [120, 300], gravity: 300, life: [0.5, 0.9], size: [4, 8] });
  };

  const hitVehicle = (x: number, y: number): Vehicle | null => {
    // Front lanes first: the vehicle drawn on top is the one the finger meant.
    const order = [...vehicles].sort((a, b) => b.y - a.y);
    const pad = 18;
    for (const v of order) {
      const sp = SPEC[v.kind];
      const front = v.x + v.dir * (sp.len / 2) * L.S;
      const rear = v.x - v.dir * (sp.len / 2 + sp.tail) * L.S;
      const gy = v.y + v.hopY;
      if (x > Math.min(front, rear) - pad && x < Math.max(front, rear) + pad && y > gy - sp.tall * L.S - pad && y < gy + pad) return v;
    }
    return null;
  };

  const nearestLane = (y: number, road = false): number => {
    let best = road ? 1 : 0;
    let bd = Infinity;
    for (let i = road ? 1 : 0; i < 3; i++) {
      const d = Math.abs(L.lanes[i] - L.S * 0.4 - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };

  const update = (dt: number) => {
    for (const v of vehicles) {
      v.age += dt;
      v.blink -= dt;
      if (v.blink < -0.12) v.blink = rand(1.5, 4);
      v.happy = Math.max(0, v.happy - dt);
      if (v.follow !== null) {
        let nv: number;
        [v.x, nv] = spring(v.x, v.vel, v.target, dt, 70, 14);
        v.vel = nv;
        if (Math.abs(v.vel) > 60) {
          const d: 1 | -1 = v.vel > 0 ? 1 : -1;
          if (d !== v.dir) {
            v.dir = d;
            v.stretch = -0.25;
          }
        }
      } else {
        const want = v.dir * v.cruise;
        v.vel += (want - v.vel) * Math.min(1, dt * 1.4);
        v.x += v.vel * dt;
      }
      v.y += (L.lanes[v.lane] - v.y) * Math.min(1, dt * 10);
      v.wheel += (v.vel * dt) / (SPEC[v.kind].wheel * L.S);
      [v.stretch, v.stretchV] = spring(v.stretch, v.stretchV, 0, dt, 170, 9);
      // Suspension: a spring kicked by little road bumps, more at speed.
      [v.bob, v.bobV] = spring(v.bob, v.bobV, 0, dt, 150, 7);
      if (Math.random() < dt * (2 + Math.abs(v.vel) / 120)) v.bobV += rand(-1, 1) * L.S * 0.9;
      if (v.hopY < 0 || v.hopV < 0) {
        v.hopV += L.S * 30 * dt;
        v.hopY += v.hopV * dt;
        if (v.flipping) v.flip += dt * 13.5;
        if (v.hopY >= 0) {
          v.hopY = 0;
          v.hopV = 0;
          v.flip = 0;
          v.flipping = false;
          v.stretch = -0.28;
          for (let i = 0; i < 5; i++) puff(v.x + rand(-1, 1) * L.S * 0.6, v.y - 4, L.S * 0.08, rand(-60, 60), rand(-40, -10), 0.6, "rgba(240,225,200,0.9)");
        }
      }
      const sp = SPEC[v.kind];
      const rearX = v.x - v.dir * (sp.len / 2) * L.S;
      const onScreen = v.x > -L.S && v.x < W + L.S;
      if (v.kind === "train") {
        v.sfx -= dt;
        if (v.sfx <= 0 && onScreen) {
          v.sfx = clamp(0.26 * (v.cruise / Math.max(60, Math.abs(v.vel))), 0.12, 0.5);
          v.sfxCount++;
          chug(v.sfxCount % 2 === 0);
          const chimney = v.x + v.dir * sp.len * L.S * 0.18;
          puff(chimney, v.y - L.S * 1.35, L.S * 0.12, -v.dir * rand(10, 30), rand(-70, -40), reduced ? 0.9 : 1.2, "rgba(255,255,255,0.85)", 1.1);
        }
      } else if (Math.abs(v.vel) > 60 && v.hopY >= 0) {
        v.dust -= dt;
        if (v.dust <= 0) {
          v.dust = 0.07;
          puff(rearX, v.y - 3, L.S * rand(0.05, 0.09), -v.dir * rand(20, 60), rand(-30, -5), 0.55, "rgba(236,220,190,0.85)");
        }
      }
      if (v.kind === "rocket" && onScreen && Math.random() < dt * 25) {
        fx.burst(rearX - v.dir * L.S * 0.3, v.y + v.hopY - L.S * 0.47 + v.bob, {
          count: 1,
          shapes: ["star", "dot"],
          hues: [20, 42, 52],
          speed: [40, 120],
          gravity: 60,
          life: [0.3, 0.6],
          size: [3, 6],
        });
      }
    }
    vehicles = vehicles.filter((v) => {
      if (v.follow !== null) return true;
      const sp = SPEC[v.kind];
      const reach = (sp.len / 2 + sp.tail) * L.S + 60;
      return v.dir > 0 ? v.x - reach < W : v.x + reach > 0;
    });
    for (const p of puffs) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.grow * dt * L.S * 0.2;
    }
    puffs = puffs.filter((p) => p.life > 0);
    for (const c of clouds) {
      c.x += c.speed * dt;
      if (c.x > W + 140) c.x = -240 * c.s - 20;
    }
    for (const b of birds) {
      b.x += b.speed * dt * (reduced ? 0.4 : 1);
      if (b.x > 1.1) b.x = -0.1;
    }
    sunGiggle = Math.max(0, sunGiggle - dt);
    sunSpin += dt * (reduced ? 0 : 0.15 + sunGiggle * 4);
    fx.update(dt);
  };

  const drawSun = (ctx: CanvasRenderingContext2D, t: number) => {
    const { x, y, r } = sun();
    glow(ctx, x, y, r * 2.6, "rgba(255,240,150,0.75)", 0.8);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(sunSpin);
    ctx.fillStyle = "#ffc93c";
    for (let i = 0; i < 12; i++) {
      ctx.rotate(TAU / 12);
      ctx.beginPath();
      ctx.moveTo(-r * 0.18, -r * 1.05);
      ctx.lineTo(0, -r * (1.45 + (i % 2) * 0.15 + sunGiggle * 0.2));
      ctx.lineTo(r * 0.18, -r * 1.05);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    const sq = 1 + Math.sin(t * 20) * 0.04 * Math.min(1, sunGiggle);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sq, 2 - sq);
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
    g.addColorStop(0, "#fff7b0");
    g.addColorStop(1, "#ffbf2e");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    const happy = sunGiggle > 0;
    const blink = !happy && t % 4 < 0.12;
    for (const ex of [-r * 0.32, r * 0.32]) {
      if (happy || blink) {
        ctx.strokeStyle = "#7a3b10";
        ctx.lineWidth = r * 0.08;
        ctx.lineCap = "round";
        ctx.beginPath();
        if (happy) ctx.arc(ex, -r * 0.05, r * 0.12, Math.PI * 1.1, Math.PI * 1.9);
        else {
          ctx.moveTo(ex - r * 0.1, -r * 0.12);
          ctx.lineTo(ex + r * 0.1, -r * 0.12);
        }
        ctx.stroke();
      } else {
        ctx.fillStyle = "#4a2a10";
        ctx.beginPath();
        ctx.ellipse(ex, -r * 0.12, r * 0.09, r * 0.13, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(ex + r * 0.03, -r * 0.17, r * 0.035, 0, TAU);
        ctx.fill();
      }
    }
    ctx.fillStyle = "rgba(255,120,90,0.5)";
    ctx.beginPath();
    ctx.ellipse(-r * 0.55, r * 0.18, r * 0.14, r * 0.08, 0, 0, TAU);
    ctx.ellipse(r * 0.55, r * 0.18, r * 0.14, r * 0.08, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#7a3b10";
    ctx.beginPath();
    if (happy) {
      ctx.arc(0, r * 0.18, r * 0.24, 0, Math.PI);
      ctx.fill();
    } else {
      ctx.strokeStyle = "#7a3b10";
      ctx.lineWidth = r * 0.07;
      ctx.arc(0, r * 0.12, r * 0.24, 0.3, Math.PI - 0.3);
      ctx.stroke();
    }
    ctx.restore();
  };

  const drawVehicle = (ctx: CanvasRenderingContext2D, v: Vehicle, t: number) => {
    const S = L.S;
    const sp = SPEC[v.kind];
    // Ground shadow shrinks as the vehicle leaves the ground.
    const lift = clamp(-v.hopY / (S * 1.5), 0, 1);
    ctx.fillStyle = `rgba(30,40,30,${0.22 * (1 - lift * 0.6)})`;
    ctx.beginPath();
    const shX = v.x - v.dir * sp.tail * S * 0.5;
    ctx.ellipse(shX, v.y + 2, (sp.len / 2 + sp.tail / 2) * S * (1 - lift * 0.3), S * 0.08, 0, 0, TAU);
    ctx.fill();

    // Speed lines while zooming in or flung.
    const fast = Math.abs(v.vel) > v.cruise * 1.15;
    if (fast) {
      const rear = v.x - v.dir * (sp.len / 2 + sp.tail) * S;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(2, S * 0.05);
      for (let i = 0; i < 3; i++) {
        const y = v.y + v.hopY - S * (0.3 + i * 0.28);
        const len = S * (0.5 + ((i * 37 + Math.floor(t * 20)) % 5) * 0.12);
        const gap = S * 0.15 + i * S * 0.08;
        ctx.beginPath();
        ctx.moveTo(rear - v.dir * gap, y);
        ctx.lineTo(rear - v.dir * (gap + len), y);
        ctx.stroke();
      }
    }

    ctx.save();
    ctx.translate(v.x, v.y + v.hopY);
    if (v.flip) {
      ctx.translate(0, -S * 0.55);
      ctx.rotate(-v.flip * v.dir);
      ctx.translate(0, S * 0.55);
    } else {
      ctx.rotate(clamp(v.bobV / (S * 40), -0.05, 0.05) * v.dir);
    }
    ctx.scale(v.dir, 1);
    ctx.scale(1 + v.stretch, 1 - v.stretch * 0.6);
    const b = v.bob * 0.12;
    switch (v.kind) {
      case "car":
        drawCar(ctx, v, S, b);
        break;
      case "bus":
        drawBus(ctx, v, S, b);
        break;
      case "fire":
        drawFire(ctx, v, S, b, t);
        break;
      case "icecream":
        drawIceCream(ctx, v, S, b);
        break;
      case "rocket":
        drawRocket(ctx, v, S, b, t);
        break;
      case "train":
        drawTrain(ctx, v, S, b);
        break;
    }
    ctx.restore();
  };

  return {
    resize: layout,

    frame(ctx, dt, t, w, h) {
      if (w !== W || h !== H || !scene) layout(w, h);
      if (!scene) return;
      update(dt);

      ctx.drawImage(scene, 0, 0, w, h);
      drawSun(ctx, t);
      for (const c of clouds) {
        const bob = reduced ? 0 : Math.sin(t * 0.5 + c.x * 0.01) * 3;
        ctx.drawImage(cloudImg, c.x, c.y + bob, 240 * c.s, 120 * c.s);
      }
      ctx.strokeStyle = "#3b3550";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      for (const b of birds) {
        const x = b.x * w;
        const y = b.y * L.horizon + Math.sin(t * 1.3 + b.phase) * 6;
        const s = 10 * b.s * clamp(w / 700, 0.8, 1.5);
        const flap = Math.sin(t * (reduced ? 4 : 8) + b.phase) * s * 0.5;
        ctx.beginPath();
        ctx.moveTo(x - s, y - flap);
        ctx.quadraticCurveTo(x - s * 0.5, y - s * 0.4 - flap * 0.3, x, y);
        ctx.quadraticCurveTo(x + s * 0.5, y - s * 0.4 - flap * 0.3, x + s, y - flap);
        ctx.stroke();
      }

      // Smoke and dust live behind the vehicles; lanes draw back to front.
      for (const p of puffs) {
        const k = p.life / p.max;
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      const order = [...vehicles].sort((a, b) => a.y - b.y);
      for (const v of order) drawVehicle(ctx, v, t);
      fx.draw(ctx);
    },

    down(p: GamePointer) {
      // The finger always gets its own instant sparkle, wherever it lands.
      fx.burst(p.x, p.y, { count: 7, shapes: ["star"], speed: [60, 180], gravity: 120, life: [0.35, 0.6], size: [4, 8] });
      const s = sun();
      if (Math.hypot(p.x - s.x, p.y - s.y) < s.r * 1.5) {
        sunGiggle = 1.4;
        [7, 9, 8, 10, 12].forEach((n, i) => note(n, { type: "sine", duration: 0.35, gain: 0.1, delay: i * 0.07, reverb: 0.4 }));
        fx.burst(s.x, s.y, { count: 16, shapes: ["star"], hues: [42, 52, 18], speed: [120, 320], gravity: 200, life: [0.6, 1.1] });
        return;
      }
      let v = hitVehicle(p.x, p.y);
      if (v) hop(v);
      else {
        // Above the road (sky, hills) any lane will do; on the road, the nearest.
        let lane = p.y < L.roadTop - L.laneH * 0.3 ? Math.floor(rand(0, 3)) : nearestLane(p.y);
        // One train on the line at a time: two nose-to-tail on one rail reads as a crash.
        if (lane === 0 && vehicles.some((o) => o.kind === "train")) lane = nearestLane(p.y, true);
        v = spawn(lane, p.x);
      }
      drags.set(p.id, { v, sx: p.x, sy: p.y, lx: p.x, lt: performance.now() / 1000, fv: 0, following: false });
    },

    move(p: GamePointer) {
      const d = drags.get(p.id);
      if (!d || !vehicles.includes(d.v)) return;
      const nowS = performance.now() / 1000;
      const dtp = nowS - d.lt;
      if (dtp > 0.008) {
        d.fv = d.fv * 0.5 + ((p.x - d.lx) / dtp) * 0.5;
        d.lx = p.x;
        d.lt = nowS;
      }
      if (!d.following && (Math.abs(p.x - d.sx) > 24 || Math.abs(p.y - d.sy) > 30)) {
        d.following = true;
        d.v.follow = p.id;
      }
      if (d.following) {
        d.v.target = p.x;
        // Cars can be steered between the two road lanes; the train keeps to its rails.
        if (d.v.kind !== "train") {
          const lane = nearestLane(p.y, true);
          if (lane !== d.v.lane) {
            d.v.lane = lane;
            sweep({ pitch: [[0, 500], [0.08, 700]], dur: 0.1, gain: 0.06 });
          }
        }
      }
    },

    up(p: GamePointer) {
      const d = drags.get(p.id);
      drags.delete(p.id);
      if (!d || !d.following) return;
      const v = d.v;
      v.follow = null;
      // Let go = fling. The release speed carries, so a flick sends it flying.
      const dir: 1 | -1 = Math.abs(d.fv) > 40 ? (d.fv > 0 ? 1 : -1) : v.dir;
      v.dir = dir;
      v.vel = dir * clamp(Math.abs(d.fv), v.cruise, v.cruise * 2.6);
      v.stretch = 0.3;
      horn(v.kind, v.pitch, true);
    },
  };
}
