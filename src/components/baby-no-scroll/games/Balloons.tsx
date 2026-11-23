"use client";

// ---------------------------------------------------------------------------
// Balloon pop — the first game, and the one that works youngest.
//
// The old version was a polite trickle of slow CSS circles. A baby looked,
// waited, and looked away. This one is a sky that is never still:
//
//   - Balloons RACE up (a full screen-height in two to four seconds), so there
//     is always one arriving under a hand, and plenty of them.
//   - Every touch does something. On a balloon: it bursts into rubber shards,
//     confetti and a shockwave. On the empty sky: a new balloon inflates out of
//     the finger and floats away. Dragged across the sky: it pops every balloon
//     it crosses.
//   - Pops in quick succession climb a pentatonic scale, so a frantic baby
//     plays a melody instead of a pile of noises — and can hear that faster
//     means higher.
//   - One balloon in eight is gold with a star and sets off fireworks; one in
//     ten is a rainbow that splits into a flock of little ones. Small, frequent
//     surprises are what keep a one-year-old reaching.
//
// The hit area is the balloon plus a generous margin, because a palm arrives
// late and to one side.
// ---------------------------------------------------------------------------

import { GameCanvas, type CanvasGame, type GameEnv, type GamePointer } from "./GameCanvas";
import { Particles, TAU, clamp, drawTwinkles, easeOutBack, glow, hsl, makeTwinkles, pick, rand, star, type Twinkle } from "@/lib/baby-no-scroll/fx";
import { audio, noise, note, tone } from "@/lib/baby-no-scroll/audio";

type Kind = "plain" | "gold" | "rainbow" | "heart";

interface Balloon {
  x: number;
  y: number;
  r: number;
  hue: number;
  kind: Kind;
  /** px/s upward. */
  vy: number;
  vx: number;
  sway: number;
  phase: number;
  /** 0→1 while inflating out of a finger, then stays 1. */
  grow: number;
  /** Lean, for the string to trail behind. */
  tilt: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  life: number;
  hue: number;
}

interface Cloud {
  x: number;
  y: number;
  s: number;
  speed: number;
  depth: number;
}

const BALLOON_HUES = [350, 12, 38, 52, 140, 175, 200, 228, 270, 305];

function createBalloons(env: GameEnv): CanvasGame {
  let w = 0;
  let h = 0;
  let balloons: Balloon[] = [];
  const parts = new Particles(700);
  const shards = new Particles(300);
  const rings: Ring[] = [];
  let clouds: Cloud[] = [];
  let twinkles: Twinkle[] = [];
  let cloudSprite: HTMLCanvasElement | null = null;
  let combo = 0;
  let lastPop = 0;
  let clock = 0;
  let flash = 0;
  const motion = env.reduced ? 0.55 : 1;

  const target = () => clamp(Math.round((w * h) / 52000), 8, 16);
  const baseR = () => Math.min(w, h) * 0.085 + 18;

  function make(below: boolean, at?: { x: number; y: number }): Balloon {
    const roll = Math.random();
    const kind: Kind = roll < 0.11 ? "gold" : roll < 0.2 ? "rainbow" : roll < 0.27 ? "heart" : "plain";
    const r = baseR() * rand(0.85, 1.25);
    return {
      x: at?.x ?? rand(r, w - r),
      y: at?.y ?? (below ? h + r * 1.4 + rand(0, h * 0.35) : rand(h * 0.15, h * 0.95)),
      r,
      hue: kind === "gold" ? 45 : pick(BALLOON_HUES),
      kind,
      // A screen-height in ~2–4 s, whatever the screen.
      vy: h * rand(0.24, 0.42) * motion,
      vx: 0,
      sway: rand(0.35, 0.8),
      phase: rand(0, TAU),
      grow: at ? 0 : 1,
      tilt: 0,
    };
  }

  function makeCloudSprite(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = 260;
    c.height = 120;
    const g = c.getContext("2d");
    if (g) {
      const puffs: [number, number, number][] = [
        [70, 78, 38], [110, 58, 48], [158, 64, 42], [196, 82, 32], [130, 88, 40],
      ];
      for (const [x, y, r] of puffs) {
        const grd = g.createRadialGradient(x, y - r * 0.3, r * 0.1, x, y, r);
        grd.addColorStop(0, "rgba(255,255,255,0.95)");
        grd.addColorStop(0.7, "rgba(255,235,250,0.75)");
        grd.addColorStop(1, "rgba(255,235,250,0)");
        g.fillStyle = grd;
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
      }
    }
    return c;
  }

  // --- sound -------------------------------------------------------------------

  function popSound(b: Balloon) {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    // The snap: a very short bright noise, then a pitched body that drops.
    noise(0.05, 5200, 0.55, "highpass");
    noise(0.12, 1600, 0.35);
    const o = a.ctx.createOscillator();
    o.type = "sine";
    const top = 700 * (1.4 - b.r / (baseR() * 2));
    o.frequency.setValueAtTime(top, t);
    o.frequency.exponentialRampToValueAtTime(top * 0.25, t + 0.12);
    const g = a.ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.connect(g).connect(a.out);
    o.start(t);
    o.stop(t + 0.17);
    // The melody: each pop in a streak is the next note up the scale.
    note(combo % 12, { type: "triangle", duration: 0.55, gain: 0.22, reverb: 0.35 });
  }

  function inflateSound() {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    const o = a.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(660, t + 0.25);
    const g = a.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(a.out);
    o.start(t);
    o.stop(t + 0.32);
  }

  function fanfare() {
    [0, 2, 4, 7].forEach((s, i) =>
      note(s + 5, { type: "triangle", duration: 0.9, gain: 0.2, reverb: 0.5, delay: i * 0.09 }),
    );
    noise(0.5, 7000, 0.12, "highpass");
  }

  // --- popping --------------------------------------------------------------------

  function burst(b: Balloon) {
    const now = clock;
    combo = now - lastPop < 1.1 ? combo + 1 : 0;
    lastPop = now;
    popSound(b);

    const hues = b.kind === "rainbow" ? BALLOON_HUES : b.kind === "gold" ? [45, 50, 38, 30] : [b.hue, b.hue + 20, b.hue - 20];
    // Rubber: big curved shards of the balloon's own colour, flung out fast.
    shards.burst(b.x, b.y, {
      count: 10,
      speed: [260, 620],
      size: [b.r * 0.14, b.r * 0.28],
      life: [0.45, 0.8],
      hues,
      shapes: ["confetti"],
      gravity: 900,
      drag: 0.08,
    });
    parts.burst(b.x, b.y, {
      count: 26,
      speed: [140, 520],
      size: [3, 8],
      life: [0.7, 1.4],
      hues: [...hues, 52, 195],
      shapes: ["dot", "star", "confetti", "heart"],
      gravity: 420,
    });
    rings.push({ x: b.x, y: b.y, r: b.r * 0.6, life: 1, hue: b.hue });

    if (b.kind === "gold") {
      flash = 1;
      fanfare();
      for (let i = 0; i < 3; i++) {
        const fx = b.x + rand(-b.r * 2, b.r * 2);
        const fy = b.y + rand(-b.r * 2, b.r);
        parts.burst(fx, fy, {
          count: 40,
          speed: [200, 520],
          size: [2.5, 5],
          life: [0.9, 1.6],
          hues: [pick(BALLOON_HUES), 50],
          shapes: ["star", "dot"],
          gravity: 160,
          drag: 0.25,
        });
      }
    }
    if (b.kind === "rainbow") {
      // A flock of little ones bursts out and floats on.
      for (let i = 0; i < 5; i++) {
        const kid = make(false, { x: b.x, y: b.y });
        kid.kind = "plain";
        kid.r = b.r * 0.5;
        kid.hue = BALLOON_HUES[(i * 2) % BALLOON_HUES.length];
        kid.vx = Math.cos((i / 5) * TAU) * 260;
        kid.vy = h * rand(0.3, 0.45) * motion;
        kid.grow = 0.2;
        balloons.push(kid);
      }
    }
  }

  function hit(p: GamePointer, slop: number): Balloon | null {
    // Topmost (last drawn) first, so the balloon you see is the one that pops.
    for (let i = balloons.length - 1; i >= 0; i--) {
      const b = balloons[i];
      const dx = p.x - b.x;
      const dy = (p.y - b.y) / 1.15;
      if (dx * dx + dy * dy < (b.r * b.grow + slop) ** 2) return b;
    }
    return null;
  }

  function tryPop(p: GamePointer, slop: number): boolean {
    const b = hit(p, slop);
    if (!b) return false;
    balloons = balloons.filter((x) => x !== b);
    burst(b);
    return true;
  }

  // --- drawing ----------------------------------------------------------------------

  function drawBalloon(ctx: CanvasRenderingContext2D, b: Balloon, t: number) {
    const s = b.kind === "rainbow" || b.grow >= 1 ? Math.min(1, b.grow) : easeOutBack(b.grow);
    const r = b.r * Math.max(0.05, s);
    const rx = r;
    const ry = r * 1.15;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.tilt);

    // String: trails below, bending against the sway.
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, ry + r * 0.12);
    const wob = Math.sin(t * 3 + b.phase) * r * 0.25;
    ctx.bezierCurveTo(wob, ry + r * 0.7, -wob, ry + r * 1.2, wob * 0.6, ry + r * 1.9);
    ctx.stroke();

    // Knot.
    ctx.fillStyle = hsl(b.hue, 80, 42);
    ctx.beginPath();
    ctx.moveTo(0, ry - r * 0.04);
    ctx.lineTo(-r * 0.11, ry + r * 0.15);
    ctx.lineTo(r * 0.11, ry + r * 0.15);
    ctx.closePath();
    ctx.fill();

    // Body.
    ctx.beginPath();
    if (b.kind === "heart") {
      const k = r * 1.05;
      ctx.moveTo(0, ry);
      ctx.bezierCurveTo(-k * 1.5, k * 0.1, -k * 1.05, -k * 1.25, 0, -k * 0.55);
      ctx.bezierCurveTo(k * 1.05, -k * 1.25, k * 1.5, k * 0.1, 0, ry);
    } else {
      // Fuller at the top than the bottom, like a real balloon.
      ctx.moveTo(0, ry);
      ctx.bezierCurveTo(-rx * 0.55, ry * 0.95, -rx * 1.08, ry * 0.35, -rx, -ry * 0.15);
      ctx.bezierCurveTo(-rx * 0.95, -ry * 0.85, -rx * 0.45, -ry, 0, -ry);
      ctx.bezierCurveTo(rx * 0.45, -ry, rx * 0.95, -ry * 0.85, rx, -ry * 0.15);
      ctx.bezierCurveTo(rx * 1.08, ry * 0.35, rx * 0.55, ry * 0.95, 0, ry);
    }
    ctx.closePath();

    let fill: CanvasGradient;
    if (b.kind === "rainbow") {
      fill = ctx.createLinearGradient(-rx, -ry, rx, ry);
      BALLOON_HUES.forEach((hh, i) => fill.addColorStop(i / (BALLOON_HUES.length - 1), hsl(hh, 92, 62)));
    } else if (b.kind === "gold") {
      fill = ctx.createRadialGradient(-rx * 0.35, -ry * 0.45, r * 0.05, 0, 0, ry * 1.1);
      fill.addColorStop(0, "#fff6c8");
      fill.addColorStop(0.35, "#ffd34d");
      fill.addColorStop(0.8, "#e09a12");
      fill.addColorStop(1, "#a8650a");
    } else {
      fill = ctx.createRadialGradient(-rx * 0.35, -ry * 0.45, r * 0.05, 0, 0, ry * 1.1);
      fill.addColorStop(0, hsl(b.hue, 100, 82));
      fill.addColorStop(0.45, hsl(b.hue, 92, 60));
      fill.addColorStop(1, hsl(b.hue, 85, 32));
    }
    ctx.fillStyle = fill;
    ctx.fill();

    // Rim light, so it sits in the sky rather than on it.
    ctx.strokeStyle = hsl(b.hue + 30, 100, 80, 0.35);
    ctx.lineWidth = Math.max(1.5, r * 0.04);
    ctx.stroke();

    if (b.kind === "gold") {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      star(ctx, 0, -ry * 0.05, r * 0.42, r * 0.18, 5);
      ctx.fill();
      // Sparkle orbit.
      for (let i = 0; i < 3; i++) {
        const a = t * 2.2 + (i / 3) * TAU;
        glow(ctx, Math.cos(a) * rx * 1.25, Math.sin(a) * ry * 1.15, r * 0.22, "rgba(255,240,170,0.9)", 0.8);
      }
    }

    // Specular highlight: a sharp window and a soft streak.
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.ellipse(-rx * 0.42, -ry * 0.48, r * 0.17, r * 0.27, -0.55, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(-rx * 0.62, -ry * 0.05, r * 0.06, r * 0.18, -0.25, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawSky(ctx: CanvasRenderingContext2D, t: number) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#1d1450");
    g.addColorStop(0.5, "#4a1f6e");
    g.addColorStop(0.85, "#b23f7a");
    g.addColorStop(1, "#ff8a6b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    drawTwinkles(ctx, twinkles, t, 0.7);
    // Sun glow on the horizon.
    glow(ctx, w * 0.5, h * 1.05, Math.max(w, h) * 0.55, "rgba(255,190,120,0.55)");
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,230,160,${flash * 0.25})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  function drawClouds(ctx: CanvasRenderingContext2D, layer: number) {
    if (!cloudSprite) return;
    for (const c of clouds) {
      if (c.depth !== layer) continue;
      ctx.globalAlpha = layer === 0 ? 0.22 : 0.4;
      ctx.drawImage(cloudSprite, c.x, c.y, 260 * c.s, 120 * c.s);
    }
    ctx.globalAlpha = 1;
  }

  return {
    resize(nw, nh) {
      const first = w === 0;
      w = nw;
      h = nh;
      twinkles = makeTwinkles(w, h * 0.6, 0.00018);
      if (!cloudSprite) cloudSprite = makeCloudSprite();
      clouds = Array.from({ length: 6 }, (_, i) => ({
        x: rand(-200, w),
        y: rand(h * 0.05, h * 0.8),
        s: rand(0.6, 1.4) * (i % 2 ? 1.3 : 0.8),
        speed: rand(8, 22),
        depth: i % 2,
      }));
      if (first) balloons = Array.from({ length: target() }, () => make(false));
    },

    frame(ctx, dt, t) {
      clock = t;
      flash = Math.max(0, flash - dt * 2.5);

      // Keep the sky full: top up from below whenever balloons are popped or escape.
      const want = target();
      const live = balloons.filter((b) => b.grow < 1 || b.y > -b.r * 3);
      const missing = want - live.filter((b) => b.r > baseR() * 0.7).length;
      for (let i = 0; i < missing; i++) live.push(make(true));
      balloons = live;

      for (const c of clouds) {
        c.x += c.speed * (c.depth ? 1 : 0.5) * dt * motion;
        if (c.x > w + 40) c.x = -260 * c.s - rand(0, 200);
      }

      for (const b of balloons) {
        if (b.grow < 1) b.grow = Math.min(1, b.grow + dt * 2.6);
        const swayV = Math.cos(t * b.sway * TAU * 0.5 + b.phase) * b.r * 0.9;
        b.vx *= Math.pow(0.12, dt);
        b.x += (b.vx + swayV) * dt;
        b.x = clamp(b.x, b.r * 0.6, w - b.r * 0.6);
        // A freshly inflated balloon hangs on the finger for a beat, then lifts.
        b.y -= b.vy * dt * (b.grow < 1 ? 0.15 : 1);
        b.tilt = clamp((b.vx + swayV) / 900, -0.35, 0.35);
      }

      parts.update(dt);
      shards.update(dt);
      for (const r of rings) {
        r.r += dt * 520;
        r.life -= dt * 2.6;
      }
      for (let i = rings.length - 1; i >= 0; i--) if (rings[i].life <= 0) rings.splice(i, 1);

      // --- draw, back to front ---
      drawSky(ctx, t);
      drawClouds(ctx, 0);
      for (const b of balloons) drawBalloon(ctx, b, t);
      drawClouds(ctx, 1);
      for (const r of rings) {
        ctx.strokeStyle = hsl(r.hue, 100, 85, r.life * 0.7);
        ctx.lineWidth = 6 * r.life;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, TAU);
        ctx.stroke();
      }
      shards.draw(ctx);
      ctx.globalCompositeOperation = "lighter";
      parts.draw(ctx);
      ctx.globalCompositeOperation = "source-over";
    },

    down(p) {
      if (tryPop(p, Math.min(w, h) * 0.05)) return;
      // Empty sky: a balloon inflates out of the finger.
      const b = make(false, { x: p.x, y: p.y });
      b.r = baseR() * rand(0.9, 1.15);
      balloons.push(b);
      inflateSound();
      parts.burst(p.x, p.y, { count: 8, speed: [60, 160], size: [2, 4], life: [0.4, 0.7], shapes: ["star"], gravity: 0 });
    },

    move(p) {
      // A hand dragged across the sky pops everything it crosses.
      tryPop(p, Math.min(w, h) * 0.02);
    },
  };
}

export function Balloons() {
  return <GameCanvas create={createBalloons} />;
}
