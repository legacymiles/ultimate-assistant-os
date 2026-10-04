"use client";

// ---------------------------------------------------------------------------
// Balloon pop — the first game, and the one that works youngest.
//
// Everything here is tuned for a hand that cannot aim. The balloons are huge
// (a fifth of the short side of the screen), they rise slowly enough to be
// caught by a hand that arrives late, and the hit area is the whole balloon
// rather than a centre. There is no score and nothing is ever missed.
//
// The positions are written straight onto the DOM nodes inside one animation
// frame rather than through React state: eight balloons at 60fps through a
// re-render is 480 reconciliations a second for no reason at all.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { pop, wakeAudio } from "@/lib/baby-no-scroll/audio";

interface Balloon {
  id: number;
  /** Fraction of the width, so a rotation does not strand a balloon offscreen. */
  xf: number;
  /** Pixels from the top. */
  y: number;
  r: number;
  hue: number;
  /** px per second. */
  speed: number;
  swayHz: number;
  phase: number;
}

interface Burst {
  id: number;
  x: number;
  y: number;
  hue: number;
}

const MAX = 8;
let seq = 0;

export function Balloons() {
  const [balloons, setBalloons] = useState<Balloon[]>([]);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const nodes = useRef(new Map<number, HTMLDivElement>());
  const live = useRef<Balloon[]>([]);
  const box = useRef({ w: 0, h: 0 });
  const slow = useRef(false);

  live.current = balloons;

  /**
   * A balloon. `below` is the difference between the first handful and every
   * one after: a replacement rises in from under the screen, but the FIRST
   * eight are scattered across it, because a baby handed an empty sky to wait
   * fifteen seconds at is a baby who has already looked away.
   */
  const spawn = useCallback((h: number, below = true): Balloon => {
    const short = Math.min(box.current.w || 400, h);
    const r = short * (0.11 + Math.random() * 0.07);
    return {
      id: ++seq,
      xf: 0.1 + Math.random() * 0.8,
      y: below ? h + r * 2 + Math.random() * h * 0.6 : Math.random() * h,
      r,
      hue: Math.floor(Math.random() * 360),
      // Slow. A balloon that outruns a toddler's arm is a balloon they learn
      // they cannot reach.
      speed: (26 + Math.random() * 34) * (slow.current ? 0.5 : 1),
      swayHz: 0.1 + Math.random() * 0.2,
      phase: Math.random() * Math.PI * 2,
    };
  }, []);

  useEffect(() => {
    slow.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const read = () => {
      box.current = {
        w: window.visualViewport?.width ?? window.innerWidth,
        h: window.visualViewport?.height ?? window.innerHeight,
      };
    };
    read();
    window.addEventListener("resize", read);
    setBalloons(Array.from({ length: MAX }, () => spawn(box.current.h, false)));

    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { w, h } = box.current;
      const escaped: number[] = [];
      for (const b of live.current) {
        b.y -= b.speed * dt;
        if (b.y < -b.r * 2.5) escaped.push(b.id);
        const node = nodes.current.get(b.id);
        if (!node) continue;
        const sway = Math.sin(now / 1000 * b.swayHz * Math.PI * 2 + b.phase) * b.r * 0.35;
        node.style.transform = `translate(${b.xf * w + sway}px, ${b.y}px)`;
      }
      if (escaped.length) {
        // A balloon that got away is replaced, so the sky is never empty — the
        // game cannot be "finished" or lost.
        setBalloons((prev) => [
          ...prev.filter((b) => !escaped.includes(b.id)),
          ...escaped.map(() => spawn(box.current.h + 40)),
        ]);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", read);
    };
  }, [spawn]);

  const burst = (b: Balloon, x: number, y: number) => {
    wakeAudio();
    // Small balloons pop higher, which is the one bit of physics a baby notices.
    pop(1.4 - b.r / Math.max(1, Math.min(box.current.w, box.current.h)));
    const id = ++seq;
    setBursts((prev) => [...prev, { id, x, y, hue: b.hue }]);
    window.setTimeout(() => setBursts((prev) => prev.filter((p) => p.id !== id)), 700);
    setBalloons((prev) => [
      ...prev.filter((p) => p.id !== b.id),
      spawn(box.current.h + 40),
    ]);
    nodes.current.delete(b.id);
  };

  return (
    <div className="bns-game">
      {balloons.map((b) => (
        <div
          key={b.id}
          ref={(el) => {
            if (el) nodes.current.set(b.id, el);
            else nodes.current.delete(b.id);
          }}
          className="bns-balloon"
          style={{
            width: b.r * 2,
            height: b.r * 2.3,
            // The knot and string are drawn in em so they scale with the
            // balloon; this is what makes em mean "radius" for them.
            fontSize: b.r,
            ["--h" as string]: b.hue,
            // Put it where it belongs for the first paint; the loop takes over.
            transform: `translate(${b.xf * box.current.w}px, ${b.y}px)`,
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            burst(b, e.clientX, e.clientY);
          }}
        />
      ))}

      {bursts.map((p) => (
        <div key={p.id} className="bns-burst" style={{ left: p.x, top: p.y, ["--h" as string]: p.hue }}>
          {Array.from({ length: 10 }, (_, i) => {
            const a = (i / 10) * Math.PI * 2;
            const d = 70 + Math.random() * 60;
            return (
              <i
                key={i}
                style={{
                  ["--dx" as string]: `${Math.cos(a) * d}px`,
                  ["--dy" as string]: `${Math.sin(a) * d}px`,
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
