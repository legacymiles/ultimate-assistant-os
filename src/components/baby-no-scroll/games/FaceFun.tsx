"use client";

// ---------------------------------------------------------------------------
// Silly faces — the front camera as a magic mirror.
//
// Babies are fascinated by faces, their own most of all; a mirror is the oldest
// baby toy there is. This one puts puppy ears, a crown or a lion's mane on the
// face it sees, and the stickers follow the head: tilt it and the crown tilts,
// open your mouth and the puppy sticks its tongue out.
//
//   swipe left / right   next / previous lens, Snapchat-style carousel
//   tap                  a burst of the lens's own sparkles and a giggle
//   open your mouth      the lens's party trick (tongue, rainbow, hearts…)
//
// Two layers, so the stickers can never drift off the face:
//
//   1. jeeliz FaceFilter (npm "facefilter", Apache-2.0) owns the camera, runs
//      the face tracker on the GPU, and draws the camera picture into its own
//      WebGL canvas with its own crop — mirrored with CSS.
//   2. A transparent GameCanvas above it draws the stickers in the SAME
//      viewport, from the tracker's numbers (see lib/baby-no-scroll/faceLenses).
//
// The picture never leaves the device: nothing is recorded, saved or sent.
//
// No camera — blocked, missing, or a browser without WebGL — is not a dead
// end: a cartoon buddy wears the lenses instead, and every gesture still works.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { GameCanvas, type CanvasGame, type GameEnv } from "./GameCanvas";
import {
  LENSES,
  SEEN_AT,
  gestureOf,
  smooth,
  stepLens,
  toScreen,
  type Detect,
  type FacePose,
  type LensId,
} from "@/lib/baby-no-scroll/faceLenses";
import { Particles, TAU, easeOutBack, heart, hsl, rand, spring, star, type ParticleShape } from "@/lib/baby-no-scroll/fx";
import { audio, noise, note, tone } from "@/lib/baby-no-scroll/audio";
import type { JeelizFaceFilter } from "facefilter/dist/jeelizFaceFilter.moduleES6.js";

type CameraMode = "starting" | "on" | "off";

interface Shared {
  mode: CameraMode;
  detect: Detect | null;
}

const CAM_ID = "bns-face-cam";
const LENS_KEY = "baby-no-scroll:lens";

// --- sound ---------------------------------------------------------------------

function voice(id: LensId) {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime;
  const sweep = (type: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0) => {
    const o = a.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t + delay);
    o.frequency.exponentialRampToValueAtTime(f1, t + delay + dur);
    const g = a.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + delay);
    g.gain.linearRampToValueAtTime(gain, t + delay + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
    o.connect(g).connect(a.out);
    o.start(t + delay);
    o.stop(t + delay + dur + 0.05);
  };
  switch (id) {
    case "puppy":
      sweep("sawtooth", 520, 300, 0.12, 0.12);
      sweep("sawtooth", 560, 320, 0.12, 0.1, 0.18);
      break;
    case "bunny":
      sweep("sine", 300, 900, 0.18, 0.2);
      sweep("sine", 900, 400, 0.2, 0.12, 0.16);
      break;
    case "kitty":
      sweep("triangle", 600, 950, 0.18, 0.14);
      sweep("triangle", 950, 520, 0.32, 0.12, 0.16);
      break;
    case "bear":
      sweep("triangle", 160, 110, 0.4, 0.22);
      break;
    case "lion":
      noise(0.45, 700, 0.25);
      sweep("sawtooth", 140, 90, 0.45, 0.1);
      break;
    case "alien":
      for (let i = 0; i < 6; i++) sweep("sine", 700 + i * 90, 500 + i * 140, 0.09, 0.1, i * 0.07);
      break;
    case "crown":
      [0, 2, 4, 7].forEach((s, i) => note(s + 5, { type: "triangle", duration: 0.7, gain: 0.18, reverb: 0.5, delay: i * 0.09 }));
      break;
    case "hearts":
      tone(1046, { type: "sine", duration: 0.15, gain: 0.15 });
      tone(1318, { type: "sine", duration: 0.3, gain: 0.15, delay: 0.12 });
      break;
    case "flowers":
      [0, 4, 7].forEach((s, i) => note(s + 3, { type: "sine", duration: 1, gain: 0.15, reverb: 0.6, delay: i * 0.12 }));
      break;
    case "rainbow":
      for (let i = 0; i < 8; i++) note(i, { type: "triangle", duration: 0.5, gain: 0.12, reverb: 0.5, delay: i * 0.05 });
      break;
  }
}

function whoosh() {
  noise(0.22, 2400, 0.12, "bandpass");
}

function giggle() {
  for (let i = 0; i < 4; i++) tone(900 + rand(0, 400), { type: "sine", duration: 0.08, gain: 0.08, delay: i * 0.07 });
}

// --- painting ------------------------------------------------------------------

const PEACH = "#f6c7a1";

/** Every lens is drawn in face units: 1 = the tracker's face square, origin at its centre. */
function drawLens(ctx: CanvasRenderingContext2D, id: LensId, t: number, mouth: number, pop: number) {
  ctx.save();
  const s = 0.9 + 0.1 * pop;
  ctx.scale(s, s);
  switch (id) {
    case "puppy": {
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * 0.4, -0.42);
        ctx.rotate(side * (0.35 + Math.sin(t * 3 + side) * 0.06));
        ctx.fillStyle = "#8a5a35";
        ctx.beginPath();
        ctx.ellipse(side * 0.06, 0.2, 0.13, 0.27, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#c98b5e";
        ctx.beginPath();
        ctx.ellipse(side * 0.06, 0.24, 0.07, 0.19, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      // nose
      ctx.fillStyle = "#2a1a14";
      ctx.beginPath();
      ctx.ellipse(0, 0.05, 0.085, 0.06, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.ellipse(-0.03, 0.03, 0.025, 0.014, -0.4, 0, TAU);
      ctx.fill();
      // tongue
      const tl = 0.06 + mouth * 0.26;
      if (mouth > 0.15) {
        ctx.save();
        ctx.translate(0, 0.27);
        ctx.rotate(Math.sin(t * 9) * 0.15 * mouth);
        ctx.fillStyle = "#ff6f8e";
        ctx.beginPath();
        ctx.moveTo(-0.07, 0);
        ctx.lineTo(0.07, 0);
        ctx.quadraticCurveTo(0.08, tl, 0, tl + 0.02);
        ctx.quadraticCurveTo(-0.08, tl, -0.07, 0);
        ctx.fill();
        ctx.strokeStyle = "#e24d70";
        ctx.lineWidth = 0.008;
        ctx.beginPath();
        ctx.moveTo(0, 0.01);
        ctx.lineTo(0, tl * 0.8);
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case "bunny": {
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * 0.17, -0.5);
        ctx.rotate(side * 0.18 + Math.sin(t * 2.4 + side) * 0.05);
        ctx.fillStyle = "#fbf7f4";
        ctx.beginPath();
        ctx.ellipse(0, -0.3, 0.1, 0.34, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#ffb3c8";
        ctx.beginPath();
        ctx.ellipse(0, -0.28, 0.05, 0.26, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = "#ff8fb0";
      ctx.beginPath();
      ctx.moveTo(-0.045, 0.04);
      ctx.lineTo(0.045, 0.04);
      ctx.lineTo(0, 0.09);
      ctx.closePath();
      ctx.fill();
      whiskers(ctx, "#ffffff");
      // teeth
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#d9d0c7";
      ctx.lineWidth = 0.006;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.roundRect(side === -1 ? -0.042 : 0.002, 0.2 + mouth * 0.05, 0.04, 0.06, 0.01);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case "kitty": {
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * 0.3, -0.5);
        ctx.rotate(side * 0.25 + Math.sin(t * 4 + side) * 0.03);
        ctx.fillStyle = "#b47ae0";
        ctx.beginPath();
        ctx.moveTo(-0.13, 0.08);
        ctx.lineTo(0, -0.2);
        ctx.lineTo(0.13, 0.08);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#ffb3d9";
        ctx.beginPath();
        ctx.moveTo(-0.07, 0.05);
        ctx.lineTo(0, -0.11);
        ctx.lineTo(0.07, 0.05);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = "#ff7fb6";
      ctx.beginPath();
      ctx.moveTo(-0.04, 0.04);
      ctx.lineTo(0.04, 0.04);
      ctx.lineTo(0, 0.085);
      ctx.closePath();
      ctx.fill();
      whiskers(ctx, "#3b2a4a");
      blush(ctx, "rgba(255,120,170,0.35)");
      break;
    }
    case "bear": {
      for (const side of [-1, 1]) {
        ctx.fillStyle = "#7a4b2a";
        ctx.beginPath();
        ctx.arc(side * 0.36, -0.46, 0.13, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#c48a5c";
        ctx.beginPath();
        ctx.arc(side * 0.36, -0.46, 0.07, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(214,164,118,0.85)";
      ctx.beginPath();
      ctx.ellipse(0, 0.12, 0.17, 0.13, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#3a2516";
      ctx.beginPath();
      ctx.ellipse(0, 0.06, 0.07, 0.045, 0, 0, TAU);
      ctx.fill();
      break;
    }
    case "lion": {
      const spikes = 22;
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * TAU + Math.sin(t * 1.5 + i) * 0.02;
        const r0 = 0.5;
        const r1 = 0.78 + (i % 2) * 0.08;
        ctx.fillStyle = i % 2 ? "#e8892a" : "#c8641c";
        ctx.beginPath();
        ctx.moveTo(Math.cos(a - 0.16) * r0, Math.sin(a - 0.16) * r0 * 1.15);
        ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1 * 1.15);
        ctx.lineTo(Math.cos(a + 0.16) * r0, Math.sin(a + 0.16) * r0 * 1.15);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = "#5a3215";
      ctx.beginPath();
      ctx.moveTo(-0.06, 0.03);
      ctx.lineTo(0.06, 0.03);
      ctx.lineTo(0, 0.1);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "crown": {
      ctx.save();
      ctx.translate(0, -0.62);
      const g = ctx.createLinearGradient(0, -0.2, 0, 0.1);
      g.addColorStop(0, "#fff1a8");
      g.addColorStop(0.5, "#ffcc33");
      g.addColorStop(1, "#c98a0b");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-0.36, 0.1);
      ctx.lineTo(-0.38, -0.12);
      ctx.lineTo(-0.2, 0);
      ctx.lineTo(0, -0.22);
      ctx.lineTo(0.2, 0);
      ctx.lineTo(0.38, -0.12);
      ctx.lineTo(0.36, 0.1);
      ctx.closePath();
      ctx.fill();
      const gems = [
        [-0.2, 0.05, 330],
        [0, 0.05, 200],
        [0.2, 0.05, 140],
      ] as const;
      for (const [x, y, h] of gems) {
        ctx.fillStyle = hsl(h, 90, 55);
        ctx.beginPath();
        ctx.arc(x, y, 0.035, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.beginPath();
        ctx.arc(x - 0.01, y - 0.012, 0.01, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      for (let i = 0; i < 4; i++) {
        const a = t * 1.6 + (i / 4) * TAU;
        ctx.fillStyle = `rgba(255,236,150,${0.6 + 0.4 * Math.sin(t * 5 + i)})`;
        star(ctx, Math.cos(a) * 0.55, -0.62 + Math.sin(a) * 0.14, 0.045, 0.018, 4);
        ctx.fill();
      }
      break;
    }
    case "hearts": {
      for (const side of [-1, 1]) {
        ctx.fillStyle = "rgba(230,30,80,0.85)";
        heart(ctx, side * 0.19, -0.1, 0.24);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.beginPath();
        ctx.ellipse(side * 0.19 - 0.05, -0.15, 0.03, 0.015, -0.6, 0, TAU);
        ctx.fill();
      }
      ctx.strokeStyle = "#c0154a";
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      ctx.moveTo(-0.07, -0.12);
      ctx.quadraticCurveTo(0, -0.16, 0.07, -0.12);
      ctx.stroke();
      for (let i = 0; i < 5; i++) {
        const k = (t * 0.35 + i / 5) % 1;
        ctx.globalAlpha = Math.sin(k * Math.PI);
        ctx.fillStyle = hsl(340 + i * 6, 90, 65);
        heart(ctx, Math.sin(i * 2.1 + t) * 0.45, -0.5 - k * 0.5, 0.1);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case "flowers": {
      const n = 7;
      for (let i = 0; i < n; i++) {
        const a = Math.PI + 0.35 + (i / (n - 1)) * (Math.PI - 0.7);
        const x = Math.cos(a) * 0.46;
        const y = -0.12 + Math.sin(a) * 0.5;
        flower(ctx, x, y, 0.075, [330, 52, 200, 280, 15, 170, 300][i], t + i);
      }
      for (let i = 0; i < 2; i++) {
        const a = t * (0.9 + i * 0.3) + i * 3;
        butterfly(ctx, Math.cos(a) * 0.62, -0.4 + Math.sin(a * 1.3) * 0.25, 0.08, t * 14 + i, i ? 200 : 300);
      }
      break;
    }
    case "alien": {
      for (const side of [-1, 1]) {
        const bob = Math.sin(t * 4 + side) * 0.04;
        const tipX = side * 0.28 + bob;
        const tipY = -0.95;
        ctx.strokeStyle = "#5bd66a";
        ctx.lineWidth = 0.025;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(side * 0.12, -0.45);
        ctx.quadraticCurveTo(side * 0.3, -0.7, tipX, tipY);
        ctx.stroke();
        const g = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, 0.11);
        g.addColorStop(0, "#f4ffb0");
        g.addColorStop(0.4, "#9dff6a");
        g.addColorStop(1, "rgba(120,255,90,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(tipX, tipY, 0.11, 0, TAU);
        ctx.fill();
      }
      blush(ctx, "rgba(120,255,120,0.25)");
      break;
    }
    case "rainbow": {
      const bands = [0, 30, 55, 120, 200, 260];
      for (let i = 0; i < bands.length; i++) {
        ctx.strokeStyle = hsl(bands[i], 90, 62, 0.9);
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        ctx.arc(0, -0.25, 0.72 - i * 0.05, Math.PI * 1.08, Math.PI * 1.92);
        ctx.stroke();
      }
      blush(ctx, "rgba(255,150,200,0.35)");
      if (mouth > 0.2) {
        for (let i = 0; i < bands.length; i++) {
          ctx.strokeStyle = hsl(bands[i], 90, 62, 0.9);
          ctx.lineWidth = 0.035 * mouth;
          ctx.beginPath();
          const x = (i - 2.5) * 0.03 * mouth;
          ctx.moveTo(x, 0.28);
          ctx.quadraticCurveTo(x + Math.sin(t * 6) * 0.06, 0.6, x * 2, 0.6 + mouth * 0.6);
          ctx.stroke();
        }
      }
      break;
    }
  }
  ctx.restore();
}

function whiskers(ctx: CanvasRenderingContext2D, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.008;
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(side * 0.07, 0.1 + i * 0.025);
      ctx.lineTo(side * 0.3, 0.07 + i * 0.06);
      ctx.stroke();
    }
  }
}

function blush(ctx: CanvasRenderingContext2D, color: string) {
  ctx.fillStyle = color;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 0.25, 0.1, 0.07, 0.045, 0, 0, TAU);
    ctx.fill();
  }
}

function flower(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, hue: number, t: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(t * 1.3) * 0.15);
  ctx.fillStyle = hsl(hue, 90, 70);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6, r * 0.5, r * 0.32, a, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = "#ffd84a";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.32, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function butterfly(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, flap: number, hue: number) {
  ctx.save();
  ctx.translate(x, y);
  const k = 0.4 + 0.6 * Math.abs(Math.sin(flap));
  ctx.fillStyle = hsl(hue, 85, 65);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * r * 0.5 * k, -r * 0.2, r * 0.55 * k, r * 0.45, 0, 0, TAU);
    ctx.ellipse(side * r * 0.4 * k, r * 0.3, r * 0.4 * k, r * 0.3, 0, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = "#3a2a3a";
  ctx.fillRect(-r * 0.05, -r * 0.45, r * 0.1, r * 0.9);
  ctx.restore();
}

/** The cartoon buddy who wears the lenses when there is no camera. */
function drawBuddy(ctx: CanvasRenderingContext2D, t: number, mouth: number, look: number) {
  // face
  const g = ctx.createRadialGradient(-0.15, -0.2, 0.05, 0, 0, 0.62);
  g.addColorStop(0, "#ffe2c8");
  g.addColorStop(1, "#f0b48a");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.5, 0.56, 0, 0, TAU);
  ctx.fill();
  // eyes, blinking
  const blink = Math.sin(t * 0.9) > 0.985 ? 0.15 : 1;
  for (const side of [-1, 1]) {
    ctx.fillStyle = "#2b1f2a";
    ctx.beginPath();
    ctx.ellipse(side * 0.18 + look * 0.03, -0.1, 0.065, 0.085 * blink, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(side * 0.18 + look * 0.03 - 0.02, -0.13, 0.022 * blink, 0, TAU);
    ctx.fill();
  }
  blush(ctx, "rgba(255,120,140,0.35)");
  // mouth
  ctx.fillStyle = "#7a2a3a";
  ctx.beginPath();
  if (mouth > 0.1) {
    ctx.ellipse(0, 0.27, 0.09, 0.03 + mouth * 0.09, 0, 0, TAU);
  } else {
    ctx.arc(0, 0.2, 0.11, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.lineTo(0, 0.25);
  }
  ctx.fill();
}

// --- the game ----------------------------------------------------------------------

function createFaceFun(env: GameEnv, shared: Shared): CanvasGame {
  let w = 0;
  let h = 0;
  let pose: FacePose | null = null;
  let lens = 0;
  try {
    const saved = Number(localStorage.getItem(LENS_KEY));
    if (Number.isInteger(saved) && saved >= 0 && saved < LENSES.length) lens = saved;
  } catch {}
  let pop = 1; // 0→1 entrance of a freshly picked lens
  let carousel = lens; // the strip's position in lens units, sprung toward `lens`
  let carouselV = 0;
  let dragDx = 0;
  let flash = 0;
  let buddyMouth = 0;
  let lastMouthBurst = 0;
  const parts = new Particles(500);
  const starts = new Map<number, { x: number; y: number }>();
  let clock = 0;

  const short = () => Math.min(w, h);
  const iconR = () => Math.max(24, Math.min(34, short() * 0.06));

  function pick(by: number) {
    lens = stepLens(lens, by);
    pop = 0;
    flash = 1;
    whoosh();
    voice(LENSES[lens].id);
    try {
      localStorage.setItem(LENS_KEY, String(lens));
    } catch {}
  }

  function sparkleAt(x: number, y: number, count = 18) {
    const hue = LENSES[lens].hue;
    const shapes: ParticleShape[] =
      LENSES[lens].id === "hearts" ? ["heart"] : LENSES[lens].id === "flowers" ? ["dot", "heart"] : ["star", "dot"];
    parts.burst(x, y, {
      count,
      speed: [80, 360],
      size: [3, 8],
      life: [0.6, 1.3],
      hues: [hue, (hue + 40) % 360, 52],
      shapes,
      gravity: 120,
    });
  }

  /** Where the stickers hang: the tracked face, or the buddy in the middle. */
  function anchor(): { cx: number; cy: number; size: number; roll: number; alpha: number; mouth: number } {
    if (shared.mode === "on" && pose && pose.seen > 0.02) {
      return { cx: pose.cx + pose.yaw * pose.size * 0.08, cy: pose.cy, size: pose.size, roll: pose.roll, alpha: pose.seen, mouth: pose.mouth };
    }
    const size = short() * 0.5;
    return {
      cx: w / 2,
      cy: h * 0.44 + Math.sin(clock * 1.6) * size * 0.03,
      size,
      roll: Math.sin(clock * 0.9) * 0.08,
      alpha: 1,
      mouth: buddyMouth,
    };
  }

  /**
   * Where the lens strip sits. The four corners belong to the parent's lock,
   * so on a wide screen the strip runs along the bottom BETWEEN the corners;
   * on a phone that gap holds one bubble, so the strip lifts just above the
   * corner band and uses the whole width instead.
   */
  function strip() {
    const r = iconR();
    const gap = r * 2.5;
    const between = w / 2 - 150 - r;
    if (between >= gap * 2) return { r, gap, half: between, cy: h - r - Math.max(28, h * 0.05) };
    return { r, gap, half: w / 2 - 16 - r, cy: h - 150 - r };
  }

  function drawCarousel(ctx: CanvasRenderingContext2D) {
    const { r, gap, half, cy } = strip();
    const visible = Math.max(1, Math.floor(half / gap));
    const offset = carousel - dragDx / gap;
    for (let k = -visible - 1; k <= visible + 1; k++) {
      const i = Math.round(offset) + k;
      const d = i - offset;
      if (Math.abs(d) * gap > half + 1) continue;
      const li = stepLens(i, 0);
      const x = w / 2 + d * gap;
      const near = Math.max(0, 1 - Math.abs(d));
      const rr = r * (0.8 + 0.45 * near);
      const fade = Math.max(0, 1 - (Math.abs(d) * gap) / (half + gap * 0.5));
      ctx.globalAlpha = 0.35 + 0.65 * fade;
      // bubble
      const g = ctx.createRadialGradient(x - rr * 0.3, cy - rr * 0.4, rr * 0.1, x, cy, rr);
      g.addColorStop(0, hsl(LENSES[li].hue, 90, 80));
      g.addColorStop(1, hsl(LENSES[li].hue, 75, 45));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, cy, rr, 0, TAU);
      ctx.fill();
      // a tiny buddy wearing the lens
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, cy, rr, 0, TAU);
      ctx.clip();
      ctx.translate(x, cy + rr * 0.15);
      ctx.scale(rr * 1.1, rr * 1.1);
      ctx.fillStyle = PEACH;
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.42, 0.46, 0, 0, TAU);
      ctx.fill();
      ctx.scale(0.8, 0.8);
      drawLens(ctx, LENSES[li].id, clock, 0, 1);
      ctx.restore();
      if (near > 0.6) {
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(x, cy, rr + 4, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  return {
    resize(nw, nh) {
      w = nw;
      h = nh;
    },

    frame(ctx, dt, t) {
      clock = t;
      ctx.clearRect(0, 0, w, h);

      // --- follow the face ---
      const d = shared.detect;
      if (shared.mode === "on" && d) {
        const seen = d.detected > SEEN_AT;
        pose = smooth(pose, toScreen(d, w, h, true), seen, dt);
        if (seen && pose.mouth > 0.55 && t - lastMouthBurst > 0.6) {
          lastMouthBurst = t;
          sparkleAt(pose.cx, pose.cy + pose.size * 0.3, 10);
        }
      }

      // --- no camera: the buddy's own world ---
      if (shared.mode !== "on") {
        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, hsl(LENSES[lens].hue, 60, 30));
        bg.addColorStop(1, hsl((LENSES[lens].hue + 50) % 360, 55, 16));
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        buddyMouth = Math.max(0, buddyMouth - dt * 1.6);
      }

      pop = Math.min(1, pop + dt * 3);
      [carousel, carouselV] = spring(carousel, carouselV, lens, dt, 160, 18);
      // Keep the strip's number from drifting a lap away from the lens it shows.
      if (Math.abs(carousel - lens) > LENSES.length / 2) carousel += Math.sign(lens - carousel) * LENSES.length;

      // --- the stickers ---
      const a = anchor();
      ctx.save();
      ctx.globalAlpha = a.alpha;
      ctx.translate(a.cx, a.cy);
      ctx.rotate(a.roll);
      ctx.scale(a.size, a.size);
      if (shared.mode !== "on") drawBuddy(ctx, t, a.mouth, Math.sin(t * 0.7));
      const ent = easeOutBack(pop);
      ctx.scale(ent, ent);
      drawLens(ctx, LENSES[lens].id, t, a.mouth, pop);
      ctx.restore();

      // --- no face in view: a soft pulsing ring where a face goes ---
      if (shared.mode === "on" && (!pose || pose.seen < 0.5)) {
        const r = short() * 0.28 * (1 + Math.sin(t * 2.4) * 0.03);
        ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - (pose?.seen ?? 0))})`;
        ctx.setLineDash([10, 12]);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(w / 2, h * 0.44, r * 0.82, r, 0, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      parts.update(dt);
      ctx.globalCompositeOperation = "lighter";
      parts.draw(ctx);
      ctx.globalCompositeOperation = "source-over";

      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flash * 0.35})`;
        ctx.fillRect(0, 0, w, h);
        flash = Math.max(0, flash - dt * 4);
      }

      drawCarousel(ctx);
    },

    down(p) {
      starts.set(p.id, { x: p.x, y: p.y });
    },

    move(p) {
      const s = starts.get(p.id);
      if (!s) return;
      // The strip follows a sideways drag, like a real lens carousel.
      dragDx = Math.max(-iconR() * 4, Math.min(iconR() * 4, p.x - s.x));
    },

    up(p) {
      const s = starts.get(p.id);
      starts.delete(p.id);
      dragDx = 0;
      if (!s) return;
      // p.held is wall-clock time since the finger went down. The frame clock
      // is not: on a phone busy tracking a face it lags, and a quick swipe
      // would read as a slow one and be ignored.
      const g = gestureOf(p.x - s.x, p.y - s.y, p.held, short());
      if (g === "next") pick(1);
      else if (g === "prev") pick(-1);
      else if (g === "tap") {
        // A tap on a carousel bubble picks that lens directly.
        const { r, gap, cy } = strip();
        if (Math.abs(p.y - cy) < r * 1.4 && Math.abs(p.x - w / 2) > r * 1.4) {
          pick(Math.round((p.x - w / 2) / gap));
          return;
        }
        sparkleAt(p.x, p.y);
        giggle();
        pop = Math.min(pop, 0.55);
        if (shared.mode !== "on") buddyMouth = 1;
      }
    },
  };
}

// --- the camera layer ---------------------------------------------------------------

export function FaceFun() {
  const shared = useRef<Shared>({ mode: "starting", detect: null });
  const cam = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = cam.current;
    if (!el) return;
    let cancelled = false;
    let jee: JeelizFaceFilter | null = null;
    const state = shared.current;

    const size = () => {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      el.width = Math.round(el.clientWidth * dpr);
      el.height = Math.round(el.clientHeight * dpr);
    };
    const onResize = () => {
      size();
      jee?.resize();
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        state.mode = "off";
        return;
      }
      try {
        // The tracker is its own chunk and its 3.7 MB network a static file
        // (public/baby-no-scroll/face/), so neither downloads until this game
        // is the one on — and the browser caches the network after that.
        const lib = await import("facefilter/dist/jeelizFaceFilter.moduleES6.js");
        if (cancelled) return;
        jee = lib.default.create_new();
        size();
        let draw: (() => void) | null = null;
        jee.init({
          canvasId: CAM_ID,
          NNCPath: "/baby-no-scroll/face/NN_DEFAULT.json",
          maxFacesDetected: 1,
          followZRot: true,
          animateDelay: 2,
          videoSettings: { facingMode: "user" },
          callbackReady(err, spec) {
            if (err || cancelled) {
              state.mode = "off";
              return;
            }
            draw = videoPainter(spec);
            state.mode = "on";
            el.dataset.on = "1";
          },
          callbackTrack(ds) {
            draw?.();
            const ex = ds.expressions;
            state.detect = {
              detected: ds.detected,
              x: ds.x,
              y: ds.y,
              s: ds.s,
              rx: ds.rx,
              ry: ds.ry,
              rz: ds.rz,
              mouth: ex && ex.length ? Number(ex[0]) : undefined,
            };
          },
        });
      } catch (err) {
        console.warn("[baby-no-scroll] face filter unavailable", err);
        state.mode = "off";
      }
    };

    void start();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      state.mode = "off";
      // Turn the camera light off, then free the GPU.
      const j = jee;
      if (j) void j.toggle_pause(true, true).catch(() => {}).finally(() => void j.destroy().catch(() => {}));
    };
  }, []);

  return (
    <div className="bns-game">
      <canvas id={CAM_ID} ref={cam} className="bns-face-cam" aria-hidden />
      <GameCanvas create={(env) => createFaceFun(env, shared.current)} />
    </div>
  );
}

/**
 * Draw the camera picture the way jeeliz's own Canvas2D helper does: its
 * full-screen triangle is still bound, so one draw call with its video texture
 * and crop matrix paints the picture in exactly the viewport the tracker used.
 */
function videoPainter(spec: {
  GL: WebGLRenderingContext;
  canvasElement: HTMLCanvasElement;
  videoTexture: WebGLTexture;
  videoTransformMat2: Float32Array | number[];
}): () => void {
  const gl = spec.GL;
  const compile = (src: string, type: number) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(
    prog,
    compile(
      "attribute vec2 position;uniform mat2 M;varying vec2 vUV;void main(void){gl_Position=vec4(position,0.,1.);vUV=vec2(.5,.5)+M*position;}",
      gl.VERTEX_SHADER,
    ),
  );
  gl.attachShader(
    prog,
    compile(
      "precision lowp float;uniform sampler2D S;varying vec2 vUV;void main(void){gl_FragColor=texture2D(S,vUV);}",
      gl.FRAGMENT_SHADER,
    ),
  );
  gl.bindAttribLocation(prog, 0, "position");
  gl.linkProgram(prog);
  const uM = gl.getUniformLocation(prog, "M");
  const uS = gl.getUniformLocation(prog, "S");
  return () => {
    const cv = spec.canvasElement;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.useProgram(prog);
    gl.uniform1i(uS, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, spec.videoTexture);
    gl.uniformMatrix2fv(uM, false, spec.videoTransformMat2);
    gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0);
  };
}
