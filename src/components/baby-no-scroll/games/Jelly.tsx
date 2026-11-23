"use client";

// ---------------------------------------------------------------------------
// Jelly — a shelf of squishy jelly friends who love being poked.
//
// Each blob is a real (if tiny) soft body: a ring of sixteen springy points
// around a centre, so it squashes where it is pressed, bulges everywhere else,
// and wobbles back with an overshoot. That wobble is the whole toy — a baby
// pokes, the jelly answers with its body AND a boing, and the face reacts:
// eyes squeeze shut and the mouth goes "o" while it is squished.
//
// Every touch does something:
//   - poke a blob: it squishes and boings
//   - drag it: it follows the finger, sloshing behind it; let go and it is
//     flung, bouncing off the walls and its friends
//   - touch empty space: the nearest blobs hop toward the finger
// And with nobody touching they breathe, blink, look around and now and then
// hop on their own, so the screen is never a still picture.
//
// The floor sits well above the bottom of the screen on purpose: it keeps
// every resting blob out of the bottom corners, which belong to the parent's
// lock button.
// ---------------------------------------------------------------------------

import { GameCanvas, type CanvasGame, type GameEnv, type GamePointer } from "./GameCanvas";
import { audio, SCALE } from "@/lib/baby-no-scroll/audio";
import { CANDY, TAU, clamp, rand } from "@/lib/baby-no-scroll/fx";

export function Jelly() {
  return <GameCanvas create={createJelly} />;
}

// --- the soft body ----------------------------------------------------------------

const PTS = 16;
const COS = Array.from({ length: PTS }, (_, i) => Math.cos((i / PTS) * TAU));
const SIN = Array.from({ length: PTS }, (_, i) => Math.sin((i / PTS) * TAU));
/** Index of the point pointing up-left (225°), where the light catches. */
const UPLEFT = 10;

const GRAVITY = 1900;
/** Spring back to round, damping, neighbour coupling (smoothness), and pressure (keeps the volume). */
const K = 240;
const DAMP = 7;
const KN = 140;
const KP = 160;

interface Blob {
  x: number;
  y: number;
  vx: number;
  vy: number;
  R: number;
  hue: number;
  note: number;
  /** Radial offset of each rim point from the rest radius, and its velocity. */
  d: Float32Array;
  dv: Float32Array;
  /** Pointer holding it, and where on the blob it was grabbed. */
  grab: number | null;
  ox: number;
  oy: number;
  /** 0..1 how hard a finger is pressing in, and from which side. */
  press: number;
  pressAngle: number;
  blinkIn: number;
  blinkLeft: number;
  hopIn: number;
  lookX: number;
  lookY: number;
  phase: number;
  lastBoing: number;
}

interface Finger {
  x: number;
  y: number;
  vx: number;
  vy: number;
  at: number;
  sx: number;
  sy: number;
  blob: Blob | null;
  /** Where the last hop was called from, for dragging across empty space. */
  hx: number;
  hy: number;
  hopAt: number;
}

// --- sound ------------------------------------------------------------------------

/**
 * The boing: a sine that swoops up fast and settles back to its note, with a
 * vibrato that fades out — the sound of something springy still shaking. A
 * quiet triangle an octave up gives it body on small tablet speakers, which
 * barely play a pure low sine at all.
 */
function boing(freq: number, gain: number, bend = 1): void {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime;
  const env = a.ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(gain, t + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  env.connect(a.out);
  const send = a.ctx.createGain();
  send.gain.value = 0.18;
  env.connect(send).connect(a.room);

  const lfo = a.ctx.createOscillator();
  lfo.frequency.value = 9;
  const depth = a.ctx.createGain();
  depth.gain.setValueAtTime(freq * 0.07, t);
  depth.gain.linearRampToValueAtTime(0, t + 0.5);
  lfo.connect(depth);

  ([["sine", 1, 1], ["triangle", 2, 0.25]] as const).forEach(([type, mult, level]) => {
    const osc = a.ctx.createOscillator();
    osc.type = type;
    const f = freq * mult;
    osc.frequency.setValueAtTime(f * 0.55, t);
    osc.frequency.exponentialRampToValueAtTime(f * 1.6 * bend, t + 0.07);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.3);
    depth.connect(osc.frequency);
    const lvl = a.ctx.createGain();
    lvl.gain.value = level;
    osc.connect(lvl).connect(env);
    osc.start(t);
    osc.stop(t + 0.55);
  });
  lfo.start(t);
  lfo.stop(t + 0.55);
}

// --- the game ---------------------------------------------------------------------

function createJelly(env: GameEnv): CanvasGame {
  const reduced = env.reduced;
  let W = 0;
  let H = 0;
  let floorY = 0;
  let bg: HTMLCanvasElement | null = null;
  const blobs: Blob[] = [];
  const fingers = new Map<number, Finger>();
  let clock = 0;
  let lastTouch = { x: 0, y: 0, at: -10 };
  const acc = new Float32Array(PTS);
  const px = new Float32Array(PTS);
  const py = new Float32Array(PTS);

  const sound = (b: Blob, gain: number, bend = 1) => {
    if (clock - b.lastBoing < 0.12) return;
    b.lastBoing = clock;
    boing(SCALE[b.note % SCALE.length], gain, bend);
  };

  /**
   * An impact along an axis: points facing the axis get pushed in, the sides
   * pushed out — a squash. A negative speed stretches instead (a launch).
   */
  const impact = (b: Blob, nx: number, ny: number, speed: number) => {
    const s = clamp(speed, -2400, 2400) * 0.3 * (b.R / 55);
    for (let i = 0; i < PTS; i++) {
      const c = COS[i] * nx + SIN[i] * ny;
      b.dv[i] += s * (0.5 - c * c) * 2;
    }
  };

  const hop = (b: Blob, tx: number, ty: number, loud: number) => {
    if (b.grab !== null) return;
    const lift = clamp(b.y - ty + b.R * 0.6, 70, H * 0.7);
    const vy = -Math.min(2100, Math.sqrt(2 * GRAVITY * lift));
    const T = -vy / GRAVITY;
    b.vx = clamp(((tx - b.x) / T) * 0.9, -1000, 1000);
    b.vy = vy;
    impact(b, 0, 1, -700);
    if (loud > 0) sound(b, 0.13 * loud, 1.4);
  };

  const makeBlob = (x: number, y: number, R: number, hue: number, note: number): Blob => ({
    x,
    y,
    vx: 0,
    vy: 0,
    R,
    hue,
    note,
    d: new Float32Array(PTS),
    dv: new Float32Array(PTS),
    grab: null,
    ox: 0,
    oy: 0,
    press: 0,
    pressAngle: -Math.PI / 2,
    blinkIn: rand(1, 4),
    blinkLeft: 0,
    hopIn: rand(3, 8),
    lookX: 0,
    lookY: 0,
    phase: Math.random() * TAU,
    lastBoing: -1,
  });

  const paintBackground = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(W * dpr));
    c.height = Math.max(1, Math.round(H * dpr));
    const g = c.getContext("2d") as CanvasRenderingContext2D;
    g.scale(dpr, dpr);

    const sky = g.createLinearGradient(0, 0, 0, floorY);
    sky.addColorStop(0, "#ffd6ea");
    sky.addColorStop(0.55, "#e3cfff");
    sky.addColorStop(1, "#c3e2ff");
    g.fillStyle = sky;
    g.fillRect(0, 0, W, floorY + 2);

    // Big soft lights in the air, like a sunny candy shop through a window.
    for (let i = 0; i < 9; i++) {
      const x = Math.random() * W;
      const y = Math.random() * floorY;
      const r = rand(40, 140);
      const gl = g.createRadialGradient(x, y, 0, x, y, r);
      gl.addColorStop(0, "rgba(255,255,255,0.4)");
      gl.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gl;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Sprinkles floating in the background, faint so they never read as a target.
    g.lineCap = "round";
    const sprinkles = Math.round((W * floorY) / 9000);
    for (let i = 0; i < sprinkles; i++) {
      const x = Math.random() * W;
      const y = Math.random() * (floorY - 20);
      const a = Math.random() * Math.PI;
      g.strokeStyle = `hsl(${CANDY[i % CANDY.length]} 90% 70% / 0.45)`;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(x - Math.cos(a) * 5, y - Math.sin(a) * 5);
      g.lineTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5);
      g.stroke();
    }

    // The floor: a strawberry-cream table with an icing edge.
    const fl = g.createLinearGradient(0, floorY, 0, H);
    fl.addColorStop(0, "#ff9fcb");
    fl.addColorStop(1, "#e45d9e");
    g.fillStyle = fl;
    g.fillRect(0, floorY, W, H - floorY);
    const s = clamp(W / 40, 10, 18);
    g.fillStyle = "#fff3f8";
    g.fillRect(0, floorY - 3, W, 8);
    for (let x = s * 0.6; x < W + s; x += s * 1.6) {
      const drip = Math.random() < 0.3 ? rand(s * 0.6, s * 1.6) : 0;
      g.beginPath();
      g.arc(x, floorY + 5, s * 0.6, 0, Math.PI);
      g.fill();
      if (drip) {
        g.fillRect(x - s * 0.22, floorY + 5, s * 0.44, drip);
        g.beginPath();
        g.arc(x, floorY + 5 + drip, s * 0.22, 0, TAU);
        g.fill();
      }
    }
    for (let i = 0; i < Math.round(W / 22); i++) {
      const x = Math.random() * W;
      const y = rand(floorY + s * 2, H - 8);
      const a = Math.random() * Math.PI;
      g.strokeStyle = `hsl(${CANDY[(i * 3) % CANDY.length]} 95% 72% / 0.8)`;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(x - Math.cos(a) * 5, y - Math.sin(a) * 5);
      g.lineTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5);
      g.stroke();
    }
    bg = c;
  };

  const populate = () => {
    const n = clamp(Math.round((W * H) / 120000), 4, 6);
    const R = clamp(Math.min(Math.sqrt((W * H) / n) * 0.2, W / (n * 2.2)), 36, 110);
    const hues = [350, 42, 135, 195, 265, 18].sort(() => Math.random() - 0.5);
    const notes = [0, 2, 4, 1, 3, 5];
    for (let i = 0; i < n; i++) {
      const x = W * (0.12 + (0.76 * (i + 0.5)) / n);
      // They drop in from high up at the start: the first thing a baby sees
      // is the whole family landing with a wobble.
      const y = reduced ? floorY - R * 0.88 : R + rand(0, floorY * 0.35);
      blobs.push(makeBlob(x, y, R, hues[i % hues.length], notes[i]));
    }
  };

  const hit = (x: number, y: number): Blob | null => {
    let best: Blob | null = null;
    let bestScore = Infinity;
    for (const b of blobs) {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d > b.R * 1.15 + 16) continue;
      const score = d / b.R;
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  };

  const nearest = (x: number, y: number, count: number): Blob[] =>
    blobs
      .filter((b) => b.grab === null)
      .map((b) => ({ b, d: Math.hypot(b.x - x, b.y - y) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, count)
      .map((p) => p.b);

  // --- physics, one small step ------------------------------------------------------

  const step = (h: number, t: number) => {
    for (const b of blobs) {
      const R = b.R;
      const e = R * 0.88;
      let ax = 0;
      let ay = 0;
      const f = b.grab !== null ? fingers.get(b.grab) : undefined;
      if (f) {
        // Follow the finger on a stiff spring: the slight lag is what makes the
        // jelly slosh behind the hand instead of moving like a sticker.
        ax = (f.x - b.ox - b.x) * 420 - b.vx * 34;
        ay = (f.y - b.oy - b.y) * 420 - b.vy * 34;
        b.vx += ax * h;
        b.vy += ay * h;
      } else {
        b.vy += GRAVITY * h;
        b.vx *= Math.pow(0.85, h);
      }
      b.x += b.vx * h;
      b.y += b.vy * h;

      if (b.y + e > floorY) {
        b.y = floorY - e;
        if (b.vy > 0) {
          if (b.vy > 380) sound(b, clamp(b.vy / 4000, 0.04, 0.14));
          impact(b, 0, 1, b.vy);
          b.vy = b.vy > 140 ? -b.vy * 0.42 : 0;
        }
        b.vx *= Math.pow(0.08, h);
      }
      if (b.y - e < 0) {
        b.y = e;
        if (b.vy < 0) {
          impact(b, 0, 1, -b.vy);
          b.vy = -b.vy * 0.5;
        }
      }
      if (b.x - e < 0) {
        b.x = e;
        if (b.vx < 0) {
          if (b.vx < -380) sound(b, clamp(-b.vx / 4000, 0.04, 0.12));
          impact(b, 1, 0, -b.vx);
          b.vx = -b.vx * 0.5;
        }
      }
      if (b.x + e > W) {
        b.x = W - e;
        if (b.vx > 0) {
          if (b.vx > 380) sound(b, clamp(b.vx / 4000, 0.04, 0.12));
          impact(b, 1, 0, b.vx);
          b.vx = -b.vx * 0.5;
        }
      }

      // The rim. Each point springs to its rest radius (plus a slow breath and
      // any finger dent), is smoothed by its neighbours, and shares one
      // pressure — so pressing one side in pushes the others out.
      const breathe = R * (reduced ? 0.015 : 0.035) * Math.sin(t * 1.8 + b.phase);
      const adot = (i: number) => clamp(ax * COS[i] + ay * SIN[i], -8000, 8000);
      let mean = 0;
      for (let i = 0; i < PTS; i++) mean += b.d[i];
      mean /= PTS;
      for (let i = 0; i < PTS; i++) {
        const prev = b.d[(i + PTS - 1) % PTS];
        const next = b.d[(i + 1) % PTS];
        const dent = b.press > 0 ? -R * 0.24 * b.press * Math.pow(Math.max(0, Math.cos((i / PTS) * TAU - b.pressAngle)), 3) : 0;
        const target = breathe * (SIN[i] * SIN[i] - COS[i] * COS[i]) + dent;
        acc[i] =
          -K * (b.d[i] - target) -
          DAMP * b.dv[i] +
          KN * (prev + next - 2 * b.d[i]) -
          KP * mean -
          (f ? adot(i) * 0.007 * R : 0);
      }
      for (let i = 0; i < PTS; i++) {
        b.dv[i] += acc[i] * h;
        b.d[i] = clamp(b.d[i] + b.dv[i] * h, -0.55 * R, 0.45 * R);
      }
      // Points cannot go through the floor, the walls or the ceiling: they
      // flatten against them, which is the squash you see when it lands.
      for (let i = 0; i < PTS; i++) {
        const rr = R + b.d[i];
        const ppx = b.x + COS[i] * rr;
        const ppy = b.y + SIN[i] * rr;
        let lim = Infinity;
        if (SIN[i] > 0.1 && ppy > floorY) lim = Math.min(lim, (floorY - b.y) / SIN[i] - R);
        if (SIN[i] < -0.1 && ppy < 0) lim = Math.min(lim, -b.y / SIN[i] - R);
        if (COS[i] < -0.1 && ppx < 0) lim = Math.min(lim, -b.x / COS[i] - R);
        if (COS[i] > 0.1 && ppx > W) lim = Math.min(lim, (W - b.x) / COS[i] - R);
        if (lim < b.d[i]) {
          b.d[i] = Math.max(-0.55 * R, lim);
          if (b.dv[i] > 0) b.dv[i] = 0;
        }
      }
    }

    // Blob against blob: push apart, trade momentum, squash both.
    for (let i = 0; i < blobs.length; i++) {
      const a = blobs[i];
      for (let j = i + 1; j < blobs.length; j++) {
        const b = blobs[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = (a.R + b.R) * 0.86;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const nx = d2 > 0.0001 ? dx / d : 1;
        const ny = d2 > 0.0001 ? dy / d : 0;
        const ma = a.grab !== null ? 0 : 1 / (a.R * a.R);
        const mb = b.grab !== null ? 0 : 1 / (b.R * b.R);
        const sum = ma + mb;
        if (sum <= 0) continue;
        const over = min - d;
        a.x -= nx * over * (ma / sum);
        a.y -= ny * over * (ma / sum);
        b.x += nx * over * (mb / sum);
        b.y += ny * over * (mb / sum);
        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn < 0) {
          const jn = (-1.35 * vn) / sum;
          a.vx -= nx * jn * ma;
          a.vy -= ny * jn * ma;
          b.vx += nx * jn * mb;
          b.vy += ny * jn * mb;
          impact(a, nx, ny, -vn * 0.6);
          impact(b, nx, ny, -vn * 0.6);
          if (-vn > 450) {
            sound(a, clamp(-vn / 5000, 0.04, 0.12));
            sound(b, clamp(-vn / 5000, 0.04, 0.12));
          }
        }
      }
    }
    // Where two blobs touch, their rims flatten against each other.
    for (const a of blobs) {
      for (const b of blobs) {
        if (a === b) continue;
        const reach = a.R + b.R * 1.1;
        if (Math.abs(a.x - b.x) > reach || Math.abs(a.y - b.y) > reach) continue;
        const inner = b.R * 0.9;
        for (let i = 0; i < PTS; i++) {
          const rr = a.R + a.d[i];
          const dx = a.x + COS[i] * rr - b.x;
          const dy = a.y + SIN[i] * rr - b.y;
          const dd = Math.hypot(dx, dy);
          if (dd < inner) {
            a.d[i] = Math.max(-0.55 * a.R, a.d[i] - (inner - dd) * 0.5);
            if (a.dv[i] > 0) a.dv[i] *= 0.5;
          }
        }
      }
    }
  };

  // --- drawing ------------------------------------------------------------------------

  const drawBlob = (ctx: CanvasRenderingContext2D, b: Blob, dt: number) => {
    const R = b.R;
    let cx = 0;
    let cy = 0;
    let minD = 0;
    for (let i = 0; i < PTS; i++) {
      const rr = R + b.d[i];
      px[i] = b.x + COS[i] * rr;
      py[i] = b.y + SIN[i] * rr;
      cx += px[i];
      cy += py[i];
      if (b.d[i] < minD) minD = b.d[i];
    }
    cx /= PTS;
    cy /= PTS;

    // A smooth closed curve through the rim: each point is a control point and
    // the midpoints between them are where the curve actually passes.
    ctx.beginPath();
    ctx.moveTo((px[PTS - 1] + px[0]) / 2, (py[PTS - 1] + py[0]) / 2);
    for (let i = 0; i < PTS; i++) {
      const n = (i + 1) % PTS;
      ctx.quadraticCurveTo(px[i], py[i], (px[i] + px[n]) / 2, (py[i] + py[n]) / 2);
    }
    ctx.closePath();

    const body = ctx.createRadialGradient(cx - R * 0.32, cy - R * 0.4, R * 0.05, cx, cy, R * 1.2);
    body.addColorStop(0, `hsl(${b.hue} 100% 84%)`);
    body.addColorStop(0.35, `hsl(${b.hue} 95% 66%)`);
    body.addColorStop(0.85, `hsl(${b.hue} 85% 50%)`);
    body.addColorStop(1, `hsl(${b.hue} 80% 40%)`);
    ctx.fillStyle = body;
    ctx.fill();
    // Light glowing through the jelly from below: the bit that says "jelly"
    // rather than "ball".
    const glowY = cy + R * 0.45;
    const inner = ctx.createRadialGradient(cx + R * 0.15, glowY, 0, cx + R * 0.15, glowY, R * 0.75);
    inner.addColorStop(0, `hsl(${b.hue + 25} 100% 78% / 0.6)`);
    inner.addColorStop(1, `hsl(${b.hue + 25} 100% 78% / 0)`);
    ctx.fillStyle = inner;
    ctx.fill();
    ctx.lineWidth = Math.max(2, R * 0.04);
    ctx.strokeStyle = `hsl(${b.hue} 80% 30% / 0.4)`;
    ctx.stroke();

    // The shine rides the up-left part of the rim, so it squashes with the body.
    const hx = cx + (px[UPLEFT] - cx) * 0.55;
    const hy = cy + (py[UPLEFT] - cy) * 0.55;
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    ctx.ellipse(hx, hy, R * 0.28, R * 0.15, -0.7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.ellipse(hx - R * 0.03, hy - R * 0.02, R * 0.13, R * 0.06, -0.7, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + (px[UPLEFT + 1] - cx) * 0.78, cy + (py[UPLEFT + 1] - cy) * 0.78, R * 0.035, 0, TAU);
    ctx.fill();

    // --- the face ------------------------------------------------------------
    const wf = clamp((px[0] - px[8]) / (2 * R), 0.6, 1.45);
    const hf = clamp((py[4] - py[12]) / (2 * R), 0.6, 1.45);
    const squish = clamp((-minD / R - 0.06) / 0.12, 0, 1);
    const happy = b.press > 0.4;
    const fx = cx + b.lookX * R * 0.05;
    const fy = cy - R * 0.04;
    const ink = `hsl(${b.hue} 55% 16%)`;

    ctx.fillStyle = "hsl(350 100% 70% / 0.45)";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(fx + side * R * 0.46 * wf, fy + R * 0.1 * hf, R * 0.11, R * 0.065, 0, 0, TAU);
      ctx.fill();
    }

    const er = Math.max(3.5, R * 0.095);
    b.blinkLeft = Math.max(0, b.blinkLeft - dt);
    for (const side of [-1, 1]) {
      const ex = fx + side * R * 0.3 * wf + b.lookX * R * 0.09;
      const ey = fy - R * 0.1 * hf + b.lookY * R * 0.07;
      if (happy) {
        // Squeezed shut and smiling: ^ ^
        ctx.strokeStyle = ink;
        ctx.lineWidth = er * 0.45;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(ex, ey + er * 0.45, er, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      } else {
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.ellipse(ex, ey, er, b.blinkLeft > 0 ? er * 0.14 : er * 1.12, 0, 0, TAU);
        ctx.fill();
        if (b.blinkLeft <= 0) {
          ctx.fillStyle = "rgba(255,255,255,0.95)";
          ctx.beginPath();
          ctx.arc(ex - er * 0.3, ey - er * 0.38, er * 0.36, 0, TAU);
          ctx.fill();
        }
      }
    }

    const my = fy + R * 0.14 * hf;
    if (squish > 0.35 || happy) {
      // "o!"
      const o = Math.max(squish, b.press);
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.ellipse(fx, my + R * 0.05, R * (0.07 + 0.04 * o), R * (0.08 + 0.05 * o), 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "hsl(350 90% 66%)";
      ctx.beginPath();
      ctx.ellipse(fx, my + R * (0.1 + 0.03 * o), R * 0.05, R * 0.03, 0, 0, TAU);
      ctx.fill();
    } else {
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(2.5, R * 0.045);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(fx, my - R * 0.04, R * 0.14, Math.PI * 0.18, Math.PI * 0.82);
      ctx.stroke();
    }
  };

  return {
    resize(w, h) {
      W = w;
      H = h;
      // Floor high enough that resting blobs stay out of the bottom corners.
      floorY = h - clamp(h * 0.16, 128, 190);
      paintBackground();
      if (blobs.length === 0) populate();
      for (const b of blobs) {
        b.x = clamp(b.x, b.R, w - b.R);
        if (b.y > floorY) b.y = floorY - b.R;
      }
    },

    frame(ctx, dt, t, w, h) {
      clock = t;
      // Small fixed steps: a stiff spring at a big step blows up, and dt can be
      // a twentieth of a second on a struggling tablet.
      const n = Math.max(1, Math.ceil(dt / (1 / 120)));
      for (let s = 0; s < n; s++) step(dt / n, t);

      for (const b of blobs) {
        b.press += ((b.grab !== null ? 1 : 0) - b.press) * Math.min(1, dt * (b.grab !== null ? 14 : 6));
        if (b.press < 0.01) b.press = 0;

        b.blinkIn -= dt;
        if (b.blinkIn <= 0) {
          b.blinkLeft = 0.13;
          b.blinkIn = rand(2, 5.5);
        }

        // Eyes: on the nearest finger, else where the last touch was, else a
        // slow look around.
        let tx = b.x + Math.sin(t * 0.35 + b.phase) * b.R * 2;
        let ty = b.y - b.R * 0.5 + Math.cos(t * 0.27 + b.phase) * b.R;
        let best = Infinity;
        for (const f of fingers.values()) {
          const d = Math.hypot(f.x - b.x, f.y - b.y);
          if (d < best) {
            best = d;
            tx = f.x;
            ty = f.y;
          }
        }
        if (best === Infinity && t - lastTouch.at < 2.5) {
          tx = lastTouch.x;
          ty = lastTouch.y;
        }
        const lx = tx - b.x;
        const ly = ty - b.y;
        const len = Math.hypot(lx, ly) || 1;
        const reach = Math.min(1, len / (b.R * 1.5));
        b.lookX += ((lx / len) * reach - b.lookX) * Math.min(1, dt * 10);
        b.lookY += ((ly / len) * reach - b.lookY) * Math.min(1, dt * 10);

        // Now and then a blob hops on its own: never a still picture.
        const resting = b.grab === null && Math.abs(b.vy) < 30 && Math.abs(b.vx) < 40 && b.y + b.R * 0.88 >= floorY - 1;
        if (!reduced && resting) {
          b.hopIn -= dt;
          if (b.hopIn <= 0) {
            b.hopIn = rand(4, 9);
            hop(b, clamp(b.x + rand(-1, 1) * w * 0.2, w * 0.15, w * 0.85), b.y - rand(80, 180), 0.4);
          }
        }
      }

      if (bg) ctx.drawImage(bg, 0, 0, w, h);
      else {
        ctx.fillStyle = "#e3cfff";
        ctx.fillRect(0, 0, w, h);
      }

      // Shadows first, so no blob is ever drawn under another's shadow.
      for (const b of blobs) {
        const above = floorY - (b.y + b.R * 0.88);
        const k = clamp(1 - above / (h * 0.6), 0.25, 1);
        ctx.fillStyle = `rgba(120,30,90,${0.22 * k})`;
        ctx.beginPath();
        ctx.ellipse(b.x, floorY + 4, b.R * 0.95 * k, b.R * 0.16 * k, 0, 0, TAU);
        ctx.fill();
      }
      // A grabbed blob is drawn last, on top of its friends.
      const order = blobs.filter((b) => b.grab === null).concat(blobs.filter((b) => b.grab !== null));
      for (const b of order) drawBlob(ctx, b, dt);
    },

    down(p: GamePointer) {
      lastTouch = { x: p.x, y: p.y, at: clock };
      const f: Finger = { x: p.x, y: p.y, vx: 0, vy: 0, at: performance.now(), sx: p.x, sy: p.y, blob: null, hx: p.x, hy: p.y, hopAt: clock };
      fingers.set(p.id, f);
      const b = hit(p.x, p.y);
      if (b) {
        // A second hand on a blob already held just pokes it; either way this
        // finger is "on a blob", so dragging it does not call others over.
        f.blob = b;
        if (b.grab === null) {
          b.grab = p.id;
          b.ox = p.x - b.x;
          b.oy = p.y - b.y;
        }
        // Poked near the middle reads as "pressed from above"; poked at the
        // edge, the dent is on that side.
        const off = Math.hypot(p.x - b.x, p.y - b.y);
        const ang = off < b.R * 0.35 ? -Math.PI / 2 : Math.atan2(p.y - b.y, p.x - b.x);
        b.pressAngle = ang;
        for (let i = 0; i < PTS; i++) {
          const fall = Math.pow(Math.max(0, Math.cos((i / PTS) * TAU - ang)), 2);
          b.dv[i] -= b.R * 9 * fall;
        }
        impact(b, Math.cos(ang), Math.sin(ang), 900);
        b.lastBoing = -1;
        sound(b, 0.22);
      } else {
        for (const nb of nearest(p.x, p.y, 2)) hop(nb, p.x, p.y, 1);
      }
    },

    move(p: GamePointer) {
      const f = fingers.get(p.id);
      if (!f) return;
      const now = performance.now();
      const dts = Math.max(1, now - f.at) / 1000;
      f.vx = f.vx * 0.5 + ((p.x - f.x) / dts) * 0.5;
      f.vy = f.vy * 0.5 + ((p.y - f.y) / dts) * 0.5;
      f.x = p.x;
      f.y = p.y;
      f.at = now;
      lastTouch = { x: p.x, y: p.y, at: clock };
      // Dragging across empty space keeps calling blobs over.
      if (!f.blob && Math.hypot(p.x - f.hx, p.y - f.hy) > 140 && clock - f.hopAt > 0.4) {
        f.hx = p.x;
        f.hy = p.y;
        f.hopAt = clock;
        for (const nb of nearest(p.x, p.y, 1)) hop(nb, p.x, p.y, 0.8);
      }
    },

    up(p: GamePointer) {
      const f = fingers.get(p.id);
      fingers.delete(p.id);
      if (!f || !f.blob) return;
      const b = f.blob;
      if (b.grab !== p.id) return;
      b.grab = null;
      // Fling: half the blob's own motion, half the hand's.
      b.vx = clamp(b.vx * 0.5 + f.vx * 0.5, -2400, 2400);
      b.vy = clamp(b.vy * 0.5 + f.vy * 0.5, -2400, 2400);
      // The dent springs back out, overshooting into a wobble.
      for (let i = 0; i < PTS; i++) {
        const fall = Math.pow(Math.max(0, Math.cos((i / PTS) * TAU - b.pressAngle)), 2);
        b.dv[i] += b.R * 6 * fall;
      }
    },
  };
}
