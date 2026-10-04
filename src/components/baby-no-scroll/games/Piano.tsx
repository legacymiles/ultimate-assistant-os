"use client";

// ---------------------------------------------------------------------------
// Baby piano — eight bars, floor to ceiling, one note each.
//
// The notes are a pentatonic scale (see lib/baby-no-scroll/audio.ts), which is
// the only real idea in this game: with no semitone pairs in the scale there is
// no combination of keys a baby can hit that sounds like a mistake. Two flat
// palms on the screen make a chord, not a noise.
//
// Pointer capture is released on the way down so that a finger dragged across
// the keyboard plays every key it crosses. Without that, touch pins the whole
// gesture to the first key and a dragged hand plays one note — which is exactly
// what a baby does, so it would be the common case.
// ---------------------------------------------------------------------------

import { useRef, useState } from "react";
import { SCALE, note, wakeAudio } from "@/lib/baby-no-scroll/audio";

/** One hue per key, round the wheel, so the keyboard is also a rainbow. */
const KEYS = SCALE.map((_, i) => ({
  i,
  hue: Math.round((i / SCALE.length) * 320),
}));

interface Float {
  id: number;
  key: number;
  x: number;
  shape: number;
  spin: number;
}

let seq = 0;

export function Piano() {
  const [down, setDown] = useState<Set<number>>(new Set());
  const [floats, setFloats] = useState<Float[]>([]);
  const held = useRef(new Set<number>());

  const press = (i: number, x: number) => {
    wakeAudio();
    note(i, { duration: 1.1, gain: 0.45 });
    setDown((prev) => new Set(prev).add(i));
    const id = ++seq;
    setFloats((prev) => [
      ...prev.slice(-14),
      { id, key: i, x, shape: Math.floor(Math.random() * 3), spin: Math.round(Math.random() * 120 - 60) },
    ]);
    window.setTimeout(() => setFloats((prev) => prev.filter((f) => f.id !== id)), 1500);
  };

  const release = (i: number) => {
    setDown((prev) => {
      const next = new Set(prev);
      next.delete(i);
      return next;
    });
  };

  return (
    <div className="bns-game">
      <div className="bns-piano">
        {KEYS.map((k) => (
          <button
            key={k.i}
            type="button"
            tabIndex={-1}
            aria-hidden
            className={`bns-key ${down.has(k.i) ? "is-down" : ""}`}
            style={{ ["--h" as string]: k.hue }}
            onPointerDown={(e) => {
              e.preventDefault();
              // See the header: this is what makes a dragged hand a glissando.
              (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
              held.current.add(e.pointerId);
              press(k.i, e.clientX);
            }}
            onPointerEnter={(e) => {
              if (!held.current.has(e.pointerId)) return;
              press(k.i, e.clientX);
            }}
            onPointerLeave={() => release(k.i)}
            onPointerUp={(e) => {
              held.current.delete(e.pointerId);
              release(k.i);
            }}
            onPointerCancel={(e) => {
              held.current.delete(e.pointerId);
              release(k.i);
            }}
          >
            <span className="bns-key__bloom" />
          </button>
        ))}
      </div>

      {/* A shape rises out of every note struck, so the sound has a picture. */}
      {floats.map((f) => (
        <svg
          key={f.id}
          className="bns-float"
          viewBox="0 0 24 24"
          width={64}
          height={64}
          style={{
            left: f.x,
            bottom: "18%",
            ["--spin" as string]: `${f.spin}deg`,
            color: `hsl(${KEYS[f.key].hue} 95% 72%)`,
          }}
          aria-hidden
        >
          {f.shape === 0 && <circle cx="12" cy="12" r="9" fill="currentColor" />}
          {f.shape === 1 && (
            <path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.6 6.1 20.7l1.2-6.6L2.5 9.5l6.6-.9z" fill="currentColor" />
          )}
          {f.shape === 2 && <rect x="4" y="4" width="16" height="16" rx="5" fill="currentColor" />}
        </svg>
      ))}
    </div>
  );
}
