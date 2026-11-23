"use client";

// ---------------------------------------------------------------------------
// Finger paint — neon light that follows the hand and slowly forgets.
//
// There is nothing to hit here, which is the point: dragging a flat hand across
// a screen is the thing babies do most, and in every other game it is the one
// gesture that does little. This one rewards it and nothing else.
//
// Each finger draws its own glowing ribbon in its own colour that shifts as it
// travels, shedding stars. Movement is music: every stretch of distance plays
// the next note of a pentatonic scale, so a slow drag hums and a fast swipe
// sings. A tap without a drag blooms a firework flower where it landed.
//
// The trail fades by washing the whole frame with a little transparency every
// frame (destination-out) instead of ageing each mark — one operation for the
// whole picture, and the uneven decay looks like ink in water.
// ---------------------------------------------------------------------------

import { GameCanvas, type CanvasGame, type GameEnv } from "./GameCanvas";
import { Particles, TAU, rand } from "@/lib/baby-no-scroll/fx";
import { note, tone } from "@/lib/baby-no-scroll/audio";

interface Stroke {
  x: number;
  y: number;
  hue: number;
  /** Distance travelled since the last note, px. */
  run: number;
  step: number;
  moved: boolean;
}

function createPaint(env: GameEnv): CanvasGame {
  let w = 0;
  let h = 0;
  // The ink lives on its own layer so the fade never touches the backdrop.
  let ink: HTMLCanvasElement | null = null;
  let inkCtx: CanvasRenderingContext2D | null = null;
  const strokes = new Map<number, Stroke>();
  const sparks = new Particles(500);
  let hueSeed = Math.random() * 360;

  const width = () => Math.min(w, h) * 0.05 + 10;

  function segment(x0: number, y0: number, x1: number, y1: number, hue: number) {
    const g = inkCtx;
    if (!g) return;
    g.globalCompositeOperation = "lighter";
    g.lineCap = "round";
    g.lineJoin = "round";
    // Three passes: a wide soft halo, a coloured body, a white-hot core. That
    // stack is what makes a line read as light rather than paint.
    const passes: [number, string][] = [
      [width() * 2.4, `hsla(${hue}, 100%, 60%, 0.10)`],
      [width(), `hsla(${hue}, 100%, 62%, 0.55)`],
      [width() * 0.32, `hsla(${hue}, 100%, 92%, 0.9)`],
    ];
    for (const [lw, c] of passes) {
      g.strokeStyle = c;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
  }

  return {
    resize(nw, nh) {
      w = nw;
      h = nh;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const fresh = document.createElement("canvas");
      fresh.width = Math.round(w * dpr);
      fresh.height = Math.round(h * dpr);
      const g = fresh.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Keep what is already drawn across a rotation.
      if (ink) g.drawImage(ink, 0, 0, w, h);
      ink = fresh;
      inkCtx = g;
    },

    frame(ctx, dt, t) {
      // Backdrop: deep night with a slow aurora so an untouched screen still breathes.
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, "#090614");
      bg.addColorStop(1, "#140a22");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      if (!env.reduced) {
        for (let i = 0; i < 3; i++) {
          const x = w * (0.5 + 0.4 * Math.sin(t * 0.07 + i * 2.1));
          const y = h * (0.5 + 0.4 * Math.cos(t * 0.05 + i * 1.7));
          const r = Math.max(w, h) * 0.45;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, `hsla(${(hueSeed + i * 110 + t * 6) % 360}, 80%, 45%, 0.13)`);
          g.addColorStop(1, "transparent");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        }
      }

      if (inkCtx && ink) {
        inkCtx.globalCompositeOperation = "destination-out";
        inkCtx.fillStyle = `rgba(0,0,0,${Math.min(0.5, dt * 1.1)})`;
        inkCtx.fillRect(0, 0, w, h);
        ctx.drawImage(ink, 0, 0, w, h);
      }

      sparks.update(dt);
      ctx.globalCompositeOperation = "lighter";
      sparks.draw(ctx);
      ctx.globalCompositeOperation = "source-over";
    },

    down(p) {
      hueSeed = (hueSeed + 47) % 360;
      strokes.set(p.id, { x: p.x, y: p.y, hue: hueSeed, run: 0, step: Math.floor(rand(0, 5)), moved: false });
      segment(p.x, p.y, p.x + 0.1, p.y + 0.1, hueSeed);
      note(0, { type: "sine", duration: 0.4, gain: 0.12, reverb: 0.5 });
    },

    move(p) {
      const s = strokes.get(p.id);
      if (!s) return;
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const d = Math.hypot(dx, dy);
      if (d < 1) return;
      s.moved = s.moved || d > 4;
      // The colour walks round the wheel as the hand travels.
      s.hue = (s.hue + d * 0.25) % 360;
      segment(s.x, s.y, p.x, p.y, s.hue);
      s.run += d;
      const every = Math.min(w, h) * 0.12;
      if (s.run > every) {
        s.run = 0;
        s.step += 1;
        note(s.step % 10, { type: "sine", duration: 0.45, gain: 0.14, reverb: 0.55 });
        sparks.burst(p.x, p.y, {
          count: 4,
          speed: [40, 140],
          size: [2, 4.5],
          life: [0.5, 1],
          hues: [s.hue, (s.hue + 40) % 360],
          shapes: ["star"],
          gravity: -30,
          drag: 0.3,
        });
      }
      s.x = p.x;
      s.y = p.y;
    },

    up(p) {
      const s = strokes.get(p.id);
      strokes.delete(p.id);
      if (!s || s.moved) return;
      // A tap blooms a flower of light.
      const petals = 7;
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * TAU;
        const r = Math.min(w, h) * 0.09;
        segment(p.x, p.y, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, (s.hue + i * 18) % 360);
      }
      sparks.burst(p.x, p.y, { count: 22, speed: [80, 300], size: [2, 5], life: [0.6, 1.2], shapes: ["star", "dot"], gravity: 60 });
      [0, 2, 4].forEach((n, i) => note(n + 3, { type: "triangle", duration: 0.7, gain: 0.14, reverb: 0.5, delay: i * 0.07 }));
      tone(1568, { type: "sine", duration: 0.5, gain: 0.05, reverb: 0.6, delay: 0.2 });
    },
  };
}

export function Sparkle() {
  return <GameCanvas create={createPaint} />;
}
