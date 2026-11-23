"use client";

// ---------------------------------------------------------------------------
// Fireworks — a night sky over a sleeping town, and the baby is the show.
//
// Tap anywhere: a rocket leaves the rooftops with a whoosh and bursts exactly
// where the finger is, about half a second later. Half a second is the longest
// a baby will wait and still connect the bang to their own hand, so the rocket
// is fast and the burst lands under the finger, not somewhere "near".
//
// Every burst is a different shape — sphere, ring, heart, star, drooping
// willow, crackling glitter — drawn from a shuffled bag so the same one never
// comes twice running. Dragging fires a volley; two hands fire two shows.
//
// How the light is done cheaply: sparks are drawn onto their own canvas that
// is never cleared, only faded a little each frame. The fade IS the trail —
// one fill for the whole screen instead of a history per spark. That canvas is
// then added onto the sky with 'lighter', so overlapping sparks bloom white
// the way real ones blow out a camera. Each burst also lights the whole sky
// and the town below it for a moment, which is what makes it feel big.
// ---------------------------------------------------------------------------

import { GameCanvas, type CanvasGame, type GameEnv, type GamePointer } from "./GameCanvas";
import { audio, note } from "@/lib/baby-no-scroll/audio";
import { TAU, clamp, drawTwinkles, makeTwinkles, rand, type Twinkle } from "@/lib/baby-no-scroll/fx";

export function Fireworks() {
  return <GameCanvas create={createFireworks} />;
}

// --- helpers --------------------------------------------------------------------

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  return { c, g };
}

/** Spark colours. Each gets a pre-painted glow sprite, so a spark is one drawImage. */
const HUES = [0, 22, 45, 58, 125, 170, 195, 222, 265, 300, 330] as const;
const WHITE = HUES.length;
const GOLD = 2;

function paintSpark(hue: number | null): HTMLCanvasElement {
  const { c, g } = canvas(32, 32);
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  if (hue === null) {
    gr.addColorStop(0.25, "rgba(255,250,235,0.9)");
    gr.addColorStop(0.5, "rgba(255,240,210,0.3)");
  } else {
    gr.addColorStop(0.2, `hsl(${hue} 100% 78%)`);
    gr.addColorStop(0.45, `hsl(${hue} 100% 58% / 0.4)`);
  }
  gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  return c;
}

// --- sound ----------------------------------------------------------------------

let noiseBuf: AudioBuffer | null = null;
let noiseCtx: BaseAudioContext | null = null;

/** One second of white noise, made once and replayed — a fresh buffer per rocket is garbage at volley speed. */
function whiteNoise(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBuf && noiseCtx === ctx) return noiseBuf;
  const len = ctx.sampleRate;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseBuf = b;
  noiseCtx = ctx;
  return b;
}

/** The launch: noise through a band-pass that sweeps upward, swelling as it climbs. */
function whoosh(dur: number, loud: number): void {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime;
  const src = a.ctx.createBufferSource();
  src.buffer = whiteNoise(a.ctx);
  const bp = a.ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 2.2;
  bp.frequency.setValueAtTime(350, t);
  bp.frequency.exponentialRampToValueAtTime(2800, t + dur);
  const env = a.ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.11 * loud, t + dur * 0.8);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
  src.connect(bp).connect(env).connect(a.out);
  src.start(t, Math.random() * 0.4);
  src.stop(t + dur + 0.1);
}

/** The burst: a low sine thump falling in pitch, a dull noise body, a tail in the room. */
function boom(loud: number): void {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime;
  const osc = a.ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(115, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.55);
  const env = a.ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(0.42 * loud, t + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
  osc.connect(env).connect(a.out);
  osc.start(t);
  osc.stop(t + 0.8);

  const src = a.ctx.createBufferSource();
  src.buffer = whiteNoise(a.ctx);
  const lp = a.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(900, t);
  lp.frequency.exponentialRampToValueAtTime(160, t + 0.8);
  const nenv = a.ctx.createGain();
  nenv.gain.setValueAtTime(0.26 * loud, t);
  nenv.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  src.connect(lp).connect(nenv).connect(a.out);
  const send = a.ctx.createGain();
  send.gain.value = 0.35;
  nenv.connect(send).connect(a.room);
  src.start(t, Math.random() * 0.05);
  src.stop(t + 0.95);
}

/** Glitter: a buffer of sparse tiny clicks, high-passed, scheduled for when the sparks start to pop. */
function crackle(delay: number, length: number, loud: number): void {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime + delay;
  const rate = a.ctx.sampleRate;
  const len = Math.floor(rate * length);
  const b = a.ctx.createBuffer(1, len, rate);
  const d = b.getChannelData(0);
  const clicks = Math.floor(length * 60);
  for (let k = 0; k < clicks; k++) {
    const at = Math.floor(Math.random() * (len - 200));
    const amp = rand(0.4, 1);
    for (let i = 0; i < 120; i++) d[at + i] += (Math.random() * 2 - 1) * amp * (1 - i / 120);
  }
  const src = a.ctx.createBufferSource();
  src.buffer = b;
  const hp = a.ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 2600;
  const env = a.ctx.createGain();
  env.gain.value = 0.16 * loud;
  src.connect(hp).connect(env).connect(a.out);
  src.start(t);
}

// --- the game -------------------------------------------------------------------

type Kind = "peony" | "ring" | "heart" | "star" | "willow" | "glitter";
const KINDS: Kind[] = ["peony", "ring", "heart", "star", "willow", "glitter"];

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  sprite: number;
  /** Fraction of velocity kept per second. */
  drag: number;
  gravity: number;
  /** 0 plain · 1 twinkling · 2 willow (sheds embers) · 3 crackle (splits in three at the end). */
  mode: number;
}

interface Rocket {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  x: number;
  y: number;
  t: number;
  dur: number;
  wiggle: number;
  sprite: number;
  kind: Kind;
  loud: number;
}

interface Flash {
  x: number;
  y: number;
  hue: number;
  life: number;
  max: number;
}

interface Finger {
  x: number;
  y: number;
  lx: number;
  ly: number;
  last: number;
}

interface Building {
  x: number;
  w: number;
  h: number;
  roof: number;
  windows: { x: number; y: number; on: number }[];
}

const MAX_SPARKS = 1100;
const MAX_ROCKETS = 16;

function createFireworks(env: GameEnv): CanvasGame {
  const reduced = env.reduced;
  const sprites = [...HUES.map((h) => paintSpark(h)), paintSpark(null)];

  let W = 0;
  let H = 0;
  let skyH = 160;
  let sky: HTMLCanvasElement | null = null;
  let townDark: HTMLCanvasElement | null = null;
  let townLit: HTMLCanvasElement | null = null;
  let moon: HTMLCanvasElement | null = null;
  let moonX = 0;
  let moonY = 0;
  let stars: Twinkle[] = [];
  let fx: { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null = null;

  const sparks: Spark[] = [];
  const rockets: Rocket[] = [];
  const flashes: Flash[] = [];
  const fingers = new Map<number, Finger>();
  let bag: Kind[] = [];
  let clock = 0;
  let lastTouch = -10;
  let idleIn = 3;
  let quietFor = 0;
  let lastWhoosh = -1;
  let lastBoom = -1;
  let shooting: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
  let shootIn = rand(6, 12);

  /** A shuffled bag: every shape comes round before any repeats. */
  const nextKind = (): Kind => {
    if (bag.length === 0) {
      bag = [...KINDS];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    return bag.pop() as Kind;
  };

  const addSpark = (s: Spark) => {
    // Full? Replace a random one rather than refusing: a new burst always shows.
    if (sparks.length < MAX_SPARKS) sparks.push(s);
    else sparks[(Math.random() * MAX_SPARKS) | 0] = s;
  };

  // --- the painted world --------------------------------------------------------

  const paintSky = (dpr: number) => {
    const { c, g } = canvas(W * dpr, H * dpr);
    g.scale(dpr, dpr);
    const lg = g.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, "#03051a");
    lg.addColorStop(0.55, "#0f1546");
    lg.addColorStop(0.85, "#2c2366");
    lg.addColorStop(1, "#4a2c6e");
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);
    // Two faint clouds of colour so the dark has depth instead of being flat.
    const neb = (x: number, y: number, r: number, c0: string) => {
      const n = g.createRadialGradient(x, y, 0, x, y, r);
      n.addColorStop(0, c0);
      n.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = n;
      g.fillRect(0, 0, W, H);
    };
    neb(W * 0.25, H * 0.3, Math.max(W, H) * 0.45, "rgba(120,60,200,0.16)");
    neb(W * 0.8, H * 0.55, Math.max(W, H) * 0.4, "rgba(40,110,220,0.13)");
    sky = c;
  };

  const paintMoon = (dpr: number) => {
    const r = clamp(Math.min(W, H) * 0.055, 20, 46);
    const size = r * 7;
    const { c, g } = canvas(size * dpr, size * dpr);
    g.scale(dpr, dpr);
    const m = size / 2;
    const halo = g.createRadialGradient(m, m, r * 0.8, m, m, size / 2);
    halo.addColorStop(0, "rgba(255,240,200,0.28)");
    halo.addColorStop(1, "rgba(255,240,200,0)");
    g.fillStyle = halo;
    g.fillRect(0, 0, size, size);
    const disc = g.createRadialGradient(m - r * 0.3, m - r * 0.3, r * 0.1, m, m, r);
    disc.addColorStop(0, "#fffbe8");
    disc.addColorStop(0.7, "#f6e9b8");
    disc.addColorStop(1, "#e2cf8e");
    g.fillStyle = disc;
    g.beginPath();
    g.arc(m, m, r, 0, TAU);
    g.fill();
    g.fillStyle = "rgba(190,165,110,0.35)";
    for (const [dx, dy, cr] of [
      [-0.3, -0.1, 0.22],
      [0.25, 0.3, 0.16],
      [0.15, -0.38, 0.11],
      [-0.1, 0.45, 0.09],
    ]) {
      g.beginPath();
      g.arc(m + dx * r, m + dy * r, cr * r, 0, TAU);
      g.fill();
    }
    moon = c;
    // Upper right, kept clear of the corner that holds the parent's lock.
    moonX = clamp(W * 0.74, W * 0.5, W - 170);
    moonY = Math.max(150, H * 0.18);
  };

  /**
   * The town: far hills, a row of buildings with a few lit windows, a near
   * hill with round trees. Laid out once, painted twice — dark, and lit as if
   * by a burst overhead — so a flash is one extra drawImage at some alpha.
   */
  const paintTown = (dpr: number) => {
    const th = skyH;
    const far: number[] = [];
    const near: number[] = [];
    const steps = Math.ceil(W / 40) + 2;
    const p1 = Math.random() * TAU;
    const p2 = Math.random() * TAU;
    for (let i = 0; i < steps; i++) {
      far.push(th * (0.38 + 0.12 * Math.sin(i * 0.45 + p1) + 0.06 * Math.sin(i * 1.3 + p2)));
      near.push(th * (0.16 + 0.05 * Math.sin(i * 0.6 + p2) + 0.03 * Math.sin(i * 1.7 + p1)));
    }
    const buildings: Building[] = [];
    let x = rand(-20, 10);
    while (x < W + 20) {
      const bw = rand(28, 70);
      const bh = th * rand(0.32, 0.78);
      const windows: Building["windows"] = [];
      for (let wy = th - bh + 10; wy < th - th * 0.2; wy += 12) {
        for (let wx = x + 6; wx < x + bw - 8; wx += 11) {
          if (Math.random() < 0.28) windows.push({ x: wx, y: wy, on: rand(0.45, 1) });
        }
      }
      buildings.push({ x, w: bw, h: bh, roof: Math.floor(Math.random() * 4), windows });
      x += bw + rand(2, 14);
    }
    const trees: { x: number; r: number }[] = [];
    for (let tx = rand(0, 40); tx < W; tx += rand(50, 120)) trees.push({ x: tx, r: rand(9, 20) });

    const paint = (lit: boolean): HTMLCanvasElement => {
      const { c, g } = canvas(W * dpr, th * dpr);
      g.scale(dpr, dpr);
      const curve = (ys: number[], col: string) => {
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(0, th);
        for (let i = 0; i < ys.length; i++) g.lineTo(i * 40 - 40, th - ys[i]);
        g.lineTo(W, th);
        g.closePath();
        g.fill();
      };
      curve(far, lit ? "#5b4c9c" : "#161236");
      for (const b of buildings) {
        g.fillStyle = lit ? "#43397e" : "#0d0b26";
        const top = th - b.h;
        g.fillRect(b.x, top, b.w, b.h);
        g.beginPath();
        if (b.roof === 1) {
          g.moveTo(b.x - 2, top);
          g.lineTo(b.x + b.w / 2, top - b.w * 0.4);
          g.lineTo(b.x + b.w + 2, top);
        } else if (b.roof === 2) {
          g.arc(b.x + b.w / 2, top, b.w * 0.32, Math.PI, TAU);
        } else if (b.roof === 3) {
          g.rect(b.x + b.w / 2 - 1.5, top - b.w * 0.5, 3, b.w * 0.5);
        }
        g.fill();
        if (lit) {
          // Rim light along the roof line, as if lit from above.
          g.fillStyle = "rgba(200,190,255,0.5)";
          g.fillRect(b.x, top, b.w, 2);
        }
        for (const wdw of b.windows) {
          g.fillStyle = lit ? `rgba(255,236,170,${wdw.on})` : `rgba(255,214,120,${wdw.on * 0.75})`;
          g.fillRect(wdw.x, wdw.y, 5, 6);
        }
      }
      curve(near, lit ? "#2f2860" : "#05041a");
      g.fillStyle = lit ? "#2f2860" : "#05041a";
      for (const tr of trees) {
        const i = Math.min(near.length - 1, Math.max(0, Math.round((tr.x + 40) / 40)));
        const base = th - near[i];
        g.beginPath();
        g.arc(tr.x, base - tr.r * 0.6, tr.r, 0, TAU);
        g.fill();
      }
      return c;
    };
    townDark = paint(false);
    townLit = paint(true);
  };

  // --- shows --------------------------------------------------------------------

  const launch = (tx: number, ty: number, loud = 1) => {
    if (rockets.length >= MAX_ROCKETS) explode(rockets.shift() as Rocket);
    // Never burst inside the town: a tap on the rooftops bursts just above them.
    const y = clamp(ty, 40, H - skyH * 0.8);
    const sx = clamp(tx + rand(-0.12, 0.12) * W, 30, W - 30);
    const dur = clamp(0.4 + ((H - y) / Math.max(1, H)) * 0.2, 0.4, 0.62);
    rockets.push({
      sx,
      sy: H + 12,
      tx,
      ty: y,
      x: sx,
      y: H + 12,
      t: 0,
      dur,
      wiggle: rand(-14, 14),
      sprite: Math.floor(Math.random() * HUES.length),
      kind: nextKind(),
      loud,
    });
    if (clock - lastWhoosh > 0.09) {
      lastWhoosh = clock;
      whoosh(dur, loud);
    }
  };

  function explode(r: Rocket) {
    const x = r.tx;
    const y = r.ty;
    const R = Math.min(W, H) * rand(0.2, 0.28);
    const main = r.sprite;
    const second = (main + 3 + Math.floor(Math.random() * 4)) % HUES.length;
    // Sparks slow down exponentially (drag), so a launch speed of R·k carries
    // a spark about R pixels: the burst is the same size on a phone and a TV.
    const burst = (
      n: number,
      shape: (i: number) => [number, number],
      o: { drag: number; gravity: number; life: [number, number]; size: [number, number]; mode?: number; mix?: number; scale?: number; sprite?: number },
    ) => {
      const k = -Math.log(o.drag);
      const sc = R * k * (o.scale ?? 1);
      for (let i = 0; i < n; i++) {
        const [ux, uy] = shape(i);
        const life = rand(o.life[0], o.life[1]);
        addSpark({
          x,
          y,
          vx: ux * sc,
          vy: uy * sc,
          life,
          max: life,
          size: rand(o.size[0], o.size[1]),
          sprite: o.sprite ?? (Math.random() < (o.mix ?? 0) ? second : main),
          drag: o.drag,
          gravity: o.gravity,
          mode: o.mode ?? 0,
        });
      }
    };
    const randomDir = (spread: number): [number, number] => {
      const a = Math.random() * TAU;
      const s = 1 - spread * Math.random();
      return [Math.cos(a) * s, Math.sin(a) * s];
    };

    let hue: number = HUES[main];
    switch (r.kind) {
      case "peony":
        burst(90, () => randomDir(0.25), { drag: 0.3, gravity: 70, life: [1.1, 1.7], size: [2.2, 3.4], mix: 0.35 });
        burst(22, () => randomDir(0.5), { drag: 0.3, gravity: 60, life: [0.6, 1], size: [1.6, 2.4], mode: 1, scale: 0.35 });
        break;
      case "ring": {
        const tilt = Math.random() * Math.PI;
        const squash = rand(0.4, 1);
        const n = 64;
        burst(n, (i) => {
          const a = (i / n) * TAU;
          const ex = Math.cos(a);
          const ey = Math.sin(a) * squash;
          return [ex * Math.cos(tilt) - ey * Math.sin(tilt), ex * Math.sin(tilt) + ey * Math.cos(tilt)];
        }, { drag: 0.3, gravity: 45, life: [1.2, 1.5], size: [2.4, 3.2] });
        burst(16, () => randomDir(0.6), { drag: 0.3, gravity: 50, life: [0.7, 1.1], size: [1.6, 2.2], mode: 1, scale: 0.25 });
        break;
      }
      case "heart": {
        const pink = HUES.indexOf(330);
        const red = 0;
        const n = 76;
        const p = Math.random() < 0.5 ? pink : red;
        for (let i = 0; i < n; i++) {
          const tt = (i / n) * TAU;
          const hx = 16 * Math.pow(Math.sin(tt), 3);
          const hy = -(13 * Math.cos(tt) - 5 * Math.cos(2 * tt) - 2 * Math.cos(3 * tt) - Math.cos(4 * tt));
          const k = -Math.log(0.25);
          const life = rand(1.3, 1.6);
          addSpark({ x, y, vx: (hx / 17) * R * k, vy: (hy / 17) * R * k, life, max: life, size: rand(2.4, 3.2), sprite: p, drag: 0.25, gravity: 30, mode: 0 });
        }
        hue = HUES[p];
        break;
      }
      case "star": {
        const pts: [number, number][] = [];
        const rot = rand(-0.3, 0.3);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU - Math.PI / 2 + rot;
          const rr = i % 2 === 0 ? 1 : 0.42;
          pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
        }
        const n = 80;
        burst(n, (i) => {
          const u = (i / n) * 10;
          const e = Math.floor(u);
          const f = u - e;
          const a = pts[e];
          const b = pts[(e + 1) % 10];
          return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        }, { drag: 0.25, gravity: 30, life: [1.3, 1.6], size: [2.4, 3.2], mix: 0.2 });
        break;
      }
      case "willow":
        // Gold, slow, heavy: the sparks droop like branches and shed embers.
        burst(70, () => randomDir(0.3), { drag: 0.45, gravity: 150, life: [2.2, 2.9], size: [2.2, 3], mode: 2, scale: 0.85, sprite: GOLD });
        hue = 42;
        break;
      case "glitter":
        burst(56, () => randomDir(0.45), { drag: 0.3, gravity: 80, life: [0.7, 1.05], size: [2, 2.8], mode: 3, mix: 0.3 });
        crackle(0.7, 0.6, r.loud);
        break;
    }

    flashes.push({ x, y, hue, life: 0.7, max: 0.7 });
    if (flashes.length > 8) flashes.shift();

    if (clock - lastBoom > 0.07) {
      lastBoom = clock;
      boom(r.loud);
      // A chime on top, pitched by where it burst left to right, so a row of
      // fireworks plays a little tune.
      note(5 + Math.floor((x / Math.max(1, W)) * 8), { type: "sine", duration: 1.4, gain: 0.11 * r.loud, reverb: 0.6 });
    }
  }

  return {
    resize(w, h) {
      W = w;
      H = h;
      skyH = clamp(h * 0.24, 110, 240);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      paintSky(dpr);
      paintMoon(dpr);
      paintTown(dpr);
      stars = makeTwinkles(w, h - skyH * 0.6, 0.00016);
      // The spark layer is kept at CSS-pixel resolution: glow is soft anyway,
      // and on a 2x tablet that is a quarter of the fill cost.
      fx = canvas(w, h);
    },

    frame(ctx, dt, t, w, h) {
      clock = t;

      // --- rockets in flight ---------------------------------------------------
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.t += dt;
        const u = Math.min(1, r.t / r.dur);
        const e = 1 - (1 - u) * (1 - u);
        const px = r.x;
        const py = r.y;
        r.x = r.sx + (r.tx - r.sx) * e + Math.sin(u * Math.PI) * r.wiggle;
        r.y = r.sy + (r.ty - r.sy) * e;
        // The trail: sparks dropped along the path since last frame, so a fast
        // rocket leaves a line rather than dots.
        for (let k = 0; k < 4; k++) {
          const f = k / 4;
          const life = rand(0.3, 0.55);
          addSpark({
            x: px + (r.x - px) * f,
            y: py + (r.y - py) * f,
            vx: rand(-25, 25),
            vy: rand(10, 70),
            life,
            max: life,
            size: rand(1.2, 2),
            sprite: Math.random() < 0.5 ? GOLD : WHITE,
            drag: 0.3,
            gravity: 120,
            mode: 1,
          });
        }
        if (u >= 1) {
          rockets.splice(i, 1);
          explode(r);
        }
      }

      // Holding a finger still keeps the show going.
      for (const f of fingers.values()) {
        if (t - f.last > 0.42) {
          f.last = t;
          launch(f.x + rand(-30, 30), f.y + rand(-30, 30));
        }
      }

      // Nobody touching for a while: a quiet firework now and then, so the sky
      // is never dead when a baby looks back at it.
      if (!reduced && fingers.size === 0 && t - lastTouch > 6) {
        idleIn -= dt;
        if (idleIn <= 0) {
          idleIn = rand(2.5, 4.5);
          launch(rand(w * 0.2, w * 0.8), rand(h * 0.15, h * 0.5), 0.45);
        }
      }

      // --- sparks -----------------------------------------------------------
      let n = 0;
      const born: Spark[] = [];
      for (const s of sparks) {
        s.life -= dt;
        if (s.life <= 0) {
          if (s.mode === 3 && born.length < 120) {
            // Glitter: each spark ends by splitting into three white specks.
            for (let k = 0; k < 3; k++) {
              const a = Math.random() * TAU;
              const sp = rand(60, 140);
              const life = rand(0.15, 0.3);
              born.push({ x: s.x, y: s.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, size: 1.6, sprite: WHITE, drag: 0.2, gravity: 0, mode: 0 });
            }
          }
          continue;
        }
        const keep = Math.pow(s.drag, dt);
        s.vx *= keep;
        s.vy = s.vy * keep + s.gravity * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.mode === 2 && Math.random() < dt * 3 && born.length < 120) {
          const life = rand(0.4, 0.8);
          born.push({ x: s.x, y: s.y, vx: rand(-10, 10), vy: rand(0, 30), life, max: life, size: 1.3, sprite: GOLD, drag: 0.4, gravity: 90, mode: 0 });
        }
        sparks[n++] = s;
      }
      sparks.length = n;
      for (const b of born) addSpark(b);

      for (let i = flashes.length - 1; i >= 0; i--) {
        flashes[i].life -= dt;
        if (flashes[i].life <= 0) flashes.splice(i, 1);
      }

      // --- the spark layer: fade, then add this frame's sparks ----------------
      if (fx) {
        const g = fx.g;
        if (sparks.length === 0 && rockets.length === 0) {
          quietFor += dt;
          // Fading never quite reaches zero in 8-bit colour; wipe it properly
          // once the sky has been empty a moment.
          if (quietFor > 1) g.clearRect(0, 0, w, h);
        } else {
          quietFor = 0;
        }
        g.globalCompositeOperation = "destination-out";
        g.fillStyle = `rgba(0,0,0,${1 - Math.pow(0.8, dt * 60)})`;
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = "lighter";
        for (const s of sparks) {
          const k = s.life / s.max;
          let a = Math.min(1, k * 2.2);
          if (s.mode === 1 || s.mode === 3) a *= 0.55 + 0.45 * Math.sin(t * 40 + s.x * 0.7);
          if (a <= 0.02) continue;
          g.globalAlpha = a;
          const sz = s.size * 3 * (0.6 + 0.4 * k);
          g.drawImage(sprites[s.sprite], s.x - sz, s.y - sz, sz * 2, sz * 2);
        }
        for (const r of rockets) {
          g.globalAlpha = 1;
          g.drawImage(sprites[WHITE], r.x - 7, r.y - 7, 14, 14);
        }
        g.globalAlpha = 1;
        g.globalCompositeOperation = "source-over";
      }

      // --- compose the scene -------------------------------------------------
      let light = 0;
      for (const f of flashes) light += Math.pow(f.life / f.max, 2);
      light = Math.min(1, light);

      if (sky) ctx.drawImage(sky, 0, 0, w, h);
      else {
        ctx.fillStyle = "#0b0f33";
        ctx.fillRect(0, 0, w, h);
      }

      // The burst lights the sky around it.
      ctx.globalCompositeOperation = "lighter";
      const big = Math.max(w, h) * 0.85;
      // Only the three newest light the sky: each is a full-screen fill, and a
      // volley of eight would cost more than every spark put together.
      for (let fi = Math.max(0, flashes.length - 3); fi < flashes.length; fi++) {
        const f = flashes[fi];
        const k = Math.pow(f.life / f.max, 2);
        const gr = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, big);
        gr.addColorStop(0, `hsl(${f.hue} 90% 55% / ${0.32 * k})`);
        gr.addColorStop(0.35, `hsl(${f.hue} 90% 45% / ${0.1 * k})`);
        gr.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = "source-over";

      drawTwinkles(ctx, stars, reduced ? 0 : t, 1 - light * 0.6);

      if (moon) {
        const s = moon.width / Math.min(2, window.devicePixelRatio || 1);
        ctx.drawImage(moon, moonX - s / 2, moonY - s / 2, s, s);
      }

      if (!reduced) {
        shootIn -= dt;
        if (shootIn <= 0 && !shooting) {
          shootIn = rand(7, 14);
          const dir = Math.random() < 0.5 ? 1 : -1;
          shooting = { x: dir > 0 ? rand(w * 0.1, w * 0.4) : rand(w * 0.6, w * 0.9), y: rand(h * 0.08, h * 0.3), vx: dir * rand(500, 700), vy: rand(120, 220), life: 0.8 };
        }
        if (shooting) {
          const s = shooting;
          s.life -= dt;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          if (s.life <= 0) shooting = null;
          else {
            const tail = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 0.15, s.y - s.vy * 0.15);
            tail.addColorStop(0, `rgba(255,255,255,${Math.min(1, s.life * 2)})`);
            tail.addColorStop(1, "rgba(255,255,255,0)");
            ctx.strokeStyle = tail;
            ctx.lineWidth = 2;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(s.x - s.vx * 0.15, s.y - s.vy * 0.15);
            ctx.stroke();
          }
        }
      }

      if (fx) {
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(fx.c, 0, 0, w, h);
        ctx.globalCompositeOperation = "source-over";
      }

      // The town sits in front of the launches, so rockets rise from behind the roofs.
      const top = h - skyH;
      if (townDark) ctx.drawImage(townDark, 0, top, w, skyH);
      if (townLit && light > 0.01) {
        ctx.globalAlpha = light * 0.85;
        ctx.drawImage(townLit, 0, top, w, skyH);
        ctx.globalAlpha = 1;
      }
      // And the colour of the brightest burst washes over the rooftops.
      if (flashes.length) {
        const f = flashes[flashes.length - 1];
        const k = Math.pow(f.life / f.max, 2);
        ctx.globalCompositeOperation = "lighter";
        const wash = ctx.createLinearGradient(0, top, 0, h);
        wash.addColorStop(0, `hsl(${f.hue} 90% 55% / ${0.22 * k})`);
        wash.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = wash;
        ctx.fillRect(0, top - skyH * 0.3, w, skyH * 1.3);
        ctx.globalCompositeOperation = "source-over";
      }
    },

    down(p: GamePointer) {
      lastTouch = clock;
      idleIn = 3;
      fingers.set(p.id, { x: p.x, y: p.y, lx: p.x, ly: p.y, last: clock });
      launch(p.x, p.y);
    },

    move(p: GamePointer) {
      const f = fingers.get(p.id);
      if (!f) return;
      lastTouch = clock;
      f.x = p.x;
      f.y = p.y;
      // A volley: a new rocket every stretch of finger travel, but no faster
      // than about nine a second per hand.
      const d = Math.hypot(p.x - f.lx, p.y - f.ly);
      if (d > 70 || (d > 24 && clock - f.last > 0.11)) {
        if (clock - f.last > 0.06) {
          f.lx = p.x;
          f.ly = p.y;
          f.last = clock;
          launch(p.x, p.y);
        }
      }
    },

    up(p: GamePointer) {
      fingers.delete(p.id);
    },
  };
}
