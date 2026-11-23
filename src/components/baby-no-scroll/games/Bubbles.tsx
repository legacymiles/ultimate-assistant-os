"use client";

// ---------------------------------------------------------------------------
// Bubbles — soap bubbles under a bright sky of water.
//
// Two things a baby does here, and both always work:
//   - touch a bubble and it pops: a wet bloop, a spray of droplets, a ring
//     or two. Small bubbles bloop high, big ones bloop low, so the sound tells
//     the hand what it hit.
//   - touch anywhere else and a bubble is BLOWN from the finger. Holding still
//     blows it bigger; dragging leaves a stream of small ones behind the hand.
// So there is no "miss". The empty water is as much a toy as the bubbles.
//
// Why the drawing is done the way it is: a convincing soap bubble is a thin
// rainbow film, a window reflection and almost no body, which takes a conic
// gradient, a mask and several strokes. Doing that per bubble per frame on a
// cheap tablet is the frame budget gone. So it is painted ONCE into a sprite,
// and each bubble is two drawImage calls: the film (rotated slowly, which is
// what makes the colours swirl like a real film draining) and the reflection
// (never rotated, because a window reflection stays where the light is).
// ---------------------------------------------------------------------------

import { GameCanvas, type CanvasGame, type GameEnv, type GamePointer } from "./GameCanvas";
import { audio, noise, SCALE, tone } from "@/lib/baby-no-scroll/audio";
import { TAU, clamp, easeOutBack, rand } from "@/lib/baby-no-scroll/fx";

export function Bubbles() {
  return <GameCanvas create={createBubbles} />;
}

// --- sprites -------------------------------------------------------------------

/** Sprite canvas size and the bubble radius inside it (the rest is margin for the edge stroke). */
const SPRITE = 256;
const SPRITE_R = 120;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  return { c, g };
}

/** A rounded rectangle path, written out because ctx.roundRect is too new for older tablets. */
function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
}

/**
 * The film: a faint body, a rainbow band hugging the rim, a crisp edge.
 * The rainbow is a conic gradient masked to a ring — the colours of real soap
 * film are strongest where you look through it at a glancing angle, which is
 * the edge, and almost absent through the middle.
 */
function paintFilm(): HTMLCanvasElement {
  const { c, g } = canvas(SPRITE, SPRITE);
  const m = SPRITE / 2;
  const R = SPRITE_R;

  const body = g.createRadialGradient(m - R * 0.2, m - R * 0.25, R * 0.1, m, m, R);
  body.addColorStop(0, "rgba(255,255,255,0.03)");
  body.addColorStop(0.65, "rgba(210,240,255,0.07)");
  body.addColorStop(0.9, "rgba(255,255,255,0.16)");
  body.addColorStop(1, "rgba(255,255,255,0.4)");
  g.fillStyle = body;
  g.beginPath();
  g.arc(m, m, R, 0, TAU);
  g.fill();

  const film = canvas(SPRITE, SPRITE);
  const f = film.g;
  // Magenta, gold, green, cyan, violet: the bands an oil-on-water film makes.
  const bands = [300, 45, 150, 190, 270, 330, 60, 175, 220, 300];
  if (typeof f.createConicGradient === "function") {
    const cg = f.createConicGradient(0, m, m);
    bands.forEach((h, i) => cg.addColorStop(i / (bands.length - 1), `hsl(${h} 100% 68%)`));
    f.fillStyle = cg;
  } else {
    const lg = f.createLinearGradient(0, 0, SPRITE, SPRITE);
    bands.forEach((h, i) => lg.addColorStop(i / (bands.length - 1), `hsl(${h} 100% 68%)`));
    f.fillStyle = lg;
  }
  f.beginPath();
  f.arc(m, m, R, 0, TAU);
  f.fill();
  f.globalCompositeOperation = "destination-in";
  const mask = f.createRadialGradient(m, m, 0, m, m, R);
  mask.addColorStop(0, "rgba(0,0,0,0)");
  mask.addColorStop(0.5, "rgba(0,0,0,0.04)");
  mask.addColorStop(0.8, "rgba(0,0,0,0.4)");
  mask.addColorStop(0.95, "rgba(0,0,0,0.9)");
  mask.addColorStop(1, "rgba(0,0,0,0.6)");
  f.fillStyle = mask;
  f.fillRect(0, 0, SPRITE, SPRITE);
  g.globalAlpha = 0.8;
  g.drawImage(film.c, 0, 0);
  g.globalAlpha = 1;

  // A crisp white edge, and a faint dark line just inside it so the bubble
  // still has an outline against the brightest part of the sky.
  g.strokeStyle = "rgba(255,255,255,0.6)";
  g.lineWidth = 2.5;
  g.beginPath();
  g.arc(m, m, R - 1.2, 0, TAU);
  g.stroke();
  g.strokeStyle = "rgba(30,80,150,0.16)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(m, m, R - 4, 0, TAU);
  g.stroke();
  return c;
}

/** The reflection: a four-pane window top-left and a sliver of light bottom-right. */
function paintShine(): HTMLCanvasElement {
  const { c, g } = canvas(SPRITE, SPRITE);
  const m = SPRITE / 2;
  const R = SPRITE_R;

  g.save();
  g.translate(m - R * 0.45, m - R * 0.45);
  g.rotate(-0.72);
  const halo = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.42);
  halo.addColorStop(0, "rgba(255,255,255,0.35)");
  halo.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = halo;
  g.beginPath();
  g.ellipse(0, 0, R * 0.42, R * 0.28, 0, 0, TAU);
  g.fill();
  const pw = R * 0.16;
  const ph = R * 0.11;
  const gap = R * 0.03;
  g.fillStyle = "rgba(255,255,255,0.78)";
  g.beginPath();
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      // The panes are skewed narrower at the top, the way a window curves
      // across a sphere.
      const x = (i - 1) * (pw + gap) + gap / 2;
      const y = (j - 1) * (ph + gap) + gap / 2;
      roundRectPath(g, x + (j === 0 ? pw * 0.08 : 0), y, pw * (j === 0 ? 0.84 : 1), ph, R * 0.03);
    }
  }
  g.fill();
  g.restore();

  g.strokeStyle = "rgba(255,255,255,0.5)";
  g.lineWidth = R * 0.055;
  g.lineCap = "round";
  g.beginPath();
  g.arc(m, m, R * 0.8, Math.PI * 0.18, Math.PI * 0.42);
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.7)";
  g.beginPath();
  g.arc(m + R * 0.22, m + R * 0.72, R * 0.035, 0, TAU);
  g.fill();
  return c;
}

/** A bokeh disc: flat, a touch brighter at its rim, like an out-of-focus light. */
function paintBokeh(hue: number | null): HTMLCanvasElement {
  const { c, g } = canvas(96, 96);
  const col = (a: number) => (hue === null ? `rgba(255,255,255,${a})` : `hsl(${hue} 100% 80% / ${a})`);
  const gr = g.createRadialGradient(48, 48, 0, 48, 48, 46);
  gr.addColorStop(0, col(0.5));
  gr.addColorStop(0.8, col(0.62));
  gr.addColorStop(0.93, col(0.85));
  gr.addColorStop(1, col(0));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(48, 48, 46, 0, TAU);
  g.fill();
  return c;
}

/** One shaft of light coming down through the water. */
function paintRay(): HTMLCanvasElement {
  const { c, g } = canvas(64, 512);
  const across = g.createLinearGradient(0, 0, 64, 0);
  across.addColorStop(0, "rgba(255,255,255,0)");
  across.addColorStop(0.5, "rgba(255,255,255,1)");
  across.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = across;
  g.fillRect(0, 0, 64, 512);
  g.globalCompositeOperation = "destination-in";
  const down = g.createLinearGradient(0, 0, 0, 512);
  down.addColorStop(0, "rgba(0,0,0,1)");
  down.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = down;
  g.fillRect(0, 0, 64, 512);
  return c;
}

// --- sound ----------------------------------------------------------------------

/**
 * The bloop: a sine that drops fast, plus a whisper of filtered noise for the
 * wet. The starting pitch is a note of the pentatonic scale picked by size, so
 * a hand swiping through ten bubbles plays a little run instead of a clatter.
 */
function bloop(r: number, short: number, loud = 1): void {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime;
  const size = clamp(r / Math.max(120, short * 0.2), 0, 1);
  const idx = clamp(Math.round((1 - size) * 7), 0, 7);
  const f = SCALE[idx] * (size > 0.85 ? 1 : 2);

  const osc = a.ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(f * 1.3, t);
  osc.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.12);
  const env = a.ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(0.26 * loud, t + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
  osc.connect(env).connect(a.out);
  const send = a.ctx.createGain();
  send.gain.value = 0.22;
  env.connect(send).connect(a.room);
  osc.start(t);
  osc.stop(t + 0.2);

  noise(0.05, f * 2.5, 0.1 * loud, "bandpass");
}

/** A soft breathy puff with a quiet high note: the sound of blowing a bubble. */
function puff(x: number, w: number, loud = 1): void {
  noise(0.14, 1100, 0.05 * loud, "lowpass");
  const idx = clamp(Math.floor((x / Math.max(1, w)) * 8), 0, 7);
  tone(SCALE[idx] * 2, { type: "sine", duration: 0.35, gain: 0.05 * loud, attack: 0.03, reverb: 0.4 });
}

// --- the game -------------------------------------------------------------------

interface Bubble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Full-grown radius. The drawn one eases up to it from birth. */
  r: number;
  age: number;
  /** Rotation of the film, which is what swirls the colours. */
  spin: number;
  spinV: number;
  /** Squash-and-stretch spring and the axis it acts along. */
  sq: number;
  sqv: number;
  axis: number;
  phase: number;
  driftHz: number;
  giant: boolean;
  /** Pointer id while it is still being blown on a fingertip. */
  held: number | null;
  /** Seconds it cannot be popped by a passing finger (so a stream is not popped by the hand that blew it). */
  safe: number;
}

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
}

interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  max: number;
  width: number;
}

interface Bokeh {
  x: number;
  y: number;
  r: number;
  a: number;
  vy: number;
  phase: number;
  sprite: number;
}

interface Finger {
  x: number;
  y: number;
  vx: number;
  vy: number;
  at: number;
  /** Distance dragged since the last stream bubble. */
  travel: number;
  sx: number;
  sy: number;
  blowing: Bubble | null;
}

const MAX_BUBBLES = 44;
const MAX_DROPS = 480;
const MAX_RINGS = 60;

function createBubbles(env: GameEnv): CanvasGame {
  const reduced = env.reduced;
  const film = paintFilm();
  const shine = paintShine();
  const bokehSprites = [paintBokeh(null), paintBokeh(190), paintBokeh(320)];
  const ray = paintRay();

  let W = 0;
  let H = 0;
  let short = 400;
  let bg: HTMLCanvasElement | null = null;
  const bubbles: Bubble[] = [];
  const drops: Drop[] = [];
  const rings: Ring[] = [];
  const bokeh: Bokeh[] = [];
  const fingers = new Map<number, Finger>();
  let spawnIn = 0;
  let giantIn = rand(8, 14);
  let lastBloop = 0;
  let lastPuff = 0;
  let clock = 0;

  const ambient = reduced ? 5 : 8;

  /** The sky: bright where the light comes in at the top, deep blue below. Painted once per size. */
  const paintBackground = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { c, g } = canvas(W * dpr, H * dpr);
    g.scale(dpr, dpr);
    const lg = g.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, "#a6ecff");
    lg.addColorStop(0.35, "#5cc0f0");
    lg.addColorStop(0.75, "#2f7fd6");
    lg.addColorStop(1, "#2350b4");
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);
    const sun = g.createRadialGradient(W * 0.5, -H * 0.1, 0, W * 0.5, -H * 0.1, Math.max(W, H) * 0.75);
    sun.addColorStop(0, "rgba(255,255,240,0.55)");
    sun.addColorStop(1, "rgba(255,255,240,0)");
    g.fillStyle = sun;
    g.fillRect(0, 0, W, H);
    // A cool pink haze low on one side: the background is not a flat wash.
    const haze = g.createRadialGradient(W * 0.15, H * 1.05, 0, W * 0.15, H * 1.05, Math.max(W, H) * 0.6);
    haze.addColorStop(0, "rgba(255,150,220,0.3)");
    haze.addColorStop(1, "rgba(255,150,220,0)");
    g.fillStyle = haze;
    g.fillRect(0, 0, W, H);
    bg = c;
  };

  const makeBubble = (x: number, y: number, r: number, giant = false): Bubble => ({
    x,
    y,
    vx: rand(-15, 15),
    vy: rand(-30, -10),
    r,
    age: 0,
    spin: Math.random() * TAU,
    spinV: rand(-0.4, 0.4) || 0.2,
    sq: 0,
    sqv: 0,
    axis: Math.random() * TAU,
    phase: Math.random() * TAU,
    driftHz: rand(0.25, 0.6),
    giant,
    held: null,
    safe: 0,
  });

  /** Room for one more: the oldest free-floating bubble quietly pops to make it. */
  const makeRoom = () => {
    if (bubbles.length < MAX_BUBBLES) return;
    let oldest = -1;
    for (let i = 0; i < bubbles.length; i++) {
      if (bubbles[i].held === null && (oldest < 0 || bubbles[i].age > bubbles[oldest].age)) oldest = i;
    }
    if (oldest >= 0) popAt(oldest, false);
  };

  const add = (b: Bubble) => {
    makeRoom();
    bubbles.push(b);
  };

  const spawnAmbient = (below: boolean) => {
    let giant = false;
    if (below && giantIn <= 0 && !bubbles.some((b) => b.giant)) {
      giant = true;
      giantIn = rand(14, 22);
    }
    const r = giant ? clamp(short * 0.2, 80, 170) : clamp(short * rand(0.05, 0.11), 22, 90);
    const x = rand(Math.min(W * 0.15, 140), Math.max(W * 0.85, W - 140));
    const y = below ? H + r * 1.2 : rand(H * 0.2, H * 0.9);
    const b = makeBubble(x, y, r, giant);
    // The first handful arrive already full-grown; the rest grow in from below.
    if (!below) b.age = 1;
    add(b);
  };

  const spray = (x: number, y: number, r: number, loud: boolean) => {
    const n = clamp(Math.round(10 + r * 0.35), 10, 60);
    const push = Math.sqrt(r / 50);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = rand(70, 240) * push;
      const life = rand(0.45, 0.9);
      const d: Drop = {
        x: x + Math.cos(a) * r * rand(0.75, 1),
        y: y + Math.sin(a) * r * rand(0.75, 1),
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - rand(40, 120),
        life,
        max: life,
        r: rand(1.3, 3.4) * (r > 80 ? 1.4 : 1),
      };
      if (drops.length < MAX_DROPS) drops.push(d);
      else drops[(Math.random() * MAX_DROPS) | 0] = d;
    }
    // The film snapping back: one fast bright ring at the bubble's edge.
    if (rings.length < MAX_RINGS) rings.push({ x, y, r0: r, r1: r * 1.3, life: 0.2, max: 0.2, width: 3 });
    const tiny = loud ? 3 : 1;
    for (let i = 0; i < tiny && rings.length < MAX_RINGS; i++) {
      const a = Math.random() * TAU;
      const life = rand(0.35, 0.6);
      rings.push({
        x: x + Math.cos(a) * r * 0.7,
        y: y + Math.sin(a) * r * 0.7,
        r0: 2,
        r1: rand(10, 20),
        life,
        max: life,
        width: 1.6,
      });
    }
  };

  function popAt(i: number, loud = true) {
    const b = bubbles[i];
    bubbles.splice(i, 1);
    for (const f of fingers.values()) if (f.blowing === b) f.blowing = null;
    const r = drawnRadius(b);
    spray(b.x, b.y, r, loud);
    if (loud && clock - lastBloop > 0.035) {
      lastBloop = clock;
      bloop(r, short, b.giant ? 1.2 : 1);
    }
    // The giant one is a surprise inside a surprise: it pops into a family.
    if (b.giant) {
      const kids = Math.floor(rand(4, 7));
      for (let k = 0; k < kids; k++) {
        const a = (k / kids) * TAU + rand(-0.3, 0.3);
        const kid = makeBubble(b.x + Math.cos(a) * r * 0.35, b.y + Math.sin(a) * r * 0.35, r * rand(0.28, 0.42));
        kid.vx = Math.cos(a) * rand(110, 220);
        kid.vy = Math.sin(a) * rand(110, 220) - 40;
        kid.age = 0.12;
        kid.safe = 0.4;
        add(kid);
      }
    }
  }

  const drawnRadius = (b: Bubble) => b.r * (b.age >= 0.4 ? 1 : Math.max(0.05, easeOutBack(b.age / 0.4)));

  /** The bubble under a fingertip, forgiving: a baby's touch lands near, not on. */
  const hit = (x: number, y: number, ignoreSafe: boolean): number => {
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      if (!ignoreSafe && (b.safe > 0 || b.held !== null)) continue;
      const r = drawnRadius(b);
      const d = Math.hypot(b.x - x, b.y - y);
      if (d > r * 1.15 + 14) continue;
      const score = d / r;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  };

  const blow = (f: Finger, x: number, y: number) => {
    const b = makeBubble(x, y, clamp(short * 0.06, 24, 50));
    b.held = -1;
    b.safe = 0.3;
    add(b);
    f.blowing = b;
    if (clock - lastPuff > 0.08) {
      lastPuff = clock;
      puff(x, W);
    }
  };

  const release = (f: Finger) => {
    const b = f.blowing;
    if (!b) return;
    b.held = null;
    b.vx = clamp(f.vx * 0.3, -300, 300);
    b.vy = clamp(f.vy * 0.3, -300, 200) - 40;
    b.safe = 0.35;
    b.sqv += 2.5;
    f.blowing = null;
  };

  return {
    resize(w, h) {
      const first = W === 0;
      W = w;
      H = h;
      short = Math.min(w, h);
      paintBackground();
      if (first) {
        for (let i = 0; i < ambient; i++) spawnAmbient(false);
        const n = reduced ? 8 : 14;
        for (let i = 0; i < n; i++) {
          bokeh.push({
            x: Math.random() * w,
            y: Math.random() * h,
            r: rand(18, 70),
            a: rand(0.08, 0.22),
            vy: rand(4, 14),
            phase: Math.random() * TAU,
            sprite: Math.floor(Math.random() * 3),
          });
        }
      }
      for (const b of bubbles) b.x = clamp(b.x, 0, w);
    },

    frame(ctx, dt, t, w, h) {
      clock = t;
      // --- update -----------------------------------------------------------
      for (const f of fingers.values()) {
        const b = f.blowing;
        if (!b) continue;
        // Holding still blows the bubble bigger, up to about a quarter of the screen.
        b.r = Math.min(b.r + dt * short * 0.09, clamp(short * 0.22, 60, 180));
        b.x += (f.x - b.x) * Math.min(1, dt * 20);
        b.y += (f.y - b.r * 0.55 - b.y) * Math.min(1, dt * 20);
      }

      const calm = reduced ? 0.55 : 1;
      for (const b of bubbles) {
        b.age += dt;
        b.safe = Math.max(0, b.safe - dt);
        b.spin += b.spinV * dt;
        // The wobble: a soft spring, plus a slow breath so even a lone bubble
        // never looks frozen.
        b.sqv += (-90 * b.sq - 3.2 * b.sqv) * dt;
        b.sq = clamp(b.sq + b.sqv * dt, -0.22, 0.22);
        if (b.held !== null) continue;
        // Buoyancy: ease toward a gentle terminal rise. Big ones are lazier.
        const rise = -(b.giant ? 20 : 26 + 900 / (b.r + 30)) * calm;
        b.vy += (rise - b.vy) * (1 - Math.pow(0.35, dt));
        b.vx += Math.sin(t * b.driftHz * TAU + b.phase) * 22 * calm * dt;
        b.vx *= Math.pow(0.55, dt);
        // Soft side walls, so bubbles drift back on screen instead of hugging an edge.
        if (b.x < b.r * 0.6) b.vx += (b.r * 0.6 - b.x) * 3 * dt;
        if (b.x > w - b.r * 0.6) b.vx -= (b.x - (w - b.r * 0.6)) * 3 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      }

      // Soft bumps between bubbles: push apart and set both wobbling.
      for (let i = 0; i < bubbles.length; i++) {
        const a = bubbles[i];
        const ra = drawnRadius(a);
        for (let j = i + 1; j < bubbles.length; j++) {
          const b = bubbles[j];
          const rb = drawnRadius(b);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const min = (ra + rb) * 0.92;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min || d2 < 0.0001) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const over = min - d;
          const ma = a.held !== null ? 0 : 1 / (ra * ra);
          const mb = b.held !== null ? 0 : 1 / (rb * rb);
          const sum = ma + mb || 1;
          a.x -= nx * over * (ma / sum);
          a.y -= ny * over * (ma / sum);
          b.x += nx * over * (mb / sum);
          b.y += ny * over * (mb / sum);
          const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (vn < 0) {
            const j2 = (-1.5 * vn) / sum;
            a.vx -= nx * j2 * ma;
            a.vy -= ny * j2 * ma;
            b.vx += nx * j2 * mb;
            b.vy += ny * j2 * mb;
          }
          const kick = Math.min(3, over * 0.08 + Math.abs(vn) * 0.006);
          const axis = Math.atan2(ny, nx);
          a.axis = axis;
          b.axis = axis;
          a.sqv -= kick;
          b.sqv -= kick;
        }
      }

      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        if (b.held === null && b.y < -b.r * 1.4) bubbles.splice(i, 1);
      }

      giantIn -= dt;
      spawnIn -= dt;
      if (spawnIn <= 0) {
        const free = bubbles.filter((b) => b.held === null).length;
        if (free < ambient) spawnAmbient(true);
        spawnIn = rand(0.6, 1.4) / calm;
      }

      let k = 0;
      for (const d of drops) {
        d.life -= dt;
        if (d.life <= 0) continue;
        d.vx *= Math.pow(0.4, dt);
        d.vy = d.vy * Math.pow(0.4, dt) + 520 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        drops[k++] = d;
      }
      drops.length = k;
      k = 0;
      for (const r of rings) {
        r.life -= dt;
        if (r.life > 0) rings[k++] = r;
      }
      rings.length = k;

      // --- draw -------------------------------------------------------------
      if (bg) ctx.drawImage(bg, 0, 0, w, h);
      else {
        ctx.fillStyle = "#4fb3ea";
        ctx.fillRect(0, 0, w, h);
      }

      // Light shafts swaying down from the surface.
      const rays = reduced ? 3 : 5;
      for (let i = 0; i < rays; i++) {
        const sway = reduced ? 0 : Math.sin(t * 0.18 + i * 1.7) * 0.08;
        ctx.save();
        ctx.translate(w * (0.12 + (i / rays) * 0.85), -20);
        ctx.rotate(0.28 + sway);
        ctx.globalAlpha = 0.07 + 0.04 * Math.sin(t * 0.3 + i * 2.3);
        ctx.drawImage(ray, -w * 0.06, 0, w * 0.12 + 30, h * 1.1);
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      for (const o of bokeh) {
        if (!reduced) {
          o.y -= o.vy * dt;
          if (o.y < -o.r) {
            o.y = h + o.r;
            o.x = Math.random() * w;
          }
        }
        const x = o.x + (reduced ? 0 : Math.sin(t * 0.2 + o.phase) * 12);
        ctx.globalAlpha = o.a;
        ctx.drawImage(bokehSprites[o.sprite], x - o.r, o.y - o.r, o.r * 2, o.r * 2);
      }
      ctx.globalAlpha = 1;

      const scale = SPRITE / 2 / SPRITE_R;
      for (const b of bubbles) {
        const r = drawnRadius(b);
        const breath = reduced ? 0 : Math.sin(t * 2.1 + b.phase) * 0.025;
        const sq = b.sq + breath;
        const s = r * scale;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.axis);
        ctx.scale(1 + sq, 1 - sq);
        ctx.rotate(-b.axis);
        ctx.save();
        ctx.rotate(b.spin);
        ctx.drawImage(film, -s, -s, s * 2, s * 2);
        if (b.giant) {
          // A second film turning the other way: the giant one shimmers more.
          ctx.rotate(-b.spin * 2.3);
          ctx.globalAlpha = 0.55;
          ctx.drawImage(film, -s, -s, s * 2, s * 2);
          ctx.globalAlpha = 1;
        }
        ctx.restore();
        ctx.drawImage(shine, -s, -s, s * 2, s * 2);
        ctx.restore();
      }

      ctx.fillStyle = "rgba(240,252,255,1)";
      for (const d of drops) {
        ctx.globalAlpha = Math.min(1, (d.life / d.max) * 1.8) * 0.9;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, TAU);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(255,255,255,1)";
      for (const r of rings) {
        const u = 1 - r.life / r.max;
        ctx.globalAlpha = (1 - u) * 0.85;
        ctx.lineWidth = Math.max(0.6, r.width * (1 - u));
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * (1 - (1 - u) * (1 - u)), 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },

    down(p: GamePointer) {
      const f: Finger = { x: p.x, y: p.y, vx: 0, vy: 0, at: performance.now(), travel: 0, sx: p.x, sy: p.y, blowing: null };
      fingers.set(p.id, f);
      const i = hit(p.x, p.y, true);
      if (i >= 0) popAt(i);
      else blow(f, p.x, p.y);
    },

    move(p: GamePointer) {
      const f = fingers.get(p.id);
      if (!f) return;
      const now = performance.now();
      const dtm = Math.max(1, now - f.at) / 1000;
      const dx = p.x - f.x;
      const dy = p.y - f.y;
      f.vx = f.vx * 0.6 + (dx / dtm) * 0.4;
      f.vy = f.vy * 0.6 + (dy / dtm) * 0.4;
      f.x = p.x;
      f.y = p.y;
      f.at = now;

      // A swiping hand pops what it passes through.
      const i = hit(p.x, p.y, false);
      if (i >= 0) popAt(i);

      // Once the finger really travels, the bubble on it lets go and the hand
      // starts leaving a stream of small ones behind it instead.
      if (f.blowing && Math.hypot(p.x - f.sx, p.y - f.sy) > 34) release(f);
      f.travel += Math.hypot(dx, dy);
      const gap = clamp(short * 0.05, 18, 34);
      while (f.travel > gap) {
        f.travel -= gap;
        const b = makeBubble(p.x + rand(-6, 6), p.y + rand(-6, 6), clamp(short * rand(0.018, 0.04), 8, 24));
        b.vx = clamp(f.vx * 0.22, -260, 260) + rand(-30, 30);
        b.vy = clamp(f.vy * 0.22, -260, 260) - rand(20, 60);
        b.safe = 0.5;
        add(b);
        if (clock - lastPuff > 0.13) {
          lastPuff = clock;
          puff(p.x, W, 0.6);
        }
      }
    },

    up(p: GamePointer) {
      const f = fingers.get(p.id);
      if (!f) return;
      release(f);
      fingers.delete(p.id);
    },
  };
}

