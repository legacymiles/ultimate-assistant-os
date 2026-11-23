// ---------------------------------------------------------------------------
// Shared drawing kit for the canvas games: maths, a particle system and a few
// painted shapes. Pure functions over a 2D context — no DOM, no React — so
// every game in the nursery shares one visual language (soft glow, glossy
// highlights, buoyant motion) without each re-inventing it.
// ---------------------------------------------------------------------------

export const TAU = Math.PI * 2;

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Overshoot-and-settle, 0→1. The motion that reads as "alive" rather than "tweened". */
export function easeOutBack(t: number, s = 1.70158): number {
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** A damped spring step. Returns the new [value, velocity]. */
export function spring(
  value: number,
  velocity: number,
  target: number,
  dt: number,
  stiffness = 180,
  damping = 12,
): [number, number] {
  const a = (target - value) * stiffness - velocity * damping;
  const v = velocity + a * dt;
  return [value + v * dt, v];
}

/** The nursery palette: saturated, warm-leaning, every pair readable on the dark. */
export const CANDY = [350, 18, 42, 52, 135, 168, 195, 220, 265, 300] as const;

export const hsl = (h: number, s = 90, l = 62, a = 1) => `hsl(${h} ${s}% ${l}% / ${a})`;

// --- particles ---------------------------------------------------------------

export type ParticleShape = "dot" | "star" | "confetti" | "ring" | "heart";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds left / seconds total. */
  life: number;
  max: number;
  size: number;
  hue: number;
  spin: number;
  rot: number;
  shape: ParticleShape;
  /** Pixels per second squared, downward. */
  gravity: number;
  /** Fraction of velocity kept per second. */
  drag: number;
}

export interface BurstOptions {
  count?: number;
  speed?: [number, number];
  size?: [number, number];
  life?: [number, number];
  hues?: readonly number[];
  shapes?: readonly ParticleShape[];
  gravity?: number;
  drag?: number;
  /** Bias the burst upward (fountain) instead of a sphere. */
  up?: number;
}

export class Particles {
  list: Particle[] = [];
  constructor(private cap = 600) {}

  burst(x: number, y: number, o: BurstOptions = {}): void {
    const {
      count = 24,
      speed = [120, 420],
      size = [4, 10],
      life = [0.6, 1.2],
      hues = CANDY,
      shapes = ["dot", "star", "confetti"],
      gravity = 380,
      drag = 0.18,
      up = 0,
    } = o;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = rand(speed[0], speed[1]);
      const l = rand(life[0], life[1]);
      this.list.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - up,
        life: l,
        max: l,
        size: rand(size[0], size[1]),
        hue: pick(hues),
        spin: rand(-8, 8),
        rot: Math.random() * TAU,
        shape: pick(shapes),
        gravity,
        drag,
      });
    }
    if (this.list.length > this.cap) this.list.splice(0, this.list.length - this.cap);
  }

  update(dt: number): void {
    const out: Particle[] = [];
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      const keep = Math.pow(p.drag, dt);
      p.vx *= keep;
      p.vy = p.vy * keep + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      out.push(p);
    }
    this.list = out;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.list) {
      const k = p.life / p.max;
      const a = Math.min(1, k * 1.6);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = a;
      ctx.fillStyle = hsl(p.hue, 95, 64);
      const s = p.size * (0.6 + 0.4 * k);
      switch (p.shape) {
        case "star":
          star(ctx, 0, 0, s * 1.3, s * 0.55, 5);
          ctx.fill();
          break;
        case "confetti":
          ctx.fillRect(-s, -s * 0.4, s * 2, s * 0.8);
          break;
        case "ring":
          ctx.strokeStyle = hsl(p.hue, 95, 70);
          ctx.lineWidth = Math.max(1.5, s * 0.35);
          ctx.beginPath();
          ctx.arc(0, 0, s, 0, TAU);
          ctx.stroke();
          break;
        case "heart":
          heart(ctx, 0, 0, s * 1.4);
          ctx.fill();
          break;
        default:
          ctx.beginPath();
          ctx.arc(0, 0, s, 0, TAU);
          ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

// --- shapes --------------------------------------------------------------------

/** A star path centred on (x, y). Fill or stroke it after. */
export function star(ctx: CanvasRenderingContext2D, x: number, y: number, outer: number, inner: number, points = 5): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * TAU - Math.PI / 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** A heart path whose width is roughly `s`, centred on (x, y). */
export function heart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const k = s / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + k * 0.9);
  ctx.bezierCurveTo(x - k * 1.6, y - k * 0.2, x - k * 0.7, y - k * 1.4, x, y - k * 0.5);
  ctx.bezierCurveTo(x + k * 0.7, y - k * 1.4, x + k * 1.6, y - k * 0.2, x, y + k * 0.9);
  ctx.closePath();
}

/** A soft round light. Cheap glow that does not need ctx.filter (which Safari lacks). */
export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha = 1): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * A glossy ball: base colour, a darker rim, a sharp specular highlight top-left
 * and a soft bounce light bottom-right. The look that makes a flat circle read
 * as a toy you could pick up.
 */
export function glossyBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, hue: number, alpha = 1): void {
  ctx.globalAlpha = alpha;
  const body = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.05);
  body.addColorStop(0, hsl(hue, 100, 78));
  body.addColorStop(0.55, hsl(hue, 90, 58));
  body.addColorStop(1, hsl(hue, 85, 34));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  // bounce light
  const bounce = ctx.createRadialGradient(x + r * 0.45, y + r * 0.55, 0, x + r * 0.45, y + r * 0.55, r * 0.6);
  bounce.addColorStop(0, hsl(hue + 30, 100, 75, 0.45));
  bounce.addColorStop(1, "transparent");
  ctx.fillStyle = bounce;
  ctx.fill();
  // specular
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.ellipse(x - r * 0.38, y - r * 0.42, r * 0.22, r * 0.13, -0.7, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Twinkling background stars, generated once per size. */
export interface Twinkle {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
}

export function makeTwinkles(w: number, h: number, density = 0.00012): Twinkle[] {
  const n = Math.round(w * h * density);
  return Array.from({ length: n }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: rand(0.6, 1.8),
    phase: Math.random() * TAU,
    speed: rand(0.6, 2),
  }));
}

export function drawTwinkles(ctx: CanvasRenderingContext2D, stars: Twinkle[], t: number, alpha = 1): void {
  ctx.fillStyle = "#fff";
  for (const s of stars) {
    ctx.globalAlpha = alpha * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase)));
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
