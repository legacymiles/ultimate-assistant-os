"use client";

// ---------------------------------------------------------------------------
// Aquarium — a fish tank that answers every touch.
//
// A baby cannot aim at a fish, so the water itself is the button: a tap
// anywhere drops a ring and a pinch of food, and every fish in the tank turns
// and swims to it. That turns the least precise touch into the most
// satisfying thing on the screen — the whole tank comes to *you*. Hitting a
// fish by luck is a bonus (it darts off, the puffer blows up, the turtle does
// a somersault), never a requirement.
//
// Depth is faked the cheap way, with layers: the water, the far dunes, the
// near sand and the front seaweed are each painted once to their own
// offscreen canvas on resize, then slid by different amounts as the "camera"
// drifts. Four drawImage calls a frame buy a scene that looks deep. Only the
// things that move — light rays, weed, fish, bubbles — are drawn live.
//
// All state lives in the factory closure. Nothing here touches React.
// ---------------------------------------------------------------------------

import { GameCanvas, type CanvasGame, type GameEnv, type GamePointer } from "./GameCanvas";
import { audio, note } from "@/lib/baby-no-scroll/audio";
import { CANDY, Particles, TAU, clamp, glow, hsl, pick, rand, spring, star } from "@/lib/baby-no-scroll/fx";

export function Aquarium() {
  return <GameCanvas create={createAquarium} />;
}

// --- tuning ------------------------------------------------------------------

/** Each screen corner holds the parent's lock; nothing a baby needs lives there. */
const CORNER = 120;
const MAX_BUBBLES = 160;
const MAX_FLAKES = 48;
const MAX_RIPPLES = 10;
/** How far the background layers can slide, so their edges never show. */
const PAD = 48;

// --- sound -------------------------------------------------------------------
// Small local synth helpers. The shared kit has tone() and noise(); these add
// pitch glides and filter sweeps, which is what makes a sound read as a
// "bloop" or a "whoosh" rather than a beep.

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
  const { type = "sine", pitch, dur, gain = 0.2, attack = 0.01, delay = 0, reverb = 0.25, filter, vibrato } = o;
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

/** Noise through a moving filter: splashes and fizz. */
function hiss(o: { dur: number; from: number; to: number; gain?: number; type?: BiquadFilterType; q?: number; delay?: number; reverb?: number }): void {
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
  if (o.reverb) {
    const send = c.createGain();
    send.gain.value = o.reverb;
    env.connect(send).connect(a.room);
  }
  src.start(t, Math.random() * Math.max(0, 1.9 - o.dur));
  src.stop(t + o.dur + 0.05);
}

/** The signature sound of the tank: a pitch that bubbles upward. */
function bloop(pitch = 1, gain = 0.2): void {
  sweep({ pitch: [[0, 240 * pitch], [0.09, 720 * pitch]], dur: 0.13, gain, reverb: 0.35 });
}

interface Hum {
  stop(): void;
}

/**
 * The room tone of being underwater: brown noise, low-passed, with the filter
 * breathing very slowly, plus a soft low drone. It is deliberately almost
 * inaudible — it exists so the silence between bloops feels like water rather
 * than a dead speaker.
 */
function startHum(): Hum | null {
  const a = audio();
  if (!a) return null;
  const c = a.ctx;
  const t = c.currentTime;
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(0.06, t + 4);
  out.connect(a.out);

  const len = Math.floor(c.sampleRate * 4);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  const fade = Math.floor(c.sampleRate * 0.25);
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    // Fade the loop's ends so the seam is a breath, not a click.
    const edge = Math.min(1, i / fade, (len - 1 - i) / fade);
    d[i] = last * 3.5 * (0.6 + 0.4 * edge);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 320;
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoDepth = c.createGain();
  lfoDepth.gain.value = 130;
  lfo.connect(lfoDepth).connect(lp.frequency);
  src.connect(lp).connect(out);

  const drone = c.createOscillator();
  drone.type = "sine";
  drone.frequency.value = 65.41;
  const droneGain = c.createGain();
  droneGain.gain.value = 0.22;
  drone.connect(droneGain).connect(out);

  src.start(t);
  lfo.start(t);
  drone.start(t);
  return {
    stop() {
      const n = c.currentTime;
      out.gain.cancelScheduledValues(n);
      out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), n);
      out.gain.exponentialRampToValueAtTime(0.0001, n + 0.5);
      src.stop(n + 0.6);
      lfo.stop(n + 0.6);
      drone.stop(n + 0.6);
    },
  };
}

// --- world types -------------------------------------------------------------

type Kind = "fish" | "puffer" | "jelly" | "turtle";

interface Fish {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Body half-length in px. */
  size: number;
  hue: number;
  hue2: number;
  /** 0 plain, 1 stripes, 2 spots. */
  pattern: 0 | 1 | 2;
  /** -1..1 smoothed facing; passing through 0 is what reads as "turning round". */
  face: number;
  tail: number;
  cruise: number;
  gx: number;
  gy: number;
  goalT: number;
  flee: number;
  happy: number;
  puff: number;
  puffV: number;
  puffHold: number;
  pulse: number;
  boost: number;
  spin: number;
  blink: number;
  munch: number;
  seed: number;
}

interface Bubble {
  x: number;
  y: number;
  r: number;
  vy: number;
  phase: number;
  life: number;
}

interface Flake {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  hue: number;
  life: number;
  phase: number;
  eaten: boolean;
}

interface Ripple {
  x: number;
  y: number;
  age: number;
}

interface Weed {
  x: number;
  base: number;
  len: number;
  width: number;
  hue: number;
  phase: number;
  kick: number;
}

interface Caustic {
  x: number;
  y: number;
  r: number;
  speed: number;
  phase: number;
}

// --- offscreen painting ------------------------------------------------------

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

function paintWater(c: CanvasRenderingContext2D, w: number, h: number, sandTop: number): void {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#8ff0f7");
  g.addColorStop(0.1, "#3fcbe9");
  g.addColorStop(0.45, "#1a8bd2");
  g.addColorStop(0.8, "#105ca8");
  g.addColorStop(1, "#0a3f82");
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  // The sun sitting just above the surface, bleeding light down into the water.
  const sun = c.createRadialGradient(w * 0.35, -h * 0.1, 0, w * 0.35, -h * 0.1, h * 0.75);
  sun.addColorStop(0, "rgba(255,255,225,0.5)");
  sun.addColorStop(1, "rgba(255,255,225,0)");
  c.fillStyle = sun;
  c.fillRect(0, 0, w, h);
  // Far rocks lost in the haze: no detail, just the idea that the sea goes on.
  c.fillStyle = "rgba(12,70,135,0.45)";
  for (let i = 0; i < 6; i++) {
    const x = ((i + 0.5) / 6) * w + rand(-40, 40);
    c.beginPath();
    c.ellipse(x, sandTop - h * 0.04, rand(50, 130), rand(50, 150), 0, Math.PI, TAU);
    c.fill();
  }
  // Edge darkening is what tells the eye "this is a volume of water".
  const v = c.createRadialGradient(w / 2, h * 0.42, Math.min(w, h) * 0.3, w / 2, h * 0.42, Math.max(w, h) * 0.85);
  v.addColorStop(0, "rgba(0,25,70,0)");
  v.addColorStop(1, "rgba(0,25,70,0.45)");
  c.fillStyle = v;
  c.fillRect(0, 0, w, h);
  c.fillStyle = "rgba(255,255,255,0.16)";
  c.fillRect(0, 0, w, h * 0.03);
}

function duneLine(x: number, base: number, h: number, a: number, b: number): number {
  return base + Math.sin(x * a) * h * 0.022 + Math.sin(x * b + 1.7) * h * 0.012;
}

function paintFarSand(c: CanvasRenderingContext2D, w: number, h: number, sandTop: number): void {
  const top = sandTop - h * 0.06;
  c.beginPath();
  c.moveTo(0, h);
  for (let x = 0; x <= w + 20; x += 20) c.lineTo(x, duneLine(x, top, h, 0.006, 0.017));
  c.lineTo(w, h);
  c.closePath();
  const g = c.createLinearGradient(0, top - h * 0.03, 0, sandTop + h * 0.05);
  g.addColorStop(0, "#5aa6c9");
  g.addColorStop(1, "#3a82ad");
  c.fillStyle = g;
  c.fill();
  // Coral silhouettes on the far dune, blue with distance.
  c.strokeStyle = "rgba(90,150,200,0.9)";
  c.lineCap = "round";
  for (let i = 0; i < 5; i++) {
    const x = rand(0.05, 0.95) * w;
    branch(c, x, duneLine(x, top, h, 0.006, 0.017) + 4, -Math.PI / 2, h * rand(0.04, 0.07), 3, h * 0.012);
  }
}

/** A coral branch that splits as it grows. Seeded by Math.random, painted once. */
function branch(c: CanvasRenderingContext2D, x: number, y: number, a: number, len: number, depth: number, width: number): void {
  const x2 = x + Math.cos(a) * len;
  const y2 = y + Math.sin(a) * len;
  c.lineWidth = width;
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x2, y2);
  c.stroke();
  if (depth <= 0) {
    c.beginPath();
    c.arc(x2, y2, width * 0.6, 0, TAU);
    c.fillStyle = c.strokeStyle;
    c.fill();
    return;
  }
  branch(c, x2, y2, a - rand(0.3, 0.6), len * 0.72, depth - 1, width * 0.8);
  branch(c, x2, y2, a + rand(0.3, 0.6), len * 0.72, depth - 1, width * 0.8);
}

function paintNearSand(c: CanvasRenderingContext2D, w: number, h: number, sandTop: number): void {
  c.beginPath();
  c.moveTo(0, h);
  for (let x = 0; x <= w + 20; x += 16) c.lineTo(x, duneLine(x, sandTop, h, 0.008, 0.021));
  c.lineTo(w, h);
  c.closePath();
  const g = c.createLinearGradient(0, sandTop - h * 0.03, 0, h);
  g.addColorStop(0, "#ffe6b0");
  g.addColorStop(0.4, "#f3c77f");
  g.addColorStop(1, "#d39a58");
  c.fillStyle = g;
  c.fill();
  // Rim light where the sand meets the water.
  c.beginPath();
  for (let x = 0; x <= w + 20; x += 16) {
    const y = duneLine(x, sandTop, h, 0.008, 0.021);
    if (x === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.strokeStyle = "rgba(255,255,255,0.45)";
  c.lineWidth = 3;
  c.stroke();

  const floor = (x: number) => duneLine(x, sandTop, h, 0.008, 0.021);
  // Pebbles: tiny, many, and the difference between "sand" and "beige".
  for (let i = 0; i < w / 5; i++) {
    const x = Math.random() * w;
    const y = floor(x) + 6 + Math.random() * (h - floor(x) - 6);
    c.fillStyle = hsl(pick([30, 20, 40, 200, 340]), 40, rand(55, 78), 0.55);
    c.beginPath();
    c.ellipse(x, y, rand(1.5, 4), rand(1, 2.5), 0, 0, TAU);
    c.fill();
  }
  const unit = Math.min(w, h);
  // Rocks, half sunk.
  for (let i = 0; i < 3; i++) {
    const x = rand(0.1, 0.9) * w;
    const r = unit * rand(0.05, 0.08);
    const y = floor(x) + r * 0.45;
    const rg = c.createRadialGradient(x - r * 0.4, y - r * 0.5, r * 0.1, x, y, r * 1.1);
    rg.addColorStop(0, "#b7a9d6");
    rg.addColorStop(1, "#5f4f8c");
    c.fillStyle = rg;
    c.beginPath();
    c.ellipse(x, y, r * 1.3, r, 0, Math.PI, TAU);
    c.closePath();
    c.fill();
  }
  // Coral clumps in candy pinks and oranges.
  c.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    const x = rand(0.08, 0.92) * w;
    c.strokeStyle = hsl(pick([345, 15, 300, 28]), 85, 66);
    branch(c, x, floor(x) + 6, -Math.PI / 2 + rand(-0.2, 0.2), unit * rand(0.05, 0.08), 3, unit * 0.022);
  }
  // Starfish and shells — the treasure on the sea floor.
  for (let i = 0; i < 3; i++) {
    const x = rand(0.1, 0.9) * w;
    const y = floor(x) + rand(0.2, 0.7) * (h - floor(x));
    const s = unit * rand(0.025, 0.04);
    c.save();
    c.translate(x, y);
    c.rotate(rand(-0.5, 0.5));
    c.fillStyle = hsl(pick([18, 350, 40]), 90, 62);
    star(c, 0, 0, s, s * 0.45, 5);
    c.fill();
    c.fillStyle = "rgba(255,255,255,0.6)";
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU - Math.PI / 2;
      c.beginPath();
      c.arc(Math.cos(a) * s * 0.5, Math.sin(a) * s * 0.5, s * 0.07, 0, TAU);
      c.fill();
    }
    c.restore();
  }
  for (let i = 0; i < 3; i++) {
    const x = rand(0.1, 0.9) * w;
    const y = floor(x) + rand(0.2, 0.7) * (h - floor(x));
    const s = unit * rand(0.022, 0.034);
    c.fillStyle = hsl(pick([340, 20, 280]), 70, 82);
    c.beginPath();
    c.moveTo(x, y);
    c.arc(x, y, s, Math.PI * 1.1, Math.PI * 1.9);
    c.closePath();
    c.fill();
    c.strokeStyle = "rgba(160,80,110,0.45)";
    c.lineWidth = 1.2;
    for (let k = 1; k < 5; k++) {
      const a = Math.PI * (1.1 + (k / 5) * 0.8);
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s);
      c.stroke();
    }
  }
}

function makeBubbleSprite(): HTMLCanvasElement {
  return paint(64, 64, 1, (c) => {
    const g = c.createRadialGradient(26, 24, 2, 32, 32, 30);
    g.addColorStop(0, "rgba(255,255,255,0.05)");
    g.addColorStop(0.75, "rgba(200,245,255,0.18)");
    g.addColorStop(1, "rgba(255,255,255,0.55)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(32, 32, 29, 0, TAU);
    c.fill();
    c.strokeStyle = "rgba(255,255,255,0.8)";
    c.lineWidth = 2.5;
    c.stroke();
    c.fillStyle = "rgba(255,255,255,0.95)";
    c.beginPath();
    c.ellipse(22, 20, 7, 4, -0.7, 0, TAU);
    c.fill();
    c.beginPath();
    c.arc(42, 44, 2.5, 0, TAU);
    c.fill();
  });
}

/** One god ray, soft on every edge, drawn many times with different transforms. */
function makeRaySprite(): HTMLCanvasElement {
  return paint(64, 256, 1, (c) => {
    c.beginPath();
    c.moveTo(24, 0);
    c.lineTo(40, 0);
    c.lineTo(64, 256);
    c.lineTo(0, 256);
    c.closePath();
    const v = c.createLinearGradient(0, 0, 0, 256);
    v.addColorStop(0, "rgba(255,255,230,0.7)");
    v.addColorStop(1, "rgba(255,255,230,0)");
    c.fillStyle = v;
    c.fill();
    c.globalCompositeOperation = "destination-in";
    const s = c.createLinearGradient(0, 0, 64, 0);
    s.addColorStop(0, "rgba(0,0,0,0)");
    s.addColorStop(0.5, "rgba(0,0,0,1)");
    s.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = s;
    c.fillRect(0, 0, 64, 256);
  });
}

// --- creature drawing --------------------------------------------------------

function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, blink: boolean, happy: boolean): void {
  if (happy) {
    // Closed "smiling" eyes: the universal face of a pleased creature.
    ctx.strokeStyle = "#2a1838";
    ctx.lineWidth = r * 0.32;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(x, y + r * 0.2, r * 0.6, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    return;
  }
  const open = blink ? 0.12 : 1;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * open, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#24163a";
  ctx.beginPath();
  ctx.ellipse(x + r * 0.18, y + r * 0.06, r * 0.62, r * 0.62 * open, 0, 0, TAU);
  ctx.fill();
  if (!blink) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x + r * 0.02, y - r * 0.22, r * 0.24, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + r * 0.42, y + r * 0.28, r * 0.11, 0, TAU);
    ctx.fill();
  }
}

function blush(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = "rgba(255,120,150,0.5)";
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.6, 0, 0, TAU);
  ctx.fill();
}

function drawFish(ctx: CanvasRenderingContext2D, f: Fish, t: number): void {
  const s = f.size;
  const speed = Math.hypot(f.vx, f.vy);
  const face = Math.sign(f.face || 1) * Math.max(0.18, Math.abs(f.face));
  const wiggle = f.happy > 0 ? Math.sin(t * 28) * 0.14 * Math.min(1, f.happy) : 0;
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(clamp(f.vy / 420, -0.45, 0.45) * Math.sign(face) + wiggle);
  ctx.scale(face, 1);

  // Tail first, so the body sits over its root. It wags faster the faster
  // the fish swims, which is the one cue that makes a drawing feel propelled.
  const wag = Math.sin(f.tail) * (0.22 + Math.min(0.45, speed / 500));
  ctx.save();
  ctx.translate(-s * 0.78, 0);
  ctx.rotate(wag);
  ctx.fillStyle = hsl(f.hue2, 90, 60);
  ctx.beginPath();
  ctx.moveTo(s * 0.12, 0);
  ctx.quadraticCurveTo(-s * 0.35, -s * 0.95, -s * 0.72, -s * 0.62);
  ctx.quadraticCurveTo(-s * 0.48, 0, -s * 0.72, s * 0.62);
  ctx.quadraticCurveTo(-s * 0.35, s * 0.95, s * 0.12, 0);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = hsl(f.hue2, 90, 63);
  ctx.beginPath();
  ctx.moveTo(-s * 0.45, -s * 0.5);
  ctx.quadraticCurveTo(-s * 0.1, -s * 1.08 - Math.sin(f.tail * 0.5) * s * 0.06, s * 0.32, -s * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-s * 0.3, s * 0.55);
  ctx.quadraticCurveTo(-s * 0.15, s * 0.95, s * 0.15, s * 0.6);
  ctx.closePath();
  ctx.fill();

  const g = ctx.createRadialGradient(-s * 0.25, -s * 0.35, s * 0.1, 0, 0, s * 1.1);
  g.addColorStop(0, hsl(f.hue, 100, 82));
  g.addColorStop(0.55, hsl(f.hue, 90, 61));
  g.addColorStop(1, hsl(f.hue, 85, 40));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, s, s * 0.74, 0, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.clip();
  if (f.pattern === 1) {
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(-s * 0.3, -s, s * 0.16, s * 2);
    ctx.fillRect(s * 0.05, -s, s * 0.13, s * 2);
  } else if (f.pattern === 2) {
    ctx.fillStyle = hsl(f.hue2, 95, 72, 0.85);
    for (const [px, py, pr] of [[-0.5, -0.2, 0.13], [-0.2, -0.45, 0.1], [-0.3, 0.2, 0.11], [0.05, -0.2, 0.08]]) {
      ctx.beginPath();
      ctx.arc(px * s, py * s, pr * s, 0, TAU);
      ctx.fill();
    }
  }
  ctx.fillStyle = "rgba(255,255,235,0.35)";
  ctx.beginPath();
  ctx.ellipse(s * 0.05, s * 0.42, s * 0.75, s * 0.3, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(-s * 0.02, s * 0.2);
  ctx.rotate(0.6 + Math.sin(t * 8 + f.seed) * 0.35);
  ctx.fillStyle = hsl(f.hue2, 90, 72, 0.92);
  ctx.beginPath();
  ctx.ellipse(-s * 0.18, 0, s * 0.24, s * 0.11, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.beginPath();
  ctx.ellipse(-s * 0.25, -s * 0.48, s * 0.25, s * 0.08, -0.15, 0, TAU);
  ctx.fill();

  drawEye(ctx, s * 0.42, -s * 0.12, s * 0.27, f.blink < 0, f.happy > 0.3);
  blush(ctx, s * 0.32, s * 0.27, s * 0.13);
  drawMouth(ctx, s * 0.84, s * 0.12, s, f.munch, t);
  ctx.restore();
}

function drawMouth(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, munch: number, t: number): void {
  if (munch > 0) {
    ctx.fillStyle = "#5a1d3a";
    ctx.beginPath();
    ctx.arc(x, y, s * 0.08 * (0.6 + 0.4 * Math.abs(Math.sin(t * 30))), 0, TAU);
    ctx.fill();
  } else {
    ctx.strokeStyle = "#5a1d3a";
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(x - s * 0.06, y - s * 0.06, s * 0.1, 0.3, 1.5);
    ctx.stroke();
  }
}

function drawPuffer(ctx: CanvasRenderingContext2D, f: Fish, t: number): void {
  const s = f.size;
  const R = s * (0.82 + f.puff * 0.55);
  const face = Math.sign(f.face || 1) * Math.max(0.25, Math.abs(f.face));
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(f.happy > 0 ? Math.sin(t * 28) * 0.12 * Math.min(1, f.happy) : Math.sin(t * 2 + f.seed) * 0.05);
  ctx.scale(face, 1);

  // Spikes grow out as it inflates — the surprise a baby will hunt for again.
  if (f.puff > 0.05) {
    ctx.fillStyle = hsl(40, 85, 58);
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const len = R + s * 0.38 * f.puff;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - 0.12) * R * 0.92, Math.sin(a - 0.12) * R * 0.92);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.lineTo(Math.cos(a + 0.12) * R * 0.92, Math.sin(a + 0.12) * R * 0.92);
      ctx.fill();
    }
  }
  const wag = Math.sin(f.tail) * 0.4;
  ctx.save();
  ctx.translate(-R * 0.92, 0);
  ctx.rotate(wag);
  ctx.fillStyle = hsl(32, 90, 58);
  ctx.beginPath();
  ctx.moveTo(s * 0.1, 0);
  ctx.quadraticCurveTo(-s * 0.3, -s * 0.5, -s * 0.42, -s * 0.3);
  ctx.quadraticCurveTo(-s * 0.3, 0, -s * 0.42, s * 0.3);
  ctx.quadraticCurveTo(-s * 0.3, s * 0.5, s * 0.1, 0);
  ctx.fill();
  ctx.restore();

  const g = ctx.createRadialGradient(-R * 0.3, -R * 0.4, R * 0.1, 0, 0, R * 1.05);
  g.addColorStop(0, hsl(52, 100, 82));
  g.addColorStop(0.6, hsl(46, 95, 60));
  g.addColorStop(1, hsl(36, 90, 42));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "rgba(255,250,230,0.8)";
  ctx.beginPath();
  ctx.ellipse(0, R * 0.62, R * 0.95, R * 0.45, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(150,90,30,0.55)";
  for (const [px, py] of [[-0.45, -0.35], [-0.1, -0.6], [-0.6, 0.05], [0.15, -0.35], [-0.3, -0.05]]) {
    ctx.beginPath();
    ctx.arc(px * R, py * R, R * 0.07, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath();
  ctx.ellipse(-R * 0.35, -R * 0.5, R * 0.22, R * 0.12, -0.6, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.translate(R * 0.05, R * 0.25);
  ctx.rotate(0.5 + Math.sin(t * 9) * 0.4);
  ctx.fillStyle = hsl(32, 90, 62, 0.9);
  ctx.beginPath();
  ctx.ellipse(-s * 0.15, 0, s * 0.2, s * 0.1, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  drawEye(ctx, R * 0.42, -R * 0.2, s * (0.26 + f.puff * 0.08), f.blink < 0, f.happy > 0.3 && f.puff < 0.3);
  blush(ctx, R * 0.35, R * 0.18, s * 0.13);
  if (f.puff > 0.3) {
    // Puffed: cheeks full, mouth a little "o" of surprise.
    ctx.fillStyle = "#5a1d3a";
    ctx.beginPath();
    ctx.ellipse(R * 0.86, R * 0.12, s * 0.08, s * 0.1, 0, 0, TAU);
    ctx.fill();
  } else {
    drawMouth(ctx, R * 0.86, R * 0.12, s, f.munch, t);
  }
  ctx.restore();
}

function drawJelly(ctx: CanvasRenderingContext2D, f: Fish, t: number): void {
  const s = f.size;
  const p = Math.sin(f.pulse);
  const bw = s * (1 + 0.14 * p);
  const bh = s * (0.85 - 0.12 * p);
  glow(ctx, f.x, f.y - bh * 0.4, s * (2.1 + f.boost * 0.8), hsl(f.hue, 100, 80, 0.55), 0.55 + f.boost * 0.4);
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(clamp(f.vx / 600, -0.3, 0.3));
  ctx.lineCap = "round";
  ctx.strokeStyle = hsl(f.hue, 90, 82, 0.75);
  ctx.lineWidth = Math.max(2, s * 0.09);
  for (let i = 0; i < 5; i++) {
    const x0 = (-0.6 + i * 0.3) * bw;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    for (let k = 1; k <= 6; k++) {
      const yk = (k / 6) * s * (1.7 - p * 0.15);
      ctx.lineTo(x0 + Math.sin(t * 3 + i * 1.3 + k * 0.8) * s * 0.14 * (k / 6) - f.vx * 0.0012 * yk, yk);
    }
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(-bw * 0.3, -bh * 0.9, s * 0.1, 0, -bh * 0.3, s * 1.3);
  g.addColorStop(0, hsl(f.hue, 100, 92, 0.95));
  g.addColorStop(0.6, hsl(f.hue, 95, 74, 0.85));
  g.addColorStop(1, hsl(f.hue + 20, 90, 62, 0.8));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-bw, 0);
  ctx.bezierCurveTo(-bw, -bh * 1.38, bw, -bh * 1.38, bw, 0);
  // A scalloped hem, so the bell reads as soft frill rather than a bowl.
  const n = 5;
  for (let i = n; i > 0; i--) {
    const x1 = -bw + ((i - 0.5) / n) * bw * 2;
    const x2 = -bw + ((i - 1) / n) * bw * 2;
    ctx.quadraticCurveTo(x1, s * 0.2, x2, 0);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(-bw * 0.4, -bh * 0.75, bw * 0.22, bh * 0.14, -0.5, 0, TAU);
  ctx.fill();
  const happy = f.boost > 0.1 || f.happy > 0;
  drawEye(ctx, -bw * 0.3, -bh * 0.42, s * 0.16, f.blink < 0, happy);
  drawEye(ctx, bw * 0.3, -bh * 0.42, s * 0.16, f.blink < 0, happy);
  blush(ctx, -bw * 0.55, -bh * 0.2, s * 0.1);
  blush(ctx, bw * 0.55, -bh * 0.2, s * 0.1);
  ctx.strokeStyle = "#7a2858";
  ctx.lineWidth = Math.max(1.5, s * 0.05);
  ctx.beginPath();
  ctx.arc(0, -bh * 0.28, s * 0.09, 0.2, Math.PI - 0.2);
  ctx.stroke();
  ctx.restore();
}

function drawTurtle(ctx: CanvasRenderingContext2D, f: Fish, t: number): void {
  const s = f.size;
  const face = Math.sign(f.face || 1) * Math.max(0.2, Math.abs(f.face));
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(f.spin * Math.sign(face) + clamp(f.vy / 500, -0.3, 0.3) * Math.sign(face));
  ctx.scale(face, 1);
  const flap = Math.sin(t * 4 + f.seed) * (f.spin > 0 ? 1.2 : 0.45);
  const skin = hsl(115, 50, 58);
  ctx.fillStyle = skin;
  for (const [fx, fy, dir] of [[-s * 0.6, s * 0.2, 1], [s * 0.45, s * 0.22, -1]] as const) {
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(0.5 * dir + flap * dir);
    ctx.beginPath();
    ctx.ellipse(-s * 0.25 * dir, s * 0.08, s * 0.38, s * 0.15, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  // Head, with its own little nod.
  ctx.save();
  ctx.translate(s * 0.98, -s * 0.08 + Math.sin(t * 2 + f.seed) * s * 0.04);
  const hg = ctx.createRadialGradient(-s * 0.1, -s * 0.15, s * 0.05, 0, 0, s * 0.42);
  hg.addColorStop(0, hsl(110, 60, 74));
  hg.addColorStop(1, hsl(120, 50, 50));
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.4, s * 0.34, 0, 0, TAU);
  ctx.fill();
  drawEye(ctx, s * 0.1, -s * 0.08, s * 0.14, f.blink < 0, f.happy > 0.3 || f.spin > 0);
  blush(ctx, s * 0.05, s * 0.13, s * 0.08);
  drawMouth(ctx, s * 0.3, s * 0.08, s * 0.7, f.munch, t);
  ctx.restore();

  const sg = ctx.createRadialGradient(-s * 0.3, -s * 0.6, s * 0.1, 0, -s * 0.2, s * 1.1);
  sg.addColorStop(0, hsl(f.hue, 70, 64));
  sg.addColorStop(1, hsl(f.hue, 65, 34));
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.moveTo(-s, s * 0.12);
  ctx.bezierCurveTo(-s, -s * 0.95, s, -s * 0.95, s, s * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = hsl(f.hue2, 75, 72, 0.9);
  for (const [px, py, pr] of [[0, -0.42, 0.24], [-0.52, -0.12, 0.18], [0.52, -0.12, 0.18], [-0.28, -0.05, 0.12], [0.28, -0.05, 0.12]]) {
    ctx.beginPath();
    ctx.ellipse(px * s, py * s, pr * s * 1.15, pr * s * 0.85, 0, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = hsl(45, 80, 70);
  ctx.beginPath();
  ctx.ellipse(0, s * 0.13, s * 1.02, s * 0.12, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.ellipse(-s * 0.35, -s * 0.55, s * 0.22, s * 0.08, -0.4, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// --- the game ----------------------------------------------------------------

function createAquarium(env: GameEnv): CanvasGame {
  const reduced = env.reduced;
  let W = 0;
  let H = 0;
  let sandTop = 0;
  let water: HTMLCanvasElement | null = null;
  let farSand: HTMLCanvasElement | null = null;
  let nearSand: HTMLCanvasElement | null = null;
  const bubbleImg = makeBubbleSprite();
  const rayImg = makeRaySprite();

  const fish: Fish[] = [];
  let bubbles: Bubble[] = [];
  let flakes: Flake[] = [];
  let ripples: Ripple[] = [];
  let weeds: Weed[] = [];
  let frontWeeds: Weed[] = [];
  let caustics: Caustic[] = [];
  let vents: number[] = [];
  let ventClock = 0;
  const fx = new Particles(220);
  const lure = { x: 0, y: 0, until: -1 };
  const trail = new Map<number, { x: number; y: number }>();
  let now = 0;
  let cam = 0;
  let camV = 0;
  let camBias = 0;
  let hum: Hum | null = null;
  let lastBloop = -1;
  let lastNom = -1;

  const top = () => H * 0.1;
  const inX = (x: number, s: number) => clamp(x, s + 8, W - s - 8);
  const inY = (y: number, s: number) => clamp(y, top() + s * 0.6, sandTop - s * 0.55);

  const newGoal = (f: Fish) => {
    // Wander targets keep out of the corner squares, so a fish never parks
    // itself under the parent's lock button.
    for (let tries = 0; tries < 6; tries++) {
      const gx = rand(f.size + 10, W - f.size - 10);
      const gy = f.kind === "turtle" ? rand(H * 0.4, sandTop - f.size) : rand(top() + f.size, sandTop - f.size);
      const inCorner = (gx < CORNER || gx > W - CORNER) && (gy < CORNER || gy > H - CORNER);
      f.gx = gx;
      f.gy = gy;
      if (!inCorner) break;
    }
    f.goalT = rand(3, 7);
  };

  const makeFish = (kind: Kind, size: number, hue: number): Fish => {
    const f: Fish = {
      kind,
      x: rand(0.15, 0.85) * W,
      y: rand(top() + size, sandTop - size),
      vx: rand(-30, 30),
      vy: 0,
      size,
      hue,
      hue2: hue + rand(25, 60),
      pattern: pick([0, 1, 2] as const),
      face: Math.random() < 0.5 ? -1 : 1,
      tail: rand(0, TAU),
      cruise: (kind === "turtle" ? 42 : kind === "jelly" ? 30 : kind === "puffer" ? 55 : rand(70, 110)) * (reduced ? 0.6 : 1),
      gx: 0,
      gy: 0,
      goalT: 0,
      flee: 0,
      happy: 0,
      puff: 0,
      puffV: 0,
      puffHold: 0,
      pulse: rand(0, TAU),
      boost: 0,
      spin: 0,
      blink: rand(1, 4),
      munch: 0,
      seed: rand(0, TAU),
    };
    newGoal(f);
    return f;
  };

  const populate = () => {
    const U = clamp(Math.min(W, H) * 0.07, 28, 64);
    const n = W * H > 900_000 ? 6 : 5;
    const hues = [...CANDY].sort(() => Math.random() - 0.5);
    // Turtle first: drawn first, so it swims "behind" the smaller fish.
    fish.push(makeFish("turtle", U * 1.25, rand(140, 160)));
    fish[0].hue2 = 95;
    for (let i = 0; i < n; i++) fish.push(makeFish("fish", U * rand(0.75, 1.2), hues[i % hues.length]));
    fish.push(makeFish("puffer", U * 0.95, 48));
    fish.push(makeFish("jelly", U * 0.95, pick([300, 330, 270])));
  };

  const addBubble = (x: number, y: number, r: number, vy?: number) => {
    bubbles.push({ x, y, r, vy: vy ?? -(45 + r * 7), phase: rand(0, TAU), life: rand(4, 8) });
    if (bubbles.length > MAX_BUBBLES) bubbles.splice(0, bubbles.length - MAX_BUBBLES);
  };

  const hearts = (x: number, y: number, count = 4) => {
    fx.burst(x, y, {
      count,
      shapes: ["heart"],
      hues: [340, 350, 0, 320],
      speed: [30, 90],
      gravity: -90,
      drag: 0.4,
      life: [0.9, 1.4],
      size: [6, 10],
      up: 50,
    });
  };

  const hitFish = (x: number, y: number): Fish | null => {
    for (let i = fish.length - 1; i >= 0; i--) {
      const f = fish[i];
      const r =
        f.kind === "puffer"
          ? f.size * (0.82 + f.puff * 0.55) * 1.2 + 12
          : f.kind === "jelly"
            ? f.size * 1.4
            : f.size * 1.3 + 10;
      const cy = f.kind === "jelly" ? f.y - f.size * 0.2 : f.y;
      if (Math.hypot(x - f.x, y - cy) < r) return f;
    }
    return null;
  };

  const touchFish = (f: Fish, px: number, py: number) => {
    let dx = f.x - px;
    let dy = f.y - py;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    if (d < 2) {
      const a = rand(0, TAU);
      dx = Math.cos(a);
      dy = Math.sin(a);
    }
    const far = Math.min(W, H) * 0.45;
    for (let i = 0; i < 6; i++) addBubble(f.x + rand(-f.size, f.size) * 0.5, f.y + rand(-f.size, f.size) * 0.5, rand(3, 8), rand(-160, -60));
    switch (f.kind) {
      case "puffer":
        f.puffHold = 2.4;
        f.puffV += 16;
        f.happy = 0.6;
        sweep({ pitch: [[0, 200], [0.3, 620]], dur: 0.38, gain: 0.22, vibrato: { rate: 14, depth: 25 } });
        sweep({ type: "triangle", pitch: [[0, 880], [0.08, 1320]], dur: 0.25, gain: 0.08, delay: 0.3 });
        fx.burst(f.x, f.y, { count: 10, shapes: ["star"], hues: [48, 40, 55], speed: [80, 220], gravity: 0, drag: 0.2, life: [0.4, 0.8] });
        break;
      case "jelly":
        f.boost = 1.3;
        f.vy -= 200;
        f.vx += dx * 80;
        f.gx = inX(f.x + dx * far * 0.6, f.size);
        f.gy = inY(f.y - far * 0.5, f.size);
        [7, 9, 11].forEach((n, i) => note(n, { type: "sine", duration: 0.8, gain: 0.13, reverb: 0.6, delay: i * 0.07 }));
        fx.burst(f.x, f.y - f.size * 0.4, { count: 14, shapes: ["star", "dot"], hues: [f.hue, 55, 190], speed: [60, 200], gravity: 0, drag: 0.15, life: [0.6, 1.1] });
        break;
      case "turtle":
        f.spin = 0.0001;
        f.happy = 1;
        bloop(0.7, 0.2);
        bloop(0.95, 0.15);
        sweep({ pitch: [[0, 380], [0.12, 520]], dur: 0.16, gain: 0.12, delay: 0.16 });
        break;
      default:
        f.flee = 0.75;
        f.vx = dx * 520;
        f.vy = dy * 520;
        f.gx = inX(f.x + dx * far, f.size);
        f.gy = inY(f.y + dy * far, f.size);
        sweep({ pitch: [[0, 620], [0.12, 1500]], dur: 0.16, gain: 0.16 });
        hiss({ dur: 0.22, from: 3000, to: 1200, gain: 0.08, type: "bandpass", q: 0.8 });
    }
  };

  const tapWater = (x: number, y: number) => {
    ripples.push({ x, y, age: 0 });
    if (ripples.length > MAX_RIPPLES) ripples.shift();
    for (let i = 0; i < 6; i++) {
      flakes.push({
        x: x + rand(-24, 24),
        y: y + rand(-18, 8),
        vx: rand(-70, 70),
        vy: rand(-50, 15),
        rot: rand(0, TAU),
        hue: pick([18, 30, 42, 350]),
        life: 12,
        phase: rand(0, TAU),
        eaten: false,
      });
    }
    if (flakes.length > MAX_FLAKES) flakes.splice(0, flakes.length - MAX_FLAKES);
    for (let i = 0; i < 4; i++) addBubble(x + rand(-14, 14), y + rand(-8, 8), rand(3, 7));
    fx.burst(x, y, { count: 6, shapes: ["star"], hues: [55, 190, 170], speed: [50, 140], gravity: 0, drag: 0.15, life: [0.4, 0.7], size: [4, 7] });
    // The weed near a splash flinches, so the whole tank feels the touch.
    for (const s of weeds) if (Math.abs(s.x - x) < 160) s.kick = Math.min(2, s.kick + 1.2);
    for (const s of frontWeeds) if (Math.abs(s.x - x) < 160) s.kick = Math.min(2, s.kick + 1.2);
    bloop(0.8 + (1 - y / H) * 0.6, 0.22);
    note(Math.floor(clamp(x / W, 0, 0.99) * 5) + 5, { type: "sine", duration: 0.7, gain: 0.08, reverb: 0.55, delay: 0.06 });
  };

  const layout = (w: number, h: number) => {
    W = w;
    H = h;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    sandTop = h * (h > w ? 0.85 : 0.8);
    water = paint(w, h, dpr, (c) => paintWater(c, w, h, sandTop));
    farSand = paint(w + PAD * 2, h, dpr, (c) => paintFarSand(c, w + PAD * 2, h, sandTop));
    nearSand = paint(w + PAD * 2, h, dpr, (c) => paintNearSand(c, w + PAD * 2, h, sandTop + h * 0.02));

    const unit = Math.min(w, h);
    const nWeed = clamp(Math.round(w / 110), 4, 12);
    weeds = Array.from({ length: nWeed }, (_, i) => ({
      x: ((i + rand(0.2, 0.8)) / nWeed) * w,
      base: sandTop + h * 0.03,
      len: unit * rand(0.16, 0.3),
      width: unit * rand(0.018, 0.028),
      hue: rand(120, 170),
      phase: rand(0, TAU),
      kick: 0,
    }));
    // Two big blurry-near strands at the edges: the front of the glass.
    frontWeeds = [
      { x: w * 0.04, base: h + 10, len: unit * 0.42, width: unit * 0.04, hue: 140, phase: 0, kick: 0 },
      { x: w * 0.96, base: h + 10, len: unit * 0.36, width: unit * 0.036, hue: 160, phase: 2, kick: 0 },
    ];
    caustics = Array.from({ length: 14 }, () => ({
      x: rand(0, w),
      y: rand(sandTop + h * 0.03, h - 8),
      r: rand(10, 26),
      speed: rand(0.6, 1.4),
      phase: rand(0, TAU),
    }));
    vents = [w * 0.2, w * 0.55, w * 0.82];

    if (!fish.length) populate();
    else
      for (const f of fish) {
        f.x = inX(f.x, f.size);
        f.y = inY(f.y, f.size);
        newGoal(f);
      }
  };

  // --- update ----------------------------------------------------------------

  const updateFish = (f: Fish, dt: number) => {
    f.blink -= dt;
    if (f.blink < -0.12) f.blink = rand(2, 5);
    f.happy = Math.max(0, f.happy - dt);
    f.munch = Math.max(0, f.munch - dt);
    if (f.spin > 0) {
      f.spin += dt * 9;
      if (f.spin >= TAU) f.spin = 0;
    }
    [f.puff, f.puffV] = spring(f.puff, f.puffV, f.puffHold > 0 ? 1 : 0, dt, 90, 9);
    f.puffHold -= dt;

    let tx = f.gx;
    let ty = f.gy;
    let speed = f.cruise;
    let hunting = false;
    if (f.flee > 0) {
      f.flee -= dt;
      speed = f.cruise * 4;
    } else {
      // Food beats everything: the tap turned into a feast is the game.
      let best: Flake | null = null;
      let bd = Infinity;
      if (f.kind !== "jelly") {
        for (const fl of flakes) {
          if (fl.eaten) continue;
          const d = Math.hypot(fl.x - f.x, fl.y - f.y);
          if (d < bd) {
            bd = d;
            best = fl;
          }
        }
      }
      if (best) {
        tx = best.x;
        ty = best.y;
        speed = f.cruise * (f.kind === "turtle" ? 1.6 : 2.3);
        hunting = true;
        const mouthX = f.x + Math.sign(f.face || 1) * f.size * 0.85;
        if (Math.hypot(best.x - mouthX, best.y - f.y) < f.size * 0.75) {
          best.eaten = true;
          f.happy = 1.2;
          f.munch = 0.35;
          hearts(f.x, f.y - f.size * 0.6, 3);
          if (now - lastNom > 0.09) {
            lastNom = now;
            sweep({ pitch: [[0, 520], [0.05, 820]], dur: 0.07, gain: 0.12, reverb: 0.15 });
            sweep({ pitch: [[0, 660], [0.05, 990]], dur: 0.07, gain: 0.1, delay: 0.08, reverb: 0.15 });
          }
        }
      } else if (lure.until > now) {
        tx = lure.x + Math.cos(f.seed) * f.size * 1.8;
        ty = lure.y + Math.sin(f.seed) * f.size * 1.1;
        speed = f.cruise * 1.9;
        hunting = true;
      } else {
        f.goalT -= dt;
        if (f.goalT <= 0 || Math.hypot(f.gx - f.x, f.gy - f.y) < f.size) newGoal(f);
      }
    }
    if (f.puffHold > 0) speed *= 0.25;

    const dx = tx - f.x;
    const dy = ty - f.y;
    const d = Math.hypot(dx, dy) || 1;
    if (f.kind === "jelly") {
      // Jellies don't steer, they pulse: thrust only on the squeeze half of
      // the bell's cycle, then coast and sink a little.
      f.boost = Math.max(0, f.boost - dt);
      f.pulse += dt * (2.4 + f.boost * 5) * (reduced ? 0.7 : 1);
      const thrust = Math.max(0, Math.sin(f.pulse)) * (1 + f.boost * 3);
      f.vx += (dx / d) * thrust * 70 * dt;
      f.vy += ((dy / d) * thrust * 90 + 12) * dt;
      const keep = Math.pow(0.35, dt);
      f.vx *= keep;
      f.vy *= keep;
    } else {
      // Arrive gently rather than overshooting, unless chasing food.
      const arrive = hunting ? 1 : Math.min(1, d / (f.size * 2.5));
      const dvx = (dx / d) * speed * arrive;
      const dvy = (dy / d) * speed * arrive * 0.75;
      const k = Math.min(1, (f.flee > 0 ? 5 : 2.2) * dt);
      f.vx += (dvx - f.vx) * k;
      f.vy += (dvy - f.vy) * k;
      if (f.puffHold > 0) f.vy -= 30 * dt;
    }
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    const s = f.kind === "puffer" ? f.size * (0.82 + f.puff * 0.55) : f.size;
    if (f.x < s * 0.5 || f.x > W - s * 0.5) f.vx *= -0.5;
    f.x = clamp(f.x, s * 0.5, W - s * 0.5);
    f.y = clamp(f.y, top() + s * 0.5, sandTop - s * 0.45);

    const want = f.vx > 10 ? 1 : f.vx < -10 ? -1 : Math.sign(f.face || 1);
    f.face += (want - f.face) * Math.min(1, dt * 6);
    f.tail += dt * (5 + Math.hypot(f.vx, f.vy) * 0.045);
  };

  return {
    resize: layout,

    frame(ctx, dt, t, w, h) {
      now = t;
      if (w !== W || h !== H || !water) layout(w, h);
      if (!water || !farSand || !nearSand) return;

      // The camera drifts on its own and leans away from the last touch:
      // the layers slide at different rates, and that IS the depth.
      const camTarget = reduced ? 0 : Math.sin(t * 0.13) * 14 + camBias;
      [cam, camV] = spring(cam, camV, camTarget, dt, 6, 5);
      camBias *= Math.pow(0.6, dt);
      const amb = reduced ? 0.35 : 1;
      const ta = t * amb;

      // --- update ---
      for (const f of fish) updateFish(f, dt);
      for (const fl of flakes) {
        if (fl.y < sandTop + 4) {
          const keep = Math.pow(0.25, dt);
          fl.vx *= keep;
          fl.vy = fl.vy * keep + (1 - keep) * 26;
          fl.x += (fl.vx + Math.sin(t * 3 + fl.phase) * 14) * dt;
          fl.y += fl.vy * dt;
          fl.rot += dt * 2;
        }
        fl.life -= dt;
      }
      flakes = flakes.filter((fl) => !fl.eaten && fl.life > 0);
      ventClock -= dt;
      if (ventClock <= 0) {
        ventClock = reduced ? 0.7 : 0.22;
        addBubble(pick(vents) + cam * 0.8 + rand(-5, 5), sandTop + H * 0.02, rand(2.5, 7));
      }
      for (const b of bubbles) {
        b.y += b.vy * dt;
        b.x += Math.sin(t * 2.2 + b.phase) * 14 * dt;
        b.life -= dt;
      }
      bubbles = bubbles.filter((b) => b.life > 0 && b.y > H * 0.03);
      for (const r of ripples) r.age += dt;
      ripples = ripples.filter((r) => r.age < 0.9);
      for (const s of weeds) s.kick *= Math.pow(0.3, dt);
      for (const s of frontWeeds) s.kick *= Math.pow(0.3, dt);
      fx.update(dt);

      // --- draw: far to near ---
      ctx.drawImage(water, 0, 0, w, h);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 5; i++) {
        const x = w * (0.1 + i * 0.2) + cam * 0.2;
        ctx.save();
        ctx.translate(x, -10);
        ctx.rotate(0.22 + Math.sin(ta * 0.15 + i * 1.7) * 0.07);
        ctx.globalAlpha = 0.22 + 0.14 * Math.sin(ta * 0.4 + i * 2.1);
        const rw = w * (0.1 + 0.04 * Math.sin(i * 3.1));
        ctx.drawImage(rayImg, -rw / 2, 0, rw, h * 0.95);
        ctx.restore();
      }
      ctx.restore();
      ctx.globalAlpha = 1;

      // The underside of the surface, shimmering.
      ctx.lineWidth = 3;
      for (let k = 0; k < 2; k++) {
        ctx.strokeStyle = k ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.55)";
        ctx.beginPath();
        const y0 = h * (0.03 + k * 0.018);
        for (let x = 0; x <= w + 24; x += 24) {
          const y = y0 + Math.sin(x * 0.025 + ta * 1.6 + k) * 3 + Math.sin(x * 0.061 - ta * 2.3) * 1.5;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      ctx.drawImage(farSand, -PAD + cam * 0.35, 0, w + PAD * 2, h);
      drawWeeds(ctx, weeds, ta, cam * 0.6, amb);
      ctx.drawImage(nearSand, -PAD + cam * 0.8, 0, w + PAD * 2, h);

      // Caustics: the dancing net of light sunlight throws on a sea floor.
      ctx.strokeStyle = "rgba(255,255,240,1)";
      ctx.lineWidth = 2;
      for (const c of caustics) {
        const k = 0.5 + 0.5 * Math.sin(ta * c.speed * 1.6 + c.phase);
        ctx.globalAlpha = 0.1 + 0.18 * k;
        const r = c.r * (0.8 + 0.4 * k);
        ctx.beginPath();
        ctx.ellipse(c.x + cam * 0.8 + Math.sin(ta * c.speed + c.phase) * 10, c.y, r, r * 0.38, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const fl of flakes) {
        ctx.save();
        ctx.translate(fl.x, fl.y);
        ctx.rotate(fl.rot);
        ctx.globalAlpha = Math.min(1, fl.life);
        ctx.fillStyle = hsl(fl.hue, 90, 62);
        ctx.fillRect(-4, -3, 8, 6);
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.fillRect(-4, -3, 4, 2);
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      for (const f of fish) {
        if (f.kind === "fish") drawFish(ctx, f, t);
        else if (f.kind === "puffer") drawPuffer(ctx, f, t);
        else if (f.kind === "jelly") drawJelly(ctx, f, t);
        else drawTurtle(ctx, f, t);
      }

      for (const b of bubbles) {
        ctx.globalAlpha = Math.min(1, b.life * 2);
        ctx.drawImage(bubbleImg, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
      }
      ctx.globalAlpha = 1;

      for (const r of ripples) {
        const k = r.age / 0.9;
        for (let i = 0; i < 2; i++) {
          const kk = k - i * 0.2;
          if (kk <= 0) continue;
          ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - kk)})`;
          ctx.lineWidth = 5 * (1 - kk) + 1;
          ctx.beginPath();
          ctx.arc(r.x, r.y, 12 + kk * 95, 0, TAU);
          ctx.stroke();
        }
      }

      fx.draw(ctx);
      drawWeeds(ctx, frontWeeds, ta, cam * 1.3, amb);
    },

    down(p: GamePointer) {
      if (!hum) hum = startHum();
      camBias = clamp((W / 2 - p.x) / W, -0.5, 0.5) * 30;
      trail.set(p.id, { x: p.x, y: p.y });
      const f = hitFish(p.x, p.y);
      if (f) touchFish(f, p.x, p.y);
      else tapWater(p.x, p.y);
    },

    move(p: GamePointer) {
      const last = trail.get(p.id);
      if (!last) return;
      lure.x = p.x;
      lure.y = p.y;
      lure.until = now + 1.4;
      const d = Math.hypot(p.x - last.x, p.y - last.y);
      // A bubble every finger-width of travel, so a fast swipe leaves a
      // continuous stream instead of a dotted line.
      if (d > 16) {
        const steps = Math.min(4, Math.floor(d / 16));
        for (let i = 1; i <= steps; i++) {
          const k = i / steps;
          addBubble(last.x + (p.x - last.x) * k + rand(-4, 4), last.y + (p.y - last.y) * k + rand(-4, 4), rand(3, 9), rand(-90, -40));
        }
        trail.set(p.id, { x: p.x, y: p.y });
        if (now - lastBloop > 0.11) {
          lastBloop = now;
          bloop(0.9 + (1 - p.y / Math.max(1, H)) * 1.1, 0.09);
        }
      }
    },

    up(p: GamePointer) {
      trail.delete(p.id);
    },

    dispose() {
      hum?.stop();
      hum = null;
    },
  };
}

function drawWeeds(ctx: CanvasRenderingContext2D, list: Weed[], t: number, offset: number, amb: number): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of list) {
    const n = 7;
    const amp = s.len * 0.12 * (amb + s.kick);
    const pts: Array<[number, number]> = [];
    for (let j = 0; j <= n; j++) {
      const k = j / n;
      pts.push([s.x + offset + Math.sin(t * 1.1 + s.phase + j * 0.55 + s.kick * 2) * amp * k, s.base - s.len * k]);
    }
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? hsl(s.hue, 70, 58) : hsl(s.hue, 65, 34);
      ctx.lineWidth = pass ? s.width * 0.5 : s.width;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let j = 1; j < pts.length - 1; j++) {
        const mx = (pts[j][0] + pts[j + 1][0]) / 2;
        const my = (pts[j][1] + pts[j + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[j][0], pts[j][1], mx, my);
      }
      ctx.lineTo(pts[n][0], pts[n][1]);
      ctx.stroke();
    }
    ctx.fillStyle = hsl(s.hue + 10, 70, 50);
    for (let j = 2; j < n; j += 2) {
      const side = j % 4 === 0 ? 1 : -1;
      ctx.beginPath();
      ctx.ellipse(pts[j][0] + side * s.width * 0.9, pts[j][1], s.width * 0.9, s.width * 0.4, side * 0.6, 0, TAU);
      ctx.fill();
    }
  }
}
