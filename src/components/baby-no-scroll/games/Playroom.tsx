"use client";

// ---------------------------------------------------------------------------
// The musical playroom — the piano grown into a room of six instruments.
//
// One instrument fills the screen at a time, as big as the piano was, because
// a baby plays with the whole hand and a small instrument is a missed one. A
// shelf of round toys along the bottom swaps it: the old instrument drops away,
// the new one bounces in and says hello with a few notes of its own, so a baby
// hears what the new toy is before touching it.
//
// What every instrument shares, and why:
//   - every pitch is pentatonic (lib/baby-no-scroll/instruments.ts), so two
//     palms are a chord and a mashed fist is a tune, never a mistake
//   - every finger is its own pointer, so two hands are two notes
//   - a finger DRAGGED across the instrument plays everything it crosses. The
//     path between two pointer samples is walked, so a fast swipe on a cheap
//     tablet cannot skip a key — the swipe is what babies do most, so it is
//     the case that has to be perfect
//   - every hit answers inside the same frame: a spring kick, a flash, sparks
//     and a rising note in the key's own colour
//
// Everything that moves lives in the GameCanvas closure, never React state.
// React holds exactly one thing — which toy on the shelf is lit.
//
// The four corners belong to the parent's lock, so the shelf sits between
// them (or, on a narrow phone, in a block above them). Nothing here is text:
// the shelf buttons are drawn pictures of the instruments.
// ---------------------------------------------------------------------------

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { GameCanvas, type CanvasGame, type GameEnv, type GamePointer } from "./GameCanvas";
import {
  CANDY,
  Particles,
  TAU,
  clamp,
  drawTwinkles,
  easeOutBack,
  glossyBall,
  glow,
  hsl,
  makeTwinkles,
  pick,
  rand,
  star,
  type ParticleShape,
  type Twinkle,
} from "@/lib/baby-no-scroll/fx";
import {
  BONGO_FREQ,
  DEFAULT_INSTRUMENT,
  INSTRUMENTS,
  INSTRUMENT_HUE,
  INSTRUMENT_KEY,
  bell,
  bongo,
  drum,
  harp,
  isInstrumentId,
  noteHue,
  piano,
  scaleFreq,
  signature,
  xylophone,
  type DrumKind,
  type InstrumentId,
} from "@/lib/baby-no-scroll/instruments";
import "./playroom.css";

// --- shared kit --------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Spring {
  x: number;
  v: number;
}

const sp = (): Spring => ({ x: 0, v: 0 });

/**
 * A damped spring, sub-stepped at 120Hz. A plain Euler step at a 20fps hitch
 * goes unstable on the stiff springs the keys use, and a key that explodes off
 * the screen on a slow frame is worse than no animation at all.
 */
function step(s: Spring, target: number, dt: number, k: number, d: number): void {
  const n = Math.max(1, Math.ceil(dt * 120));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += ((target - s.x) * k - s.v * d) * h;
    s.x += s.v * h;
  }
}

/** Rounded rectangle path (ctx.roundRect is missing on older iPads). */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

/** A soft contact shadow — an ellipse of dark, which is far cheaper than shadowBlur. */
function softShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, a = 0.5): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, Math.max(0.05, ry / rx));
  glow(ctx, 0, 0, rx, `rgba(0,0,0,${a})`);
  ctx.restore();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, TAU);
}

/** A polished chrome rod — stands, spurs, mounts. */
function chrome(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w: number): void {
  ctx.lineCap = "round";
  ctx.strokeStyle = "#6f7787";
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = Math.max(1, w * 0.35);
  ctx.beginPath();
  ctx.moveTo(x1 - w * 0.18, y1);
  ctx.lineTo(x2 - w * 0.18, y2);
  ctx.stroke();
}

/** A tripod foot under a stand. */
function tripod(ctx: CanvasRenderingContext2D, x: number, floor: number, spread: number, w: number): void {
  const knee = floor - spread * 0.55;
  chrome(ctx, x, knee, x - spread, floor, w);
  chrome(ctx, x, knee, x + spread, floor, w);
  chrome(ctx, x, knee, x + spread * 0.15, floor + spread * 0.08, w);
}

/** Fit a virtual drawing of vw × vh into a rectangle, centred. */
function fit(r: Rect, vw: number, vh: number) {
  const s = Math.min(r.w / vw, r.h / vh);
  return { s, ox: r.x + (r.w - vw * s) / 2, oy: r.y + (r.h - vh * s) / 2 };
}

/**
 * Walks the straight line between two pointer samples. A swipe on a 60Hz
 * screen can jump 80px between samples — wider than a key — so testing only
 * the samples would skip notes in exactly the gesture babies love most.
 */
function walk(px: number, py: number, x: number, y: number, fn: (x: number, y: number) => void, stride = 9): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / stride));
  for (let i = 1; i <= n; i++) fn(px + ((x - px) * i) / n, py + ((y - py) * i) / n);
}

/**
 * Pointer bookkeeping for instruments made of separate things to hit (keys,
 * bars, drums, bells). Each finger remembers which zone it is in; moving into
 * a new one strikes it. That is the glissando, and it is also how two palms
 * make a chord — each pointer is tracked on its own.
 */
function zones(
  hit: (x: number, y: number) => number,
  strike: (zone: number, x: number, y: number, first: boolean) => void,
) {
  const at = new Map<number, number>();
  return {
    down(p: GamePointer) {
      const z = hit(p.x, p.y);
      at.set(p.id, z);
      if (z >= 0) strike(z, p.x, p.y, true);
    },
    move(p: GamePointer, px: number, py: number) {
      let cur = at.get(p.id) ?? -1;
      walk(px, py, p.x, p.y, (x, y) => {
        const z = hit(x, y);
        if (z === cur) return;
        cur = z;
        if (z >= 0) strike(z, x, y, false);
      });
      at.set(p.id, cur);
    },
    up(p: GamePointer) {
      at.delete(p.id);
    },
    held(z: number) {
      for (const v of at.values()) if (v === z) return true;
      return false;
    },
    reset() {
      at.clear();
    },
  };
}

/** What an instrument may ask of the room around it. */
interface Fx {
  reduced: boolean;
  /** Celebrate a hit: sparks in the note's colour, a rising note, a ring. */
  hit(x: number, y: number, hue: number, power?: number, shapes?: readonly ParticleShape[]): void;
  /** Run something a moment from now, on the frame clock. */
  later(seconds: number, fn: () => void): void;
}

interface Instrument {
  layout(r: Rect): void;
  draw(ctx: CanvasRenderingContext2D, dt: number, t: number): void;
  down(p: GamePointer): void;
  move(p: GamePointer, px: number, py: number): void;
  up(p: GamePointer): void;
  /** Forget every finger — called when the instrument is swapped away. */
  reset(): void;
  /** Light key `i` without playing it, in time with the signature notes. */
  show(i: number): void;
}

// --- piano -------------------------------------------------------------------

/**
 * A toy upright in lacquered violet: rainbow keys that sink on a stiff spring
 * while held, a row of lamps above them that light in the key's colour, and a
 * gold trim line so the case reads as an object rather than a panel.
 */
function makePiano(fx: Fx): Instrument {
  let n = 8;
  let box: Rect = { x: 0, y: 0, w: 1, h: 1 };
  let keys: Rect = box;
  let pitch = 1;
  let kw = 1;
  let top = 40;
  let lip = 12;
  let rad = 10;
  let led = 6;
  let dirty = true;
  let faces: CanvasGradient[] = [];
  let caseFill: CanvasGradient | null = null;
  let gold: CanvasGradient | null = null;
  const press: Spring[] = Array.from({ length: 10 }, sp);
  const flash: number[] = new Array(10).fill(0);

  const hue = (i: number) => noteHue(i, n);
  const cx = (i: number) => keys.x + pitch * (i + 0.5);
  const hit = (x: number, y: number) => {
    if (x < box.x || x > box.x + box.w || y < box.y - 24 || y > box.y + box.h + 24) return -1;
    return clamp(Math.floor((x - keys.x) / pitch), 0, n - 1);
  };
  const light = (i: number, x: number, y: number, power: number) => {
    flash[i] = 1;
    press[i].v += 16;
    fx.hit(x, y, hue(i), power);
  };
  const z = zones(hit, (i, x, y, first) => {
    piano(scaleFreq(i), first ? 1 : 0.8);
    light(i, x, y, first ? 1 : 0.55);
  });

  const build = (ctx: CanvasRenderingContext2D) => {
    dirty = false;
    caseFill = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
    caseFill.addColorStop(0, "hsl(268 48% 34%)");
    caseFill.addColorStop(0.18, "hsl(266 46% 26%)");
    caseFill.addColorStop(1, "hsl(262 52% 13%)");
    gold = ctx.createLinearGradient(keys.x, 0, keys.x + keys.w, 0);
    gold.addColorStop(0, "hsl(40 85% 52%)");
    gold.addColorStop(0.3, "hsl(48 100% 80%)");
    gold.addColorStop(0.6, "hsl(42 90% 58%)");
    gold.addColorStop(1, "hsl(36 85% 46%)");
    faces = [];
    for (let i = 0; i < n; i++) {
      const g = ctx.createLinearGradient(0, keys.y, 0, keys.y + keys.h);
      g.addColorStop(0, hsl(hue(i), 100, 82));
      g.addColorStop(0.4, hsl(hue(i), 95, 65));
      g.addColorStop(1, hsl(hue(i), 88, 50));
      faces.push(g);
    }
  };

  return {
    layout(r) {
      n = r.w > r.h * 1.3 ? 10 : 8;
      const w = Math.min(r.w, r.h * 2.3);
      box = { x: r.x + (r.w - w) / 2, y: r.y, w, h: r.h };
      const pad = Math.max(10, w * 0.035);
      top = Math.max(44, r.h * 0.15);
      keys = { x: box.x + pad, y: box.y + top, w: w - pad * 2, h: r.h - top - pad };
      pitch = keys.w / n;
      kw = pitch * 0.9;
      lip = clamp(keys.h * 0.05, 8, 18);
      rad = Math.min(12, kw * 0.22);
      led = clamp(Math.min(pitch * 0.2, top * 0.16), 4, 11);
      dirty = true;
    },
    draw(ctx, dt) {
      if (dirty) build(ctx);
      for (let i = 0; i < n; i++) {
        step(press[i], z.held(i) ? 1 : 0, dt, 900, 34);
        flash[i] *= Math.exp(-dt * 3.5);
      }
      const R = Math.min(34, box.w * 0.06);
      softShadow(ctx, box.x + box.w / 2, box.y + box.h, box.w * 0.56, Math.max(18, box.h * 0.06), 0.6);
      rr(ctx, box.x, box.y, box.w, box.h, R);
      ctx.fillStyle = caseFill ?? "#2a1846";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.stroke();
      // Lid sheen: a wide soft reflection is most of what reads as "glossy".
      rr(ctx, box.x + R * 0.5, box.y + 5, box.w - R, top * 0.42, R * 0.6);
      ctx.fillStyle = "rgba(255,255,255,0.09)";
      ctx.fill();
      // Gold trim and the dark bed the keys sit in.
      rr(ctx, keys.x - 6, keys.y - 13, keys.w + 12, 5, 2.5);
      ctx.fillStyle = gold ?? "#e8b84a";
      ctx.fill();
      rr(ctx, keys.x - 5, keys.y - 4, keys.w + 10, keys.h + 9, 12);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fill();

      // Lamps above the keys.
      const ly = box.y + top * 0.42;
      for (let i = 0; i < n; i++) {
        const x = cx(i);
        const f = flash[i];
        if (f > 0.02) glow(ctx, x, ly, led * 6, hsl(hue(i), 100, 65), f * 0.9);
        ctx.fillStyle = hsl(hue(i), 90, 32 + 40 * f);
        circle(ctx, x, ly, led);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        circle(ctx, x - led * 0.32, ly - led * 0.32, led * 0.32);
        ctx.fill();
      }

      // Keys.
      for (let i = 0; i < n; i++) {
        const d = clamp(press[i].x, -0.3, 1.25);
        const x = keys.x + pitch * i + (pitch - kw) / 2;
        const yTop = keys.y + d * lip * 0.8;
        const lipH = lip * (1 - 0.6 * clamp(d, 0, 1));
        const yFace = keys.y + keys.h - lipH;
        ctx.fillStyle = hsl(hue(i), 75, 32);
        rr(ctx, x, yFace - rad, kw, lipH + rad, rad);
        ctx.fill();
        ctx.fillStyle = faces[i] ?? hsl(hue(i), 95, 62);
        rr(ctx, x, yTop, kw, yFace - yTop, rad);
        ctx.fill();
        // A shade down the right edge makes each key a bar, not a stripe.
        ctx.fillStyle = "rgba(0,0,0,0.13)";
        rr(ctx, x + kw * 0.78, yTop + 2, kw * 0.22, yFace - yTop - 2, rad);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.36)";
        rr(ctx, x + kw * 0.14, yTop + rad * 0.9, Math.max(4, kw * 0.13), (yFace - yTop) * 0.6, kw * 0.07);
        ctx.fill();
        if (flash[i] > 0.02) {
          ctx.fillStyle = `rgba(255,255,255,${flash[i] * 0.45})`;
          rr(ctx, x, yTop, kw, yFace - yTop, rad);
          ctx.fill();
          glow(ctx, x + kw / 2, yTop + 8, kw * 1.5, hsl(hue(i), 100, 76), flash[i] * 0.55);
        }
      }
    },
    down: z.down,
    move: z.move,
    up: z.up,
    reset: z.reset,
    show(i) {
      const k = Math.min(n - 1, i);
      light(k, cx(k), keys.y + keys.h * 0.35, 0.8);
    },
  };
}

// --- xylophone ---------------------------------------------------------------

/**
 * Enamelled bars on a wooden frame, graded long (low) to short (high). The
 * whole instrument is drawn in its own frame and turned on its side when the
 * screen is tall, so the bars always run along the long edge and stay as big
 * as the screen allows.
 */
function makeXylophone(fx: Fx): Instrument {
  const N = 8;
  let cx = 0;
  let cy = 0;
  let upright = false;
  let frameW = 1;
  let pitch = 1;
  let barW = 1;
  let maxLen = 1;
  let dirty = true;
  const len: number[] = new Array(N).fill(1);
  const bx: number[] = new Array(N).fill(0);
  const bounce: Spring[] = Array.from({ length: N }, sp);
  const flash: number[] = new Array(N).fill(0);
  let bodies: CanvasGradient[] = [];
  let wood: CanvasGradient | null = null;
  const mallets: { lx: number; ly: number; life: number }[] = [];
  const hue = (i: number) => noteHue(i, N);

  // Local frame: bars run along local x. Upright screens rotate it -90°, so
  // local +x points up the screen and the low notes sit at the bottom.
  const toLocal = (x: number, y: number) => (upright ? { x: -(y - cy), y: x - cx } : { x: x - cx, y: y - cy });
  const toScreen = (lx: number, ly: number) => (upright ? { x: cx + ly, y: cy - lx } : { x: cx + lx, y: cy + ly });

  const hit = (x: number, y: number) => {
    const l = toLocal(x, y);
    const i = Math.floor((l.x + frameW / 2) / pitch);
    if (i < 0 || i >= N) return -1;
    return Math.abs(l.y) <= len[i] / 2 + pitch * 0.35 ? i : -1;
  };
  const light = (i: number, lx: number, ly: number, power: number) => {
    flash[i] = 1;
    bounce[i].v += (ly > 0 ? -1 : 1) * 7;
    mallets.push({ lx, ly, life: 0.32 });
    if (mallets.length > 6) mallets.shift();
    const s = toScreen(lx, ly);
    fx.hit(s.x, s.y, hue(i), power, ["star", "star", "dot", "ring"]);
  };
  const z = zones(hit, (i, x, y, first) => {
    xylophone(scaleFreq(i + 5), first ? 1 : 0.8);
    const l = toLocal(x, y);
    light(i, l.x, l.y, first ? 1 : 0.55);
  });

  const build = (ctx: CanvasRenderingContext2D) => {
    dirty = false;
    // Bar gradients are in bar-local coordinates, so one per bar is reused
    // whatever spring offset the bar is drawn at.
    bodies = [];
    for (let i = 0; i < N; i++) {
      const g = ctx.createLinearGradient(-barW / 2, 0, barW / 2, 0);
      g.addColorStop(0, hsl(hue(i), 80, 36));
      g.addColorStop(0.22, hsl(hue(i), 95, 62));
      g.addColorStop(0.38, hsl(hue(i), 100, 80));
      g.addColorStop(0.62, hsl(hue(i), 92, 58));
      g.addColorStop(1, hsl(hue(i), 80, 34));
      bodies.push(g);
    }
    wood = ctx.createLinearGradient(0, -maxLen / 2, 0, maxLen / 2);
    wood.addColorStop(0, "hsl(28 62% 46%)");
    wood.addColorStop(0.5, "hsl(26 58% 36%)");
    wood.addColorStop(1, "hsl(22 60% 26%)");
  };

  /** One rail: a wooden beam through the bars' resting points, converging. */
  const rail = (ctx: CanvasRenderingContext2D, side: number) => {
    const thick = Math.max(12, pitch * 0.3);
    const x0 = bx[0] - pitch * 0.62;
    const x1 = bx[N - 1] + pitch * 0.62;
    const y0 = side * len[0] * 0.31;
    const y1 = side * len[N - 1] * 0.31;
    ctx.lineCap = "round";
    ctx.strokeStyle = wood ?? "#7a4a22";
    ctx.lineWidth = thick;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,220,170,0.35)";
    ctx.lineWidth = thick * 0.22;
    ctx.beginPath();
    ctx.moveTo(x0, y0 - thick * 0.22);
    ctx.lineTo(x1, y1 - thick * 0.22);
    ctx.stroke();
    // Glossy knobs on the rail ends, like a pull-along toy.
    glossyBall(ctx, x0, y0, thick * 0.75, 350);
    glossyBall(ctx, x1, y1, thick * 0.75, 195);
  };

  return {
    layout(r) {
      upright = r.h > r.w * 1.05;
      cx = r.x + r.w / 2;
      cy = r.y + r.h / 2;
      const LW = upright ? r.h : r.w;
      const LH = upright ? r.w : r.h;
      frameW = Math.min(LW * 0.94, LH * 2.6);
      pitch = frameW / N;
      barW = pitch * 0.8;
      maxLen = LH * 0.9;
      for (let i = 0; i < N; i++) {
        bx[i] = -frameW / 2 + pitch * (i + 0.5);
        len[i] = maxLen * (1 - (0.44 * i) / (N - 1));
      }
      dirty = true;
    },
    draw(ctx, dt) {
      if (dirty) build(ctx);
      for (let i = 0; i < N; i++) {
        step(bounce[i], 0, dt, 420, 9);
        flash[i] *= Math.exp(-dt * 4);
      }
      ctx.save();
      ctx.translate(cx, cy);
      if (upright) ctx.rotate(-Math.PI / 2);
      softShadow(ctx, 0, maxLen * 0.5, frameW * 0.55, maxLen * 0.08, 0.5);
      rail(ctx, -1);
      rail(ctx, 1);

      for (let i = 0; i < N; i++) {
        const s = bounce[i].x;
        const L = len[i];
        ctx.save();
        ctx.translate(bx[i], s * 7);
        ctx.rotate(s * 0.035);
        ctx.scale(1 + flash[i] * 0.05, 1 + flash[i] * 0.015);
        ctx.fillStyle = "rgba(0,0,0,0.32)";
        rr(ctx, -barW / 2 + 4, -L / 2 + 7, barW, L, barW * 0.32);
        ctx.fill();
        ctx.fillStyle = bodies[i] ?? hsl(hue(i), 95, 60);
        rr(ctx, -barW / 2, -L / 2, barW, L, barW * 0.32);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        rr(ctx, -barW * 0.24, -L / 2 + barW * 0.3, barW * 0.14, L - barW * 0.6, barW * 0.07);
        ctx.fill();
        // The two nail heads the bar rests on.
        for (const side of [-1, 1]) {
          const py = side * L * 0.31;
          ctx.fillStyle = "#c9ced8";
          circle(ctx, 0, py, barW * 0.12);
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          circle(ctx, -barW * 0.04, py - barW * 0.04, barW * 0.045);
          ctx.fill();
        }
        if (flash[i] > 0.02) {
          ctx.fillStyle = `rgba(255,255,255,${flash[i] * 0.5})`;
          rr(ctx, -barW / 2, -L / 2, barW, L, barW * 0.32);
          ctx.fill();
        }
        ctx.restore();
      }

      // The mallet: appears where the finger struck and taps down onto it.
      for (let j = mallets.length - 1; j >= 0; j--) {
        const m = mallets[j];
        m.life -= dt;
        if (m.life <= 0) {
          mallets.splice(j, 1);
          continue;
        }
        const k = 1 - m.life / 0.32;
        const swing = k < 0.25 ? 0.7 * (1 - k / 0.25) : 0.35 * ((k - 0.25) / 0.75);
        const head = Math.max(12, pitch * 0.22);
        ctx.save();
        ctx.translate(m.lx, m.ly);
        ctx.rotate(-0.6 - swing);
        ctx.globalAlpha = Math.min(1, m.life / 0.12);
        ctx.strokeStyle = "hsl(36 60% 80%)";
        ctx.lineWidth = Math.max(5, head * 0.38);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(head * 5.5, 0);
        ctx.stroke();
        glossyBall(ctx, 0, 0, head, 350, Math.min(1, m.life / 0.12));
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    },
    down: z.down,
    move: z.move,
    up: z.up,
    reset: z.reset,
    show(i) {
      const k = clamp(i, 0, N - 1);
      light(k, bx[k], -len[k] * 0.1, 0.7);
    },
  };
}

// --- drawn drums (kit and bongos share these) ----------------------------------

interface DrumLook {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Shell depth below the head. */
  H: number;
  hue: number;
  /** Natural wood with painted bands (bongos) instead of lacquer (kit). */
  wood: boolean;
  /** Bulging conga shell. */
  barrel: boolean;
}

function shellPath(ctx: CanvasRenderingContext2D, d: DrumLook): void {
  const { cx, cy, rx, ry, H, barrel } = d;
  const bx = barrel ? rx * 0.78 : rx;
  ctx.beginPath();
  ctx.moveTo(cx - rx, cy);
  if (barrel) ctx.bezierCurveTo(cx - rx * 1.22, cy + H * 0.35, cx - rx * 1.1, cy + H * 0.7, cx - bx, cy + H);
  else ctx.lineTo(cx - rx, cy + H);
  ctx.ellipse(cx, cy + H, bx, ry * (bx / rx), 0, Math.PI, 0, true);
  if (barrel) ctx.bezierCurveTo(cx + rx * 1.1, cy + H * 0.7, cx + rx * 1.22, cy + H * 0.35, cx + rx, cy);
  else ctx.lineTo(cx + rx, cy);
  ctx.closePath();
}

/**
 * A drum seen from the front and a little above: shell, hoops, lugs, head.
 * `q` is the squash spring — positive squashes, negative stretches, pinned at
 * the drum's foot so it bounces on the floor rather than floating.
 * `rings` are the ages (0→1) of ripples spreading across the head.
 */
function drawDrum(ctx: CanvasRenderingContext2D, d: DrumLook, q: number, rings: number[], flash: number): void {
  const { cx, cy, rx, ry, H, hue, wood } = d;
  const foot = cy + H;
  ctx.save();
  ctx.translate(cx, foot);
  ctx.scale(1 + q * 0.09, 1 - q * 0.14);
  ctx.translate(-cx, -foot);

  // Shell, lit like a cylinder: dark edges, a bright band left of centre.
  shellPath(ctx, d);
  const g = ctx.createLinearGradient(cx - rx * 1.2, 0, cx + rx * 1.2, 0);
  if (wood) {
    g.addColorStop(0, "hsl(22 60% 20%)");
    g.addColorStop(0.3, "hsl(28 70% 46%)");
    g.addColorStop(0.42, "hsl(32 80% 62%)");
    g.addColorStop(0.62, "hsl(26 66% 40%)");
    g.addColorStop(1, "hsl(20 60% 18%)");
  } else {
    g.addColorStop(0, hsl(hue, 70, 22));
    g.addColorStop(0.28, hsl(hue, 90, 54));
    g.addColorStop(0.4, hsl(hue, 100, 74));
    g.addColorStop(0.58, hsl(hue, 90, 50));
    g.addColorStop(1, hsl(hue, 75, 20));
  }
  ctx.fillStyle = g;
  ctx.fill();

  if (wood) {
    // Painted bands, clipped to the shell so they follow a barrel's curve.
    ctx.save();
    shellPath(ctx, d);
    ctx.clip();
    for (const [at, band, h2] of [
      [0.3, hue, 0.12],
      [0.48, hue + 180, 0.05],
      [0.66, hue, 0.12],
    ] as const) {
      ctx.fillStyle = hsl(band, 85, 52, 0.85);
      ctx.fillRect(cx - rx * 1.3, cy + H * at, rx * 2.6, Math.max(4, H * h2));
    }
    ctx.restore();
    // Tuning hooks: chrome rods from the rim down the shell.
    for (const k of [-0.7, -0.24, 0.24, 0.7]) {
      chrome(ctx, cx + k * rx, cy + ry * 0.5, cx + k * rx * (d.barrel ? 1.08 : 1), cy + H * 0.42, Math.max(3, rx * 0.05));
    }
  } else {
    // Lacquer streak and lugs.
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    rr(ctx, cx - rx * 0.52, cy + ry * 0.5, rx * 0.07, H * 0.9, rx * 0.035);
    ctx.fill();
    for (const k of [-0.64, -0.2, 0.2, 0.64]) {
      ctx.fillStyle = "#c3cad6";
      rr(ctx, cx + k * rx - rx * 0.04, cy + H * 0.22 + ry * 0.4, rx * 0.08, H * 0.42, rx * 0.04);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      rr(ctx, cx + k * rx - rx * 0.025, cy + H * 0.24 + ry * 0.4, rx * 0.022, H * 0.36, rx * 0.01);
      ctx.fill();
    }
    // Bottom hoop.
    ctx.strokeStyle = "#aab2c0";
    ctx.lineWidth = Math.max(3, rx * 0.06);
    ctx.beginPath();
    ctx.ellipse(cx, foot, rx, ry, 0, 0, Math.PI);
    ctx.stroke();
  }

  // The head.
  const hg = ctx.createRadialGradient(cx - rx * 0.25, cy - ry * 0.35, 0, cx, cy, rx * 1.05);
  if (wood) {
    hg.addColorStop(0, "hsl(42 70% 90%)");
    hg.addColorStop(0.75, "hsl(34 52% 72%)");
    hg.addColorStop(1, "hsl(26 45% 46%)");
  } else {
    hg.addColorStop(0, "hsl(45 40% 98%)");
    hg.addColorStop(0.8, "hsl(40 20% 84%)");
    hg.addColorStop(1, "hsl(38 18% 70%)");
  }
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  ctx.fill();
  for (const a of rings) {
    const k = 0.15 + 0.85 * a;
    ctx.strokeStyle = hsl(hue, 100, wood ? 45 : 62, (1 - a) * 0.75);
    ctx.lineWidth = Math.max(1.5, rx * 0.04 * (1 - a));
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * k, ry * k, 0, 0, TAU);
    ctx.stroke();
  }
  if (flash > 0.02) {
    ctx.fillStyle = `rgba(255,255,255,${flash * 0.55})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.fill();
  }
  // Rim.
  ctx.lineWidth = Math.max(3, rx * 0.075);
  if (wood) {
    ctx.strokeStyle = "hsl(24 45% 24%)";
  } else {
    const rim = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
    rim.addColorStop(0, "#8b93a3");
    rim.addColorStop(0.35, "#ffffff");
    rim.addColorStop(0.6, "#b4bccb");
    rim.addColorStop(1, "#6f7787");
    ctx.strokeStyle = rim;
  }
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/** Inside the head ellipse (generously) or anywhere on the shell. */
function inDrum(d: DrumLook, x: number, y: number): boolean {
  const dx = (x - d.cx) / (d.rx * 1.1);
  const dy = (y - d.cy) / (d.ry * 1.7);
  if (dx * dx + dy * dy <= 1) return true;
  return Math.abs(x - d.cx) <= d.rx * (d.barrel ? 1.1 : 1) && y >= d.cy && y <= d.cy + d.H + d.ry;
}

// --- drum kit ------------------------------------------------------------------

interface KitPiece {
  kind: DrumKind;
  vx: number;
  vy: number;
  vr: number;
  /** Shell depth; 0 for the kick (front view) and cymbal. */
  vh: number;
  hue: number;
}

// Order matters: signature() in instruments.ts lights pieces by these indices.
const KIT_WIDE: KitPiece[] = [
  { kind: "cymbal", vx: 845, vy: 170, vr: 140, vh: 0, hue: 46 },
  { kind: "tomHi", vx: 392, vy: 215, vr: 92, vh: 76, hue: 195 },
  { kind: "tomLo", vx: 612, vy: 215, vr: 100, vh: 82, hue: 135 },
  { kind: "kick", vx: 500, vy: 450, vr: 170, vh: 0, hue: 350 },
  { kind: "snare", vx: 172, vy: 400, vr: 118, vh: 62, hue: 52 },
];
const KIT_TALL: KitPiece[] = [
  { kind: "cymbal", vx: 350, vy: 150, vr: 200, vh: 0, hue: 46 },
  { kind: "tomHi", vx: 190, vy: 410, vr: 118, vh: 92, hue: 195 },
  { kind: "tomLo", vx: 510, vy: 410, vr: 124, vh: 98, hue: 135 },
  { kind: "kick", vx: 480, vy: 785, vr: 178, vh: 0, hue: 350 },
  { kind: "snare", vx: 162, vy: 755, vr: 128, vh: 70, hue: 52 },
];

/**
 * A candy drum kit: kick drum facing the baby with a painted star, two toms,
 * a snare and a golden cymbal that wobbles on its stand and keeps shimmering
 * after it is hit. Every drum squashes into the floor and springs back.
 */
function makeDrums(fx: Fx): Instrument {
  let tall = false;
  let floor = 0;
  let unit = 1;
  let pieces: (DrumLook & { kind: DrumKind })[] = [];
  const squash: Spring[] = Array.from({ length: 5 }, sp);
  const flash: number[] = new Array(5).fill(0);
  const rings: number[][] = [[], [], [], [], []];
  const wobble = sp();
  const tilt = sp();
  let shimmer = 0;

  const hit = (x: number, y: number) => {
    // Front to back: snare, kick, toms, cymbal.
    for (const i of [4, 3, 2, 1, 0]) {
      const d = pieces[i];
      if (!d) continue;
      if (d.kind === "kick") {
        if (Math.hypot(x - d.cx, y - d.cy) <= d.rx * 1.02) return i;
      } else if (d.kind === "cymbal") {
        const dx = (x - d.cx) / (d.rx * 1.05);
        const dy = (y - d.cy) / (d.rx * 0.42);
        if (dx * dx + dy * dy <= 1) return i;
      } else if (inDrum(d, x, y)) return i;
    }
    return -1;
  };
  const light = (i: number, x: number, y: number, power: number) => {
    const d = pieces[i];
    if (!d) return;
    flash[i] = 1;
    if (d.kind === "cymbal") {
      wobble.v += (x < d.cx ? -1 : 1) * 4.5;
      tilt.v += 7;
      shimmer = 1;
      fx.hit(x, y, 48, power * 1.2, ["star", "star", "dot"]);
    } else {
      squash[i].v += 11;
      rings[i].push(0);
      if (rings[i].length > 4) rings[i].shift();
      fx.hit(x, y, d.hue, d.kind === "kick" ? power * 1.4 : power, ["dot", "star", "heart"]);
    }
  };
  const z = zones(hit, (i, x, y, first) => {
    const d = pieces[i];
    if (!d) return;
    drum(d.kind, first ? 1 : 0.8);
    light(i, x, y, first ? 1 : 0.6);
  });

  const drawKick = (ctx: CanvasRenderingContext2D, d: DrumLook, i: number) => {
    const { cx, cy, rx: r, hue } = d;
    const q = squash[i].x;
    ctx.save();
    ctx.translate(cx, cy + r);
    ctx.scale(1 + q * 0.08, 1 - q * 0.1);
    ctx.translate(-cx, -(cy + r));
    chrome(ctx, cx - r * 0.72, cy + r * 0.6, cx - r * 1.02, cy + r * 1.04, Math.max(3, r * 0.045));
    chrome(ctx, cx + r * 0.72, cy + r * 0.6, cx + r * 1.02, cy + r * 1.04, Math.max(3, r * 0.045));
    const shell = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    shell.addColorStop(0, hsl(hue, 100, 70));
    shell.addColorStop(0.45, hsl(hue, 90, 52));
    shell.addColorStop(1, hsl(hue, 80, 26));
    ctx.fillStyle = shell;
    circle(ctx, cx, cy, r);
    ctx.fill();
    ctx.strokeStyle = "#c9d0dc";
    ctx.lineWidth = Math.max(3, r * 0.06);
    circle(ctx, cx, cy, r * 0.92);
    ctx.stroke();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU + 0.3;
      ctx.fillStyle = "#e7ebf2";
      circle(ctx, cx + Math.cos(a) * r * 0.96, cy + Math.sin(a) * r * 0.96, Math.max(2.5, r * 0.035));
      ctx.fill();
    }
    const head = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, 0, cx, cy, r * 0.9);
    head.addColorStop(0, "hsl(45 45% 98%)");
    head.addColorStop(1, "hsl(38 22% 78%)");
    ctx.fillStyle = head;
    circle(ctx, cx, cy, r * 0.85);
    ctx.fill();
    star(ctx, cx, cy + r * 0.04, r * 0.46, r * 0.21, 5);
    ctx.fillStyle = hsl(hue, 95, 60);
    ctx.fill();
    star(ctx, cx - r * 0.03, cy, r * 0.3, r * 0.13, 5);
    ctx.fillStyle = hsl(hue, 100, 74);
    ctx.fill();
    for (const a of rings[i]) {
      ctx.strokeStyle = hsl(hue, 100, 62, (1 - a) * 0.7);
      ctx.lineWidth = Math.max(2, r * 0.035 * (1 - a));
      circle(ctx, cx, cy, r * 0.85 * (0.2 + 0.8 * a));
      ctx.stroke();
    }
    if (flash[i] > 0.02) {
      ctx.fillStyle = `rgba(255,255,255,${flash[i] * 0.5})`;
      circle(ctx, cx, cy, r * 0.85);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.38, cy - r * 0.42, r * 0.3, r * 0.14, -0.7, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  const drawCymbal = (ctx: CanvasRenderingContext2D, d: DrumLook, t: number) => {
    const { cx, cy, rx } = d;
    glow(ctx, cx, cy, rx * 1.35, hsl(48, 100, 70), 0.12 + shimmer * 0.55);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.08 + wobble.x * 0.22);
    const ry = rx * clamp(0.24 + tilt.x * 0.1, 0.07, 0.5);
    const g = ctx.createRadialGradient(-rx * 0.25, -ry * 0.4, 0, 0, 0, rx);
    g.addColorStop(0, "hsl(52 100% 88%)");
    g.addColorStop(0.45, "hsl(45 95% 64%)");
    g.addColorStop(0.85, "hsl(38 90% 44%)");
    g.addColorStop(1, "hsl(34 85% 30%)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(110,60,0,0.22)";
    ctx.lineWidth = 1.2;
    for (let k = 0.28; k < 0.98; k += 0.11) {
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * k, ry * k, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = "hsl(48 100% 80%)";
    ctx.beginPath();
    ctx.ellipse(0, -ry * 0.12, rx * 0.17, Math.max(2, ry * 0.55), 0, 0, TAU);
    ctx.fill();
    // The shimmer: two bright arcs travelling round the lathe lines.
    const a0 = fx.reduced ? 0.6 : t * 1.3;
    ctx.strokeStyle = `rgba(255,255,255,${0.22 + shimmer * 0.65})`;
    ctx.lineWidth = Math.max(3, rx * 0.04);
    ctx.lineCap = "round";
    for (const off of [0, Math.PI]) {
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * 0.7, ry * 0.7, 0, a0 + off, a0 + off + 1.1);
      ctx.stroke();
    }
    ctx.restore();
  };

  return {
    layout(r) {
      tall = r.h > r.w * 1.05;
      const kit = tall ? KIT_TALL : KIT_WIDE;
      const vw = tall ? 700 : 1000;
      const vh = tall ? 1000 : 640;
      const f = fit(r, vw, vh);
      unit = f.s;
      floor = f.oy + vh * f.s;
      pieces = kit.map((p) => ({
        kind: p.kind,
        cx: f.ox + p.vx * f.s,
        cy: f.oy + p.vy * f.s,
        rx: p.vr * f.s,
        ry: p.vr * f.s * 0.36,
        H: p.vh * f.s,
        hue: p.hue,
        wood: false,
        barrel: false,
      }));
    },
    draw(ctx, dt, t) {
      for (let i = 0; i < 5; i++) {
        step(squash[i], 0, dt, 380, 13);
        flash[i] *= Math.exp(-dt * 5);
        const rs = rings[i];
        for (let k = rs.length - 1; k >= 0; k--) {
          rs[k] += dt * 1.6;
          if (rs[k] >= 1) rs.splice(k, 1);
        }
      }
      step(wobble, 0, dt, 55, 2.2);
      step(tilt, 0, dt, 90, 3.5);
      shimmer *= Math.exp(-dt * 1.2);
      const [cym, tomHi, tomLo, kick, snare] = pieces;
      if (!cym || !tomHi || !tomLo || !kick || !snare) return;
      const w = Math.max(3, 9 * unit);

      softShadow(ctx, kick.cx - (tall ? 60 : 0) * unit, floor, (tall ? 360 : 480) * unit, 40 * unit, 0.55);
      // Stands, behind everything.
      chrome(ctx, cym.cx, cym.cy, cym.cx, floor - 40 * unit, w);
      tripod(ctx, cym.cx, floor, 70 * unit, w);
      chrome(ctx, snare.cx, snare.cy + snare.H, snare.cx, floor - 40 * unit, w);
      tripod(ctx, snare.cx, floor, 64 * unit, w);
      for (const tom of [tomHi, tomLo]) {
        if (tall) {
          chrome(ctx, tom.cx, tom.cy + tom.H, tom.cx, kick.cy - kick.rx * 0.2, w);
        } else {
          chrome(ctx, tom.cx, tom.cy + tom.H, kick.cx + (tom.cx - kick.cx) * 0.3, kick.cy - kick.rx * 0.55, w);
        }
      }

      drawCymbal(ctx, cym, t);
      drawDrum(ctx, tomHi, squash[1].x, rings[1], flash[1]);
      drawDrum(ctx, tomLo, squash[2].x, rings[2], flash[2]);
      drawKick(ctx, kick, 3);
      drawDrum(ctx, snare, squash[4].x, rings[4], flash[4]);
    },
    down: z.down,
    move: z.move,
    up: z.up,
    reset: z.reset,
    show(i) {
      const d = pieces[i];
      if (d) light(i, d.cx, d.cy, 0.8);
    },
  };
}

// --- harp ----------------------------------------------------------------------

/**
 * A golden harp: column on the left, a curved neck along the top, a rose
 * soundboard on the diagonal. Strings run from neck to soundboard, long and
 * low on the left. A finger dragged across plucks every string it crosses —
 * the crossing is found exactly (sign change of x against each string), so a
 * strum is a strum however fast it is. Plucked strings visibly shiver.
 */
function makeHarp(fx: Fx): Instrument {
  let F: Rect = { x: 0, y: 0, w: 1, h: 1 };
  let n = 10;
  let spacing = 30;
  const strings: { x: number; top: number; bot: number; hue: number; amp: number; phase: number }[] = [];

  const neckY = (u: number) => F.y + F.h * (0.09 + 0.13 * u - 0.08 * Math.sin(u * Math.PI));
  const boardY = (u: number) => F.y + F.h * (0.95 - 0.66 * clamp((u - 0.08) / 0.92, 0, 1.05));
  const ux = (u: number) => F.x + F.w * u;

  const pluck = (i: number, y: number, first: boolean) => {
    const s = strings[i];
    if (!s) return;
    harp(scaleFreq(i - 5), first ? 1 : 0.85);
    s.amp = Math.min(16, s.amp + (first ? 12 : 9));
    s.phase = Math.random() * TAU;
    fx.hit(s.x, y, s.hue, first ? 0.9 : 0.5, ["star", "dot", "heart"]);
  };

  return {
    layout(r) {
      const w = Math.min(r.w, r.h * 1.05);
      F = { x: r.x + (r.w - w) / 2, y: r.y, w, h: r.h };
      const span = F.w * 0.74;
      n = clamp(Math.round(span / 34) + 1, 8, 12);
      spacing = span / (n - 1);
      strings.length = 0;
      for (let i = 0; i < n; i++) {
        const u = 0.2 + (0.74 * i) / (n - 1);
        strings.push({
          x: ux(u),
          top: neckY(u) + F.h * 0.02,
          bot: boardY(u) - 2,
          hue: noteHue(i, n),
          amp: 0,
          phase: 0,
        });
      }
    },
    draw(ctx, dt, t) {
      const H = F.h;
      softShadow(ctx, ux(0.35), F.y + H * 0.98, F.w * 0.45, H * 0.04, 0.55);

      // Soundboard.
      ctx.beginPath();
      ctx.moveTo(ux(0.08), boardY(0.08));
      ctx.lineTo(ux(1), boardY(1));
      ctx.lineTo(ux(1.02), boardY(1) + H * 0.07);
      ctx.lineTo(ux(0.3), F.y + H);
      ctx.lineTo(ux(0.08), F.y + H);
      ctx.closePath();
      const board = ctx.createLinearGradient(ux(0.3), boardY(0.6), ux(0.45), boardY(0.6) + H * 0.2);
      board.addColorStop(0, "hsl(334 70% 62%)");
      board.addColorStop(0.5, "hsl(328 60% 44%)");
      board.addColorStop(1, "hsl(320 55% 26%)");
      ctx.fillStyle = board;
      ctx.fill();
      ctx.strokeStyle = "hsl(44 90% 66%)";
      ctx.lineWidth = Math.max(3, H * 0.008);
      ctx.beginPath();
      ctx.moveTo(ux(0.08), boardY(0.08));
      ctx.lineTo(ux(1), boardY(1));
      ctx.stroke();
      for (const u of [0.35, 0.58, 0.8]) {
        ctx.fillStyle = "hsl(320 60% 16%)";
        ctx.beginPath();
        ctx.ellipse(ux(u), boardY(u) + H * 0.06 * (1.2 - u), F.w * 0.025, H * 0.016, -0.62, 0, TAU);
        ctx.fill();
      }

      // Strings, shivering while they ring.
      for (let i = 0; i < strings.length; i++) {
        const s = strings[i];
        s.amp *= Math.exp(-dt * 1.7);
        const off = s.amp > 0.05 ? s.amp * Math.sin(t * (46 + i * 2.5) + s.phase) : 0;
        const mid = (s.top + s.bot) / 2;
        const lw = 5.5 - (2.5 * i) / Math.max(1, n - 1);
        if (s.amp > 0.4) {
          ctx.strokeStyle = hsl(s.hue, 100, 70, Math.min(0.5, s.amp / 20));
          ctx.lineWidth = lw * 4;
          ctx.beginPath();
          ctx.moveTo(s.x, s.top);
          ctx.quadraticCurveTo(s.x + off * 2, mid, s.x, s.bot);
          ctx.stroke();
        }
        ctx.strokeStyle = hsl(s.hue, 95, 72);
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(s.x, s.top);
        ctx.quadraticCurveTo(s.x + off * 2, mid, s.x, s.bot);
        ctx.stroke();
        ctx.fillStyle = "hsl(44 95% 72%)";
        circle(ctx, s.x, s.bot, lw * 0.9);
        ctx.fill();
      }

      // Column.
      const colX = ux(0.05);
      const colW = Math.max(14, F.w * 0.065);
      const col = ctx.createLinearGradient(colX - colW / 2, 0, colX + colW / 2, 0);
      col.addColorStop(0, "hsl(36 85% 40%)");
      col.addColorStop(0.35, "hsl(48 100% 80%)");
      col.addColorStop(0.6, "hsl(42 90% 58%)");
      col.addColorStop(1, "hsl(34 85% 34%)");
      ctx.fillStyle = col;
      rr(ctx, colX - colW / 2, neckY(0) - H * 0.02, colW, F.y + H - neckY(0) + H * 0.01, colW * 0.4);
      ctx.fill();
      rr(ctx, colX - colW * 1.1, F.y + H * 0.955, colW * 2.6, H * 0.045, colW * 0.3);
      ctx.fill();

      // Neck: a thick golden curve, with tuning pins where each string meets it.
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const neckW = Math.max(14, H * 0.05);
      ctx.strokeStyle = "hsl(40 88% 50%)";
      ctx.lineWidth = neckW;
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) {
        const u = 0.04 + (0.97 * k) / 24;
        if (k === 0) ctx.moveTo(ux(u), neckY(u));
        else ctx.lineTo(ux(u), neckY(u));
      }
      ctx.stroke();
      ctx.strokeStyle = "hsl(50 100% 82%)";
      ctx.lineWidth = neckW * 0.28;
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) {
        const u = 0.04 + (0.97 * k) / 24;
        if (k === 0) ctx.moveTo(ux(u), neckY(u) - neckW * 0.2);
        else ctx.lineTo(ux(u), neckY(u) - neckW * 0.2);
      }
      ctx.stroke();
      for (const s of strings) {
        ctx.fillStyle = "hsl(30 70% 30%)";
        circle(ctx, s.x, s.top - neckW * 0.1, Math.max(2.5, neckW * 0.14));
        ctx.fill();
      }
      glossyBall(ctx, colX, neckY(0) - H * 0.025, colW * 0.85, 330);
      glossyBall(ctx, ux(1.01), neckY(1.01), neckW * 0.7, 300);
    },
    down(p) {
      let best = -1;
      let bestD = spacing * 0.6;
      strings.forEach((s, i) => {
        const d = Math.abs(p.x - s.x);
        if (d < bestD && p.y >= s.top - 30 && p.y <= s.bot + 30) {
          best = i;
          bestD = d;
        }
      });
      if (best >= 0) pluck(best, p.y, true);
    },
    move(p, px, py) {
      if (px === p.x) return;
      for (let i = 0; i < strings.length; i++) {
        const s = strings[i];
        if (px < s.x === p.x < s.x) continue;
        const y = py + ((p.y - py) * (s.x - px)) / (p.x - px);
        if (y >= s.top - 30 && y <= s.bot + 30) pluck(i, y, false);
      }
    },
    up() {},
    reset() {},
    show(i) {
      const s = strings[clamp(i, 0, strings.length - 1)];
      if (!s) return;
      s.amp = Math.min(16, s.amp + 10);
      s.phase = Math.random() * TAU;
      fx.hit(s.x, (s.top + s.bot) / 2, s.hue, 0.5, ["star", "dot"]);
    },
  };
}

// --- bells ---------------------------------------------------------------------

/**
 * Hand bells hanging from wooden beams on ribbons. Hit one and it swings on
 * its pivot like a pendulum, the clapper lagging behind it, while rings of
 * sound spread from its mouth. The tone rings for seconds into the room, so a
 * row of quick taps turns into a shimmering chord.
 */
function makeBells(fx: Fx): Instrument {
  interface B {
    px: number;
    py: number;
    L: number;
    s: number;
    hue: number;
    ang: Spring;
    clap: Spring;
    ring: number;
    phase: number;
    body: CanvasGradient | null;
  }
  let bells: B[] = [];
  let beams: { x1: number; x2: number; y: number; arch: number; w: number }[] = [];
  let dirty = true;

  const local = (b: B, x: number, y: number) => {
    const dx = x - b.px;
    const dy = y - b.py;
    const c = Math.cos(-b.ang.x);
    const s = Math.sin(-b.ang.x);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  };
  const hit = (x: number, y: number) => {
    for (let i = bells.length - 1; i >= 0; i--) {
      const b = bells[i];
      const l = local(b, x, y);
      if (Math.abs(l.x) <= b.s * 0.66 && l.y >= b.L - b.s * 0.15 && l.y <= b.L + b.s * 1.3) return i;
    }
    return -1;
  };
  const light = (i: number, lx: number, x: number, y: number, power: number) => {
    const b = bells[i];
    if (!b) return;
    const dir = Math.abs(lx) < b.s * 0.1 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(lx);
    // A push, capped so a flurry of taps swings the bell, not spins it.
    b.ang.v = clamp(b.ang.v + dir * 1.7, -2.6, 2.6);
    b.ring = 1;
    fx.hit(x, y, b.hue, power, ["star", "ring", "dot"]);
  };
  const z = zones(hit, (i, x, y, first) => {
    const b = bells[i];
    if (!b) return;
    bell(scaleFreq(i + 5), first ? 1 : 0.8);
    light(i, local(b, x, y).x, x, y, first ? 1 : 0.6);
  });

  /** Origin at the crown; mouth at y = 1.05s, half-width 0.56s. */
  const bellPath = (ctx: CanvasRenderingContext2D, s: number) => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-s * 0.36, 0, -s * 0.42, s * 0.2, -s * 0.42, s * 0.5);
    ctx.bezierCurveTo(-s * 0.42, s * 0.8, -s * 0.5, s * 0.95, -s * 0.58, s * 1.05);
    ctx.lineTo(s * 0.58, s * 1.05);
    ctx.bezierCurveTo(s * 0.5, s * 0.95, s * 0.42, s * 0.8, s * 0.42, s * 0.5);
    ctx.bezierCurveTo(s * 0.42, s * 0.2, s * 0.36, 0, 0, 0);
    ctx.closePath();
  };

  return {
    layout(r) {
      // One, two or three rows of bells — whichever makes each bell biggest
      // on this screen. A wide phone gets one arched row, a tablet two.
      let rows = 1;
      let best = 0;
      for (const k of [1, 2, 3]) {
        const size = Math.min((r.w / Math.ceil(6 / k)) * 0.72, (r.h / k) * 0.56);
        if (size > best * 1.05) {
          best = size;
          rows = k;
        }
      }
      const per = Math.ceil(6 / rows);
      const rowH = r.h / rows;
      const colW = r.w / per;
      const s = best;
      const L = Math.min(rowH * 0.15, s * 0.45);
      const old = bells;
      bells = [];
      beams = [];
      for (let row = 0; row < rows; row++) {
        // Centre the hanging bells in their row rather than pinning them up top.
        const y = r.y + rowH * row + Math.max(rowH * 0.06, (rowH - (L + s * 1.3)) / 2);
        const arch = rows > 1 ? rowH * 0.03 : rowH * 0.07;
        beams.push({ x1: r.x + colW * 0.2, x2: r.x + r.w - colW * 0.2, y, arch, w: Math.max(12, s * 0.13) });
        for (let c = 0; c < per; c++) {
          const i = row * per + c;
          const u = (c + 0.5) / per;
          const k = (u - 0.5) * 2;
          bells.push({
            px: r.x + colW * (c + 0.5),
            py: y + arch * k * k,
            L,
            s,
            hue: noteHue(i, per * rows),
            ang: old[i]?.ang ?? sp(),
            clap: old[i]?.clap ?? sp(),
            ring: 0,
            phase: Math.random() * TAU,
            body: null,
          });
        }
      }
      dirty = true;
    },
    draw(ctx, dt, t) {
      if (dirty) {
        dirty = false;
        for (const b of bells) {
          const g = ctx.createLinearGradient(-b.s * 0.58, 0, b.s * 0.58, 0);
          g.addColorStop(0, hsl(b.hue, 70, 30));
          g.addColorStop(0.26, hsl(b.hue, 95, 66));
          g.addColorStop(0.38, hsl(b.hue, 100, 88));
          g.addColorStop(0.55, hsl(b.hue, 92, 60));
          g.addColorStop(1, hsl(b.hue, 72, 28));
          b.body = g;
        }
      }
      // Beams: an arched wooden bar.
      for (const bm of beams) {
        const mx = (bm.x1 + bm.x2) / 2;
        ctx.lineCap = "round";
        ctx.strokeStyle = "hsl(26 55% 34%)";
        ctx.lineWidth = bm.w;
        ctx.beginPath();
        ctx.moveTo(bm.x1, bm.y + bm.arch);
        ctx.quadraticCurveTo(mx, bm.y - bm.arch, bm.x2, bm.y + bm.arch);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,215,160,0.35)";
        ctx.lineWidth = bm.w * 0.25;
        ctx.beginPath();
        ctx.moveTo(bm.x1, bm.y + bm.arch - bm.w * 0.2);
        ctx.quadraticCurveTo(mx, bm.y - bm.arch - bm.w * 0.2, bm.x2, bm.y + bm.arch - bm.w * 0.2);
        ctx.stroke();
        glossyBall(ctx, bm.x1, bm.y + bm.arch, bm.w * 0.85, 330);
        glossyBall(ctx, bm.x2, bm.y + bm.arch, bm.w * 0.85, 195);
      }

      for (const b of bells) {
        // A pendulum with very little damping, so a swing carries on a while.
        const idle = fx.reduced ? 0 : 0.035 * Math.sin(t * 0.9 + b.phase);
        step(b.ang, idle, dt, 16, 0.9);
        step(b.clap, b.ang.x, dt, 30, 2.6);
        b.ring *= Math.exp(-dt * 0.8);
        const s = b.s;

        // Sound rings from the bell's mouth.
        if (b.ring > 0.03) {
          const mx = b.px - Math.sin(b.ang.x) * (b.L + s * 0.7);
          const my = b.py + Math.cos(b.ang.x) * (b.L + s * 0.7);
          glow(ctx, mx, my, s * 1.5, hsl(b.hue, 100, 70), b.ring * 0.45);
          ctx.lineCap = "round";
          for (let k = 0; k < 3; k++) {
            const rad = s * (0.75 + (1 - b.ring) * 1.1 + k * 0.22);
            ctx.strokeStyle = hsl(b.hue, 100, 78, b.ring * (0.6 - k * 0.17));
            ctx.lineWidth = Math.max(2, s * 0.04);
            ctx.beginPath();
            ctx.arc(mx, my, rad, -0.45, 0.45);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(mx, my, rad, Math.PI - 0.45, Math.PI + 0.45);
            ctx.stroke();
          }
        }

        ctx.save();
        ctx.translate(b.px, b.py);
        ctx.rotate(b.ang.x);
        // Ribbon and hook.
        ctx.strokeStyle = hsl(b.hue + 20, 90, 72);
        ctx.lineWidth = Math.max(3, s * 0.06);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, b.L);
        ctx.stroke();
        ctx.strokeStyle = "hsl(46 95% 66%)";
        ctx.lineWidth = Math.max(2.5, s * 0.045);
        circle(ctx, 0, 0, Math.max(4, s * 0.07));
        ctx.stroke();

        ctx.translate(0, b.L);
        ctx.strokeStyle = "hsl(46 95% 62%)";
        ctx.lineWidth = Math.max(3, s * 0.07);
        ctx.beginPath();
        ctx.arc(0, s * 0.02, s * 0.1, Math.PI, 0);
        ctx.stroke();
        bellPath(ctx, s);
        ctx.fillStyle = b.body ?? hsl(b.hue, 95, 62);
        ctx.fill();
        // Mouth, then the clapper swinging inside it.
        ctx.fillStyle = hsl(b.hue, 60, 14);
        ctx.beginPath();
        ctx.ellipse(0, s * 1.05, s * 0.58, s * 0.12, 0, 0, TAU);
        ctx.fill();
        const rel = clamp(b.clap.x - b.ang.x, -0.35, 0.35);
        glossyBall(ctx, -Math.sin(rel) * s * 0.8, s * 0.32 + Math.cos(rel) * s * 0.78, s * 0.12, b.hue + 30);
        ctx.strokeStyle = hsl(b.hue, 100, 82);
        ctx.lineWidth = Math.max(2, s * 0.04);
        ctx.beginPath();
        ctx.ellipse(0, s * 1.05, s * 0.58, s * 0.12, 0, 0.1, Math.PI - 0.1);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = Math.max(3, s * 0.07);
        ctx.beginPath();
        ctx.moveTo(-s * 0.2, s * 0.16);
        ctx.quadraticCurveTo(-s * 0.32, s * 0.45, -s * 0.33, s * 0.8);
        ctx.stroke();
        if (b.ring > 0.03) {
          ctx.globalCompositeOperation = "lighter";
          bellPath(ctx, s);
          ctx.fillStyle = hsl(b.hue, 100, 60, b.ring * 0.35);
          ctx.fill();
          ctx.globalCompositeOperation = "source-over";
        }
        ctx.restore();
      }
    },
    down: z.down,
    move: z.move,
    up: z.up,
    reset: z.reset,
    show(i) {
      const b = bells[clamp(i, 0, bells.length - 1)];
      if (!b) return;
      light(bells.indexOf(b), b.s * 0.3, b.px, b.py + b.L + b.s * 0.6, 0.7);
    },
  };
}

// --- bongos --------------------------------------------------------------------

interface HandDrum {
  vx: number;
  vy: number;
  vr: number;
  vh: number;
  barrel: boolean;
  hue: number;
}

// Order matches BONGO_FREQ: conga, big bongo, little bongo.
const BONGO_WIDE: HandDrum[] = [
  { vx: 240, vy: 150, vr: 150, vh: 420, barrel: true, hue: 18 },
  { vx: 565, vy: 290, vr: 138, vh: 140, barrel: false, hue: 135 },
  { vx: 810, vy: 310, vr: 112, vh: 125, barrel: false, hue: 52 },
];
const BONGO_TALL: HandDrum[] = [
  { vx: 350, vy: 520, vr: 188, vh: 420, barrel: true, hue: 18 },
  { vx: 210, vy: 190, vr: 152, vh: 130, barrel: false, hue: 135 },
  { vx: 505, vy: 205, vr: 126, vh: 120, barrel: false, hue: 52 },
];

/**
 * A conga and a pair of bongos in polished wood with painted bands and chrome
 * hooks. The middle of a head is a round open tone; near the rim it is a
 * slap — higher, sharper, with a starburst instead of a ripple — so a baby
 * who explores the drum finds two sounds in it.
 */
function makeBongos(fx: Fx): Instrument {
  let drums: DrumLook[] = [];
  const squash: Spring[] = Array.from({ length: 3 }, sp);
  const flash: number[] = [0, 0, 0];
  const rings: number[][] = [[], [], []];

  const hit = (x: number, y: number) => {
    for (const i of [0, 2, 1]) {
      const d = drums[i];
      if (d && inDrum(d, x, y)) return i;
    }
    return -1;
  };
  const light = (i: number, x: number, y: number, slap: boolean, power: number) => {
    const d = drums[i];
    if (!d) return;
    squash[i].v += slap ? 8 : 12;
    flash[i] = slap ? 1 : 0.7;
    rings[i].push(0);
    if (rings[i].length > 4) rings[i].shift();
    if (slap) fx.hit(x, y, d.hue, power * 1.2, ["star", "star", "confetti"]);
    else fx.hit(x, y, d.hue, power, ["heart", "dot", "ring"]);
  };
  const isSlap = (d: DrumLook, x: number, y: number) => {
    const dx = (x - d.cx) / d.rx;
    const dy = (y - d.cy) / d.ry;
    return y <= d.cy + d.ry && Math.sqrt(dx * dx + dy * dy) > 0.62;
  };
  const z = zones(hit, (i, x, y, first) => {
    const d = drums[i];
    if (!d) return;
    const slap = isSlap(d, x, y);
    bongo(BONGO_FREQ[i], slap, first ? 1 : 0.8);
    light(i, x, y, slap, first ? 1 : 0.6);
  });

  return {
    layout(r) {
      const tall = r.h > r.w * 1.05;
      const set = tall ? BONGO_TALL : BONGO_WIDE;
      const vw = tall ? 700 : 1000;
      const vh = tall ? 1000 : 620;
      const f = fit(r, vw, vh);
      drums = set.map((p) => ({
        cx: f.ox + p.vx * f.s,
        cy: f.oy + p.vy * f.s,
        rx: p.vr * f.s,
        ry: p.vr * f.s * 0.38,
        H: p.vh * f.s,
        hue: p.hue,
        wood: true,
        barrel: p.barrel,
      }));
    },
    draw(ctx, dt) {
      for (let i = 0; i < 3; i++) {
        step(squash[i], 0, dt, 360, 12);
        flash[i] *= Math.exp(-dt * 5);
        const rs = rings[i];
        for (let k = rs.length - 1; k >= 0; k--) {
          rs[k] += dt * 1.8;
          if (rs[k] >= 1) rs.splice(k, 1);
        }
      }
      const [conga, big, little] = drums;
      if (!conga || !big || !little) return;
      softShadow(ctx, conga.cx, conga.cy + conga.H + conga.ry * 0.6, conga.rx * 1.3, conga.ry * 0.9, 0.55);
      softShadow(ctx, (big.cx + little.cx) / 2, Math.max(big.cy + big.H, little.cy + little.H) + big.ry, (little.cx - big.cx) * 1.1, big.ry, 0.5);
      // The block that joins the bongo pair.
      const by = (big.cy + little.cy) / 2 + big.H * 0.35;
      const bh = Math.max(14, big.H * 0.32);
      const block = ctx.createLinearGradient(0, by, 0, by + bh);
      block.addColorStop(0, "hsl(28 60% 44%)");
      block.addColorStop(1, "hsl(22 60% 22%)");
      ctx.fillStyle = block;
      rr(ctx, big.cx + big.rx * 0.6, by, little.cx - little.rx * 0.6 - (big.cx + big.rx * 0.6), bh, bh * 0.3);
      ctx.fill();
      drawDrum(ctx, big, squash[1].x, rings[1], flash[1]);
      drawDrum(ctx, little, squash[2].x, rings[2], flash[2]);
      drawDrum(ctx, conga, squash[0].x, rings[0], flash[0]);
    },
    down: z.down,
    move: z.move,
    up: z.up,
    reset: z.reset,
    show(i) {
      const d = drums[i];
      if (d) light(i, d.cx, d.cy, false, 0.8);
    },
  };
}

const MAKERS: Record<InstrumentId, (fx: Fx) => Instrument> = {
  piano: makePiano,
  xylophone: makeXylophone,
  drums: makeDrums,
  harp: makeHarp,
  bells: makeBells,
  bongos: makeBongos,
};

// --- the room ------------------------------------------------------------------

const CORNER = 130;

interface RoomLayout {
  stage: Rect;
  shelf: { x: number; y: number; w: number; h: number; cols: number; btn: number; gap: number; pad: number };
}

/**
 * Where the instrument and the shelf go. The shelf must stay out of the four
 * 130px corner squares the lock lives in: on a wide screen it is one row
 * between the bottom corners; on a narrow phone a row will not fit between
 * them, so it becomes two rows of three sitting just above them.
 */
function roomLayout(w: number, h: number): RoomLayout {
  const n = INSTRUMENTS.length;
  const gap = 10;
  const pad = 10;
  const rowBtn = Math.floor((w - 2 * CORNER - 2 * pad - gap * (n - 1)) / n);
  const row = rowBtn >= 64;
  const cols = row ? n : Math.ceil(n / 2);
  const btn = row
    ? Math.min(84, rowBtn, Math.max(64, Math.floor(h * 0.16)))
    : clamp(Math.floor((w - 32 - 2 * pad - gap * (cols - 1)) / cols), 64, 76);
  const rows = Math.ceil(n / cols);
  const sw = cols * btn + (cols - 1) * gap + 2 * pad;
  const sh = rows * btn + (rows - 1) * gap + 2 * pad;
  const y = h - (row ? 14 : CORNER + 6) - sh;
  const top = 18;
  return {
    // The lit toy rises ~14px out of the shelf, so the stage stops short of it.
    stage: { x: 18, y: top, w: Math.max(100, w - 36), h: Math.max(120, y - 22 - top) },
    shelf: { x: (w - sw) / 2, y, w: sw, h: sh, cols, btn, gap, pad },
  };
}

interface Glyph {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  s: number;
  hue: number;
  rot: number;
  kind: number;
}

/** A music note — an eighth or a beamed pair — as a path, never a font glyph. */
function noteShape(ctx: CanvasRenderingContext2D, s: number, kind: number): void {
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.55, s * 0.4, -0.4, 0, TAU);
  ctx.fill();
  ctx.fillRect(s * 0.4, -s * 2.1, s * 0.17, s * 2.1);
  if (kind === 0) {
    ctx.beginPath();
    ctx.moveTo(s * 0.57, -s * 2.1);
    ctx.bezierCurveTo(s * 1.35, -s * 1.6, s * 1.3, -s * 1.0, s * 0.95, -s * 0.7);
    ctx.bezierCurveTo(s * 1.05, -s * 1.15, s * 0.9, -s * 1.45, s * 0.57, -s * 1.5);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.ellipse(s * 1.6, -s * 0.3, s * 0.55, s * 0.4, -0.4, 0, TAU);
    ctx.fill();
    ctx.fillRect(s * 2.0, -s * 2.4, s * 0.17, s * 2.1);
    ctx.beginPath();
    ctx.moveTo(s * 0.4, -s * 2.1);
    ctx.lineTo(s * 2.17, -s * 2.4);
    ctx.lineTo(s * 2.17, -s * 1.95);
    ctx.lineTo(s * 0.4, -s * 1.65);
    ctx.closePath();
    ctx.fill();
  }
}

interface PlayroomApi {
  select(id: InstrumentId): void;
}

function createRoom(
  env: GameEnv,
  first: InstrumentId,
  api: { current: PlayroomApi | null },
  shelf: { current: HTMLDivElement | null },
): CanvasGame {
  const reduced = env.reduced;
  const particles = new Particles(480);
  const glyphs: Glyph[] = [];
  const rings: { x: number; y: number; r: number; life: number; hue: number }[] = [];
  const timers: { at: number; fn: () => void }[] = [];
  let clock = 0;
  let W = 1;
  let H = 1;
  let stage: Rect = { x: 0, y: 0, w: 1, h: 1 };

  const fx: Fx = {
    reduced,
    hit(x, y, hue, power = 1, shapes = ["star", "dot", "heart"]) {
      particles.burst(x, y, {
        count: Math.round(8 + 12 * power),
        hues: [hue, hue + 25, hue - 25, 50],
        shapes,
        speed: [110, 240 + 220 * power],
        size: [3.5, 7 + 3 * power],
        life: [0.45, 0.95],
        gravity: 320,
        drag: 0.25,
        up: 150,
      });
      if (power >= 0.8 || Math.random() < 0.45) {
        glyphs.push({
          x,
          y,
          vx: rand(-40, 40),
          vy: -rand(90, 150),
          life: 1.5,
          max: 1.5,
          s: rand(9, 14) * (0.8 + power * 0.25),
          hue,
          rot: rand(-0.4, 0.4),
          kind: Math.random() < 0.35 ? 1 : 0,
        });
        if (glyphs.length > 36) glyphs.shift();
      }
      rings.push({ x, y, r: 36 + 44 * power, life: 0.5, hue });
      if (rings.length > 24) rings.shift();
    },
    later(seconds, fn) {
      timers.push({ at: clock + seconds, fn });
    },
  };

  // --- the instruments, made on first use and kept --------------------------
  const made = new Map<InstrumentId, Instrument>();
  const get = (id: InstrumentId) => {
    let inst = made.get(id);
    if (!inst) {
      inst = MAKERS[id](fx);
      inst.layout(stage);
      made.set(id, inst);
    }
    return inst;
  };
  let currentId = first;
  let current = get(first);
  let enter = 0;
  let outgoing: { inst: Instrument; t: number; dir: number } | null = null;
  let hue: number = INSTRUMENT_HUE[first];
  let hueTarget: number = INSTRUMENT_HUE[first];
  const last = new Map<number, { x: number; y: number }>();

  const IN = reduced ? 0.25 : 0.8;
  const OUT = reduced ? 0.01 : 0.45;

  const hello = (id: InstrumentId) => {
    for (const [d, i] of signature(id)) {
      fx.later(d, () => {
        if (currentId === id) made.get(id)?.show(i);
      });
    }
  };

  api.current = {
    select(id) {
      if (id === currentId) {
        // A second tap on the lit toy just says hello again.
        hello(id);
        return;
      }
      current.reset();
      outgoing = { inst: current, t: 0, dir: Math.random() < 0.5 ? -1 : 1 };
      currentId = id;
      current = get(id);
      current.reset();
      enter = 0;
      hueTarget = INSTRUMENT_HUE[id];
      hello(id);
      // Confetti when it lands, not when it starts falling.
      fx.later(IN * 0.4, () => {
        if (currentId === id) fx.hit(stage.x + stage.w / 2, stage.y + stage.h * 0.55, hueTarget, 1.6, ["confetti", "star", "heart"]);
      });
    },
  };

  // --- the living background ------------------------------------------------
  const sprites = new Map<number, HTMLCanvasElement>();
  /** A soft bokeh disc per hue, painted once and stamped with drawImage. */
  const sprite = (h: number) => {
    let c = sprites.get(h);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = c.height = 96;
    const g = c.getContext("2d");
    if (g) {
      const rg = g.createRadialGradient(48, 48, 0, 48, 48, 48);
      rg.addColorStop(0, hsl(h, 100, 78, 0.9));
      rg.addColorStop(0.55, hsl(h, 100, 70, 0.55));
      rg.addColorStop(0.82, hsl(h, 100, 66, 0.28));
      rg.addColorStop(1, hsl(h, 100, 60, 0));
      g.fillStyle = rg;
      g.fillRect(0, 0, 96, 96);
    }
    sprites.set(h, c);
    return c;
  };
  let blobs: { x: number; y: number; r: number; hue: number; vy: number; ph: number; a: number }[] = [];
  let twinkles: Twinkle[] = [];

  const placeShelf = (L: RoomLayout) => {
    const el = shelf.current;
    if (!el) return;
    const s = el.style;
    s.left = `${L.shelf.x}px`;
    s.top = `${L.shelf.y}px`;
    s.width = `${L.shelf.w}px`;
    s.height = `${L.shelf.h}px`;
    s.bottom = "auto";
    s.transform = "none";
    s.setProperty("--bns-pr-btn", `${L.shelf.btn}px`);
    s.setProperty("--bns-pr-cols", String(L.shelf.cols));
    s.setProperty("--bns-pr-gap", `${L.shelf.gap}px`);
    s.setProperty("--bns-pr-pad", `${L.shelf.pad}px`);
    el.classList.toggle("is-grid", L.shelf.cols < INSTRUMENTS.length);
  };

  return {
    resize(w, h) {
      W = w;
      H = h;
      const L = roomLayout(w, h);
      stage = L.stage;
      placeShelf(L);
      for (const inst of made.values()) inst.layout(stage);
      const scale = Math.min(w, h) / 700 + 0.5;
      blobs = Array.from({ length: 14 }, () => ({
        x: rand(0, w),
        y: rand(0, h),
        r: rand(40, 120) * scale,
        hue: pick(CANDY),
        vy: -rand(6, 18),
        ph: rand(0, TAU),
        a: rand(0.06, 0.15),
      }));
      twinkles = makeTwinkles(w, h, 0.00008);
    },
    frame(ctx, dt, t) {
      clock += dt;
      for (let i = timers.length - 1; i >= 0; i--) {
        if (timers[i].at <= clock) {
          const fn = timers[i].fn;
          timers.splice(i, 1);
          fn();
        }
      }

      // Background: a wash in the instrument's colour, drifting bokeh, stars.
      let dh = ((hueTarget - hue + 540) % 360) - 180;
      if (Math.abs(dh) < 0.5) dh = 0;
      hue = (hue + dh * (1 - Math.exp(-dt * 3)) + 360) % 360;
      ctx.clearRect(0, 0, W, H);
      const wash = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.75);
      wash.addColorStop(0, hsl(hue, 70, 30, 0.5));
      wash.addColorStop(0.6, hsl(hue + 30, 60, 16, 0.22));
      wash.addColorStop(1, hsl(hue, 50, 10, 0));
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, W, H);
      drawTwinkles(ctx, twinkles, reduced ? 0 : t, 0.45);
      for (const b of blobs) {
        let x = b.x;
        if (!reduced) {
          b.y += b.vy * dt;
          if (b.y < -b.r) {
            b.y = H + b.r;
            b.x = rand(0, W);
          }
          x += Math.sin(t * 0.3 + b.ph) * 24;
        }
        ctx.globalAlpha = b.a;
        ctx.drawImage(sprite(b.hue), x - b.r, b.y - b.r, b.r * 2, b.r * 2);
      }
      ctx.globalAlpha = 1;

      // Instruments: the old one falls away, the new one bounces in.
      const cx = stage.x + stage.w / 2;
      const base = stage.y + stage.h;
      if (outgoing) {
        outgoing.t += dt;
        const p = outgoing.t / OUT;
        if (p >= 1) outgoing = null;
        else {
          ctx.save();
          ctx.translate(cx, base + p * p * (H - stage.y + 40));
          ctx.rotate(outgoing.dir * p * 0.35);
          ctx.scale(1 - p * 0.3, 1 - p * 0.3);
          ctx.translate(-cx, -base);
          outgoing.inst.draw(ctx, dt, t);
          ctx.restore();
        }
      }
      enter = Math.min(IN, enter + dt);
      const e = enter / IN;
      if (e < 1) {
        ctx.save();
        if (reduced) {
          const k = 0.92 + 0.08 * e;
          ctx.translate(cx, base);
          ctx.scale(k, k);
          ctx.translate(-cx, -base);
        } else {
          const k = easeOutBack(e, 2.1);
          const over = Math.max(0, k - 1);
          ctx.translate(cx, base + (1 - Math.min(k, 1)) * -(stage.y + stage.h) + over * stage.h * 0.35);
          // Squash on landing: wider and shorter for the instant it overshoots.
          ctx.scale(1 + over * 0.9, 1 - over * 0.9);
          ctx.translate(-cx, -base);
        }
        current.draw(ctx, dt, t);
        ctx.restore();
      } else {
        current.draw(ctx, dt, t);
      }

      // Hit rings, sparks and rising notes, over everything.
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.life -= dt;
        if (r.life <= 0) {
          rings.splice(i, 1);
          continue;
        }
        const k = 1 - r.life / 0.5;
        if (k < 0.35) glow(ctx, r.x, r.y, r.r * 0.9, hsl(r.hue, 100, 78), (0.35 - k) * 1.8);
        ctx.strokeStyle = hsl(r.hue, 100, 80, (1 - k) * 0.75);
        ctx.lineWidth = 1 + 6 * (1 - k);
        circle(ctx, r.x, r.y, r.r * (0.3 + k));
        ctx.stroke();
      }
      particles.update(dt);
      particles.draw(ctx);
      for (let i = glyphs.length - 1; i >= 0; i--) {
        const g = glyphs[i];
        g.life -= dt;
        if (g.life <= 0) {
          glyphs.splice(i, 1);
          continue;
        }
        const age = g.max - g.life;
        g.x += (g.vx + Math.sin(age * 4 + g.rot * 10) * 30) * dt;
        g.y += g.vy * dt;
        const pop = age < 0.18 ? easeOutBack(age / 0.18) : 1;
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(g.rot + Math.sin(age * 3) * 0.15);
        ctx.scale(pop, pop);
        ctx.globalAlpha = Math.min(1, g.life / 0.5);
        ctx.fillStyle = hsl(g.hue, 95, 70);
        noteShape(ctx, g.s, g.kind);
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.beginPath();
        ctx.ellipse(-g.s * 0.18, -g.s * 0.12, g.s * 0.18, g.s * 0.1, -0.4, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    },
    down(p) {
      last.set(p.id, { x: p.x, y: p.y });
      current.down(p);
    },
    move(p) {
      const l = last.get(p.id) ?? { x: p.x, y: p.y };
      current.move(p, l.x, l.y);
      last.set(p.id, { x: p.x, y: p.y });
    },
    up(p) {
      last.delete(p.id);
      current.up(p);
    },
    dispose() {
      api.current = null;
    },
  };
}

// --- the shelf -----------------------------------------------------------------

/** The pictures on the shelf buttons: small drawings, never words or emoji. */
function ToyArt({ id }: { id: InstrumentId }) {
  switch (id) {
    case "piano":
      return (
        <svg viewBox="0 0 64 64" aria-hidden>
          <rect x="5" y="13" width="54" height="41" rx="9" fill="#2b1650" />
          <rect x="5" y="13" width="54" height="14" rx="9" fill="#5a36a0" />
          <rect x="9" y="26" width="46" height="2.6" rx="1.3" fill="#f5c451" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <g key={i}>
              <circle cx={12.8 + i * 7.6} cy={20} r={1.8} fill={`hsl(${noteHue(i, 6)} 95% 70%)`} />
              <rect x={9.6 + i * 7.6} y={31} width={6.4} height={19} rx={2.2} fill={`hsl(${noteHue(i, 6)} 95% 63%)`} />
              <rect x={10.8 + i * 7.6} y={33} width={1.4} height={9} rx={0.7} fill="#fff" opacity={0.55} />
            </g>
          ))}
        </svg>
      );
    case "xylophone":
      return (
        <svg viewBox="0 0 64 64" aria-hidden>
          <path d="M7 21 L57 28" stroke="#8a5428" strokeWidth="4.5" strokeLinecap="round" />
          <path d="M7 45 L57 38" stroke="#8a5428" strokeWidth="4.5" strokeLinecap="round" />
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const h = 36 - i * 4.4;
            return (
              <g key={i}>
                <rect x={9 + i * 8} y={33 - h / 2} width={6.6} height={h} rx={2.6} fill={`hsl(${noteHue(i, 6)} 95% 62%)`} />
                <rect x={10.3 + i * 8} y={35 - h / 2} width={1.4} height={h - 6} rx={0.7} fill="#fff" opacity={0.5} />
              </g>
            );
          })}
          <path d="M36 61 L52 47" stroke="#f3dcae" strokeWidth="3" strokeLinecap="round" />
          <circle cx="53.5" cy="45.5" r="5" fill="#ff4f7b" />
          <circle cx="52" cy="44" r="1.6" fill="#fff" opacity={0.8} />
        </svg>
      );
    case "drums":
      return (
        <svg viewBox="0 0 64 64" aria-hidden>
          <path d="M47 14 V32" stroke="#c9d0dc" strokeWidth="2" />
          <ellipse cx="47" cy="13" rx="14" ry="3.6" fill="#f6c945" />
          <ellipse cx="44" cy="12.2" rx="6" ry="1.2" fill="#fff6c0" />
          <path d="M9 32 V47 A23 7.5 0 0 0 55 47 V32 Z" fill="hsl(350 85% 55%)" />
          <rect x="15" y="34" width="3" height="11" rx="1.5" fill="#e3e8f0" />
          <rect x="30.5" y="36" width="3" height="11" rx="1.5" fill="#e3e8f0" />
          <rect x="46" y="34" width="3" height="11" rx="1.5" fill="#e3e8f0" />
          <ellipse cx="32" cy="32" rx="23" ry="7.5" fill="#fff6e8" stroke="#c9d0dc" strokeWidth="2" />
          <path d="M13 6 L29 27" stroke="#f3dcae" strokeWidth="3" strokeLinecap="round" />
          <path d="M51 6 L35 27" stroke="#f3dcae" strokeWidth="3" strokeLinecap="round" />
          <circle cx="13" cy="6" r="2.4" fill="#f3dcae" />
          <circle cx="51" cy="6" r="2.4" fill="#f3dcae" />
        </svg>
      );
    case "harp":
      return (
        <svg viewBox="0 0 64 64" aria-hidden>
          <path d="M14 57 L55 21 L58 25 L22 59 Z" fill="hsl(330 62% 52%)" />
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const x = 20 + i * 6;
            const top = [12, 11.5, 12, 13.5, 15.5, 18][i];
            const bot = 56.5 - (x - 14) * 0.88;
            return <path key={i} d={`M${x} ${top} V${bot}`} stroke={`hsl(${noteHue(i, 6)} 95% 70%)`} strokeWidth="1.8" />;
          })}
          <rect x="9.5" y="10" width="6" height="47" rx="3" fill="#f2b84b" />
          <path d="M12 12 C 24 5, 40 18, 55 19" stroke="#f2b84b" strokeWidth="6" fill="none" strokeLinecap="round" />
          <circle cx="12.5" cy="9" r="4" fill="#ff7aa8" />
          <circle cx="11.3" cy="7.8" r="1.3" fill="#fff" opacity={0.8} />
        </svg>
      );
    case "bells":
      return (
        <svg viewBox="0 0 64 64" aria-hidden>
          <defs>
            <linearGradient id="bns-pr-bell-gold" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#b06f12" />
              <stop offset="0.35" stopColor="#ffe58c" />
              <stop offset="0.6" stopColor="#f2b23a" />
              <stop offset="1" stopColor="#9a5c0c" />
            </linearGradient>
          </defs>
          <path d="M32 3 V12" stroke="#ff7aa8" strokeWidth="3" strokeLinecap="round" />
          <circle cx="32" cy="11" r="3" fill="none" stroke="#f6c945" strokeWidth="2.5" />
          <path
            d="M32 13 C 22 13, 20 22, 20 31 C 20 40, 16 43, 12 47 L 52 47 C 48 43, 44 40, 44 31 C 44 22, 42 13, 32 13 Z"
            fill="url(#bns-pr-bell-gold)"
          />
          <ellipse cx="32" cy="47" rx="20" ry="4" fill="#7a4608" />
          <circle cx="32" cy="52" r="5" fill="#ff7aa8" />
          <circle cx="30.5" cy="50.5" r="1.5" fill="#fff" opacity={0.8} />
          <path d="M25 19 C 23 25, 23 32, 22 38" stroke="#fff" strokeOpacity="0.65" strokeWidth="3" strokeLinecap="round" fill="none" />
        </svg>
      );
    case "bongos":
      return (
        <svg viewBox="0 0 64 64" aria-hidden>
          <rect x="29" y="38" width="9" height="7" rx="2" fill="#6e3d1b" />
          <path d="M5 27 V43 A14 5 0 0 0 33 43 V27 Z" fill="#b8692e" />
          <rect x="5" y="33" width="28" height="4" fill="hsl(135 70% 48%)" />
          <ellipse cx="19" cy="27" rx="14" ry="5" fill="#f6e2b8" stroke="#5e3416" strokeWidth="1.6" />
          <path d="M36 33 V46 A11 4 0 0 0 58 46 V33 Z" fill="#a85e27" />
          <rect x="36" y="38" width="22" height="3.5" fill="hsl(52 95% 55%)" />
          <ellipse cx="47" cy="33" rx="11" ry="4" fill="#f6e2b8" stroke="#5e3416" strokeWidth="1.6" />
          <ellipse cx="15" cy="25.6" rx="5" ry="1.3" fill="#fff" opacity={0.7} />
          <ellipse cx="44" cy="31.8" rx="4" ry="1" fill="#fff" opacity={0.7} />
        </svg>
      );
  }
}

function readSaved(): InstrumentId {
  try {
    const v = window.localStorage.getItem(INSTRUMENT_KEY);
    if (isInstrumentId(v)) return v;
  } catch {
    // Private mode or storage blocked: the piano is a fine place to start.
  }
  return DEFAULT_INSTRUMENT;
}

export function Playroom() {
  const [sel, setSel] = useState<InstrumentId>(readSaved);
  const api = useRef<PlayroomApi | null>(null);
  const shelf = useRef<HTMLDivElement | null>(null);
  const first = useRef(sel);

  // Made once: GameCanvas keeps the first factory, and the room is a world.
  const create = useCallback((env: GameEnv) => createRoom(env, first.current, api, shelf), []);

  const choose = (id: InstrumentId, e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    // The press itself: a squash and spring on the toy, before anything else.
    const disc = e.currentTarget.firstElementChild as HTMLElement | null;
    disc?.animate?.(
      [{ transform: "scale(0.82)" }, { transform: "scale(1.16)" }, { transform: "scale(1)" }],
      { duration: 420, easing: "cubic-bezier(0.2, 1.5, 0.4, 1)" },
    );
    api.current?.select(id);
    setSel(id);
    try {
      window.localStorage.setItem(INSTRUMENT_KEY, id);
    } catch {
      // Not remembered this time; nothing a baby would notice.
    }
  };

  return (
    <div className="bns-game bns-pr">
      <GameCanvas create={create} />
      <div ref={shelf} className="bns-pr-shelf" aria-hidden>
        {INSTRUMENTS.map((id) => (
          <button
            key={id}
            type="button"
            tabIndex={-1}
            aria-hidden
            className={`bns-pr-toy ${sel === id ? "is-on" : ""}`}
            style={{ ["--h" as string]: INSTRUMENT_HUE[id] }}
            onPointerDown={(e) => choose(id, e)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="bns-pr-toy__disc">
              <ToyArt id={id} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
