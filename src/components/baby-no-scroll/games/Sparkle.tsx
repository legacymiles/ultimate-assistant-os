"use client";

// ---------------------------------------------------------------------------
// Finger paint — light that follows the hand and slowly forgets.
//
// There is nothing to hit here, which is the point: dragging a flat hand across
// a screen is the thing babies do most, and in every other game it is the one
// gesture that does nothing. This one rewards it and nothing else.
//
// Drawn on a canvas because the trail is hundreds of overlapping marks a second.
// It fades by painting a nearly-transparent wash over the whole frame instead of
// by tracking the age of each mark — the wash is one operation for the whole
// picture, and the uneven decay it produces looks more like ink in water than a
// per-particle fade ever does.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { sparkle, wakeAudio } from "@/lib/baby-no-scroll/audio";

interface Mark {
  x: number;
  y: number;
  r: number;
  hue: number;
}

export function Sparkle() {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const queue = useRef<Mark[]>([]);
  const hue = useRef(Math.random() * 360);
  const lastSound = useRef(0);
  /** Where the hand was a moment ago, so a stroke can be filled in. */
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d", { alpha: true });
    if (!ctx) return;

    // Cap the device pixel ratio: a 3x phone screen is three times the fill rate
    // for a glow nobody can see the edge of anyway.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    window.addEventListener("resize", size);

    let raf = 0;
    const step = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;

      // The wash. destination-out removes alpha rather than painting black over
      // it, so the trail thins out instead of going grey.
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.035)";
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = "lighter";
      for (const m of queue.current) {
        const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
        g.addColorStop(0, `hsla(${m.hue}, 95%, 72%, 0.5)`);
        g.addColorStop(0.5, `hsla(${m.hue}, 95%, 60%, 0.18)`);
        g.addColorStop(1, "hsla(0,0%,0%,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      queue.current = [];
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
    };
  }, []);

  const paint = (e: React.PointerEvent) => {
    const el = canvas.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const r = Math.min(rect.width, rect.height) * 0.09;

    // Stamp along the line from the last position rather than only at this one.
    // A pointer only reports as often as the device feels like, and a baby's
    // swipe is fast — without this, a quick hand draws a dotted line instead of
    // a stroke, which is the one thing this game has to get right.
    const prev = last.current;
    const step = r * 0.3;
    const span = prev ? Math.hypot(x - prev.x, y - prev.y) : 0;
    const steps = prev ? Math.min(40, Math.floor(span / step)) : 0;
    for (let i = 1; i <= steps; i++) {
      const k = i / (steps + 1);
      hue.current = (hue.current + 1.4) % 360;
      queue.current.push({
        x: prev!.x + (x - prev!.x) * k,
        y: prev!.y + (y - prev!.y) * k,
        r,
        hue: hue.current,
      });
    }

    // The hue drifts as the hand moves, so a long stroke is a gradient and two
    // strokes in the same place are never the same colour.
    hue.current = (hue.current + 1.4) % 360;
    queue.current.push({ x, y, r, hue: hue.current });
    last.current = { x, y };

    // A note every so often rather than every frame, or it is a drone.
    const now = performance.now();
    if (now - lastSound.current > 170) {
      lastSound.current = now;
      wakeAudio();
      sparkle(x / Math.max(1, rect.width));
    }
  };

  /** A new stroke must not be joined to where the last one ended. */
  const lift = () => {
    last.current = null;
  };

  return (
    <div className="bns-game">
      <canvas
        ref={canvas}
        className="bns-paint"
        onPointerDown={(e) => {
          e.preventDefault();
          lift();
          paint(e);
        }}
        onPointerMove={(e) => {
          // Only while a finger is actually down: a mouse hovering across the
          // screen should not paint, or the picture is never the baby's.
          if (e.buttons === 0 && e.pointerType === "mouse") return;
          paint(e);
        }}
        onPointerUp={lift}
        onPointerCancel={lift}
        onPointerLeave={lift}
      />
    </div>
  );
}
