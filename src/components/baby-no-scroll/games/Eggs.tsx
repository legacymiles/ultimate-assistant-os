"use client";

// ---------------------------------------------------------------------------
// Hide and seek — six eggs, and a shape under one of them.
//
// This is the oldest game of the four, because it is the first that needs a
// baby to aim and to wait. The design answer to "what if they tap an empty
// one?" is that an empty egg still cracks, still sounds, and still gives back a
// little shape — just a quieter one. Nothing in here is a wrong answer; the
// prize egg is only LOUDER. A game with a miss in it is a game a one-year-old
// gives up on.
//
// The shapes are drawn here as plain geometry — a star, a heart, a flower, a
// moon, a fish, a bird — so there is nothing to download and nothing to license.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { cheer, crack, note, wakeAudio } from "@/lib/baby-no-scroll/audio";

const COUNT = 6;

/** Original shapes, no characters: geometry a baby reads at arm's length. */
const SHAPES = [
  // star
  "M12 2l2.9 6.4 7 .9-5.1 4.9 1.3 6.9L12 17.7 5.9 21l1.3-6.9L2.1 9.3l7-.9z",
  // heart
  "M12 21s-7.5-4.7-7.5-10A4.5 4.5 0 0 1 12 8.2 4.5 4.5 0 0 1 19.5 11c0 5.3-7.5 10-7.5 10z",
  // flower
  "M12 7a3 3 0 1 1 3 3 3 3 0 1 1-3 3 3 3 0 1 1-3-3 3 3 0 1 1 3-3zm0 5.2a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zM11 14h2l.6 7h-3.2z",
  // moon
  "M14.5 3a9 9 0 1 0 6.3 14.6A7.2 7.2 0 0 1 14.5 3z",
  // fish
  "M3 12c3-5 8-6 12-4l3-3v5l2 2-2 2v5l-3-3c-4 2-9 1-12-4zm11-1.6a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z",
  // bird
  "M4 14c0-4 3-7 7-7l2-3 1 3c3 .5 5 2.5 5 5l2 1-2 1.5c-.6 3-3.3 5-6.5 5H8l1-3H6z",
];

interface Egg {
  id: number;
  hue: number;
  shape: number;
  prize: boolean;
  open: boolean;
  shaking: boolean;
}

function deal(): Egg[] {
  const winner = Math.floor(Math.random() * COUNT);
  return Array.from({ length: COUNT }, (_, i) => ({
    id: i,
    hue: Math.round((i / COUNT) * 300 + 20),
    shape: Math.floor(Math.random() * SHAPES.length),
    prize: i === winner,
    open: false,
    shaking: false,
  }));
}

export function Eggs() {
  const [round, setRound] = useState(0);
  const [eggs, setEggs] = useState<Egg[]>(() => deal());
  const allOpen = useMemo(() => eggs.every((e) => e.open), [eggs]);

  const tap = useCallback(
    (id: number) => {
      wakeAudio();
      const egg = eggs.find((e) => e.id === id);
      if (!egg || egg.open) {
        // A second tap on an open egg plays its note again, because repeating
        // the thing that worked is most of what a baby is doing.
        if (egg) note(egg.shape, { duration: 0.8, gain: 0.35 });
        return;
      }
      crack();
      if (egg.prize) window.setTimeout(() => cheer(egg.shape), 160);
      else window.setTimeout(() => note(egg.shape, { duration: 0.7, gain: 0.3 }), 140);

      setEggs((prev) =>
        prev.map((e) => (e.id === id ? { ...e, open: true, shaking: true } : e)),
      );
      window.setTimeout(
        () => setEggs((prev) => prev.map((e) => (e.id === id ? { ...e, shaking: false } : e))),
        440,
      );
    },
    [eggs],
  );

  // When the last egg is open the board deals itself again, after long enough
  // to look at what was found. There is no "play again" to press.
  useEffect(() => {
    if (!allOpen) return;
    const t = window.setTimeout(() => {
      setEggs(deal());
      setRound((r) => r + 1);
    }, 2600);
    return () => window.clearTimeout(t);
  }, [allOpen]);

  return (
    <div className="bns-game">
      <div className="bns-eggs" key={round}>
        {eggs.map((e) => (
          <button
            key={e.id}
            type="button"
            tabIndex={-1}
            aria-hidden
            className={`bns-egg ${e.open ? "is-open" : ""} ${e.shaking ? "is-shaking" : ""}`}
            onPointerDown={(ev) => {
              ev.preventDefault();
              tap(e.id);
            }}
          >
            <svg className="bns-egg__shell" viewBox="0 0 76 100" aria-hidden>
              <defs>
                <linearGradient id={`bns-shell-${e.id}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor={`hsl(${e.hue} 70% 88%)`} />
                  <stop offset="1" stopColor={`hsl(${e.hue} 55% 62%)`} />
                </linearGradient>
              </defs>
              {/* An egg is not an ellipse: it is fatter at the bottom, and that
                  asymmetry is the whole silhouette. */}
              <path
                d="M38 2C53 2 70 30 70 60c0 22-14 38-32 38S6 82 6 60C6 30 23 2 38 2z"
                fill={`url(#bns-shell-${e.id})`}
              />
              <ellipse cx="27" cy="34" rx="8" ry="12" fill="rgba(255,255,255,.45)" />
              {[0, 1, 2].map((d) => (
                <circle key={d} cx={26 + d * 12} cy={62 + (d % 2) * 12} r="4.5" fill={`hsl(${e.hue} 60% 45% / .35)`} />
              ))}
            </svg>

            <svg className="bns-egg__prize" viewBox="0 0 24 24" aria-hidden>
              <path
                d={SHAPES[e.shape]}
                fill={e.prize ? `hsl(45 95% 62%)` : `hsl(${e.hue} 80% 70%)`}
              />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
