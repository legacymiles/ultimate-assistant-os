"use client";

// ---------------------------------------------------------------------------
// The wall — rows that never stop moving.
//
// Driven by ONE requestAnimationFrame loop that writes `transform` straight to
// the row elements. Not a CSS animation: a CSS animation cannot be eased to a
// halt and resumed from where it stood, and easing to a halt under the cursor
// is the entire interaction.
//
// Not React state either — a state update per row per frame would re-render
// the whole wall 60 times a second and drop every frame it was trying to draw.
// React owns which tiles exist; the rAF loop owns where they are.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";

import { dealRows } from "@/lib/dances/query";
import type { Dance } from "@/lib/dances/types";
import { DanceTile } from "./DanceTile";

/** px per second, per row. Alternating sign gives the counter-drift. */
const BASE_SPEED = 22;
/** How fast a row reaches its target speed. Higher = snappier stop. */
const DAMPING = 3.2;
/**
 * Hover intent. Sweeping the mouse across the wall must not spawn a trail of
 * players, and 120ms is under the threshold where a deliberate hover feels
 * laggy but well over an accidental pass-through.
 */
const HOVER_DELAY_MS = 120;

function rowCountFor(width: number): number {
  if (width < 640) return 2;
  if (width < 1100) return 3;
  return 4;
}

interface Props {
  dances: Dance[];
  onOpen: (d: Dance) => void;
}

export function DanceWall({ dances, onOpen }: Props) {
  const [rowCount, setRowCount] = useState(4);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [reduced, setReduced] = useState(false);

  const trackRefs = useRef<(HTMLDivElement | null)[]>([]);
  const offsets = useRef<number[]>([]);
  const speeds = useRef<number[]>([]);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Which row the cursor is in. Read by the rAF loop without re-rendering. */
  const pausedRow = useRef<number | null>(null);

  const rows = useMemo(() => dealRows(dances, rowCount), [dances, rowCount]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyMotion = () => setReduced(mq.matches);
    const applySize = () => setRowCount(rowCountFor(window.innerWidth));
    applyMotion();
    applySize();
    mq.addEventListener("change", applyMotion);
    window.addEventListener("resize", applySize);
    return () => {
      mq.removeEventListener("change", applyMotion);
      window.removeEventListener("resize", applySize);
    };
  }, []);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      // Clamped: returning to a backgrounded tab hands you a multi-second dt,
      // which would teleport every row instead of resuming it.
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      for (let i = 0; i < trackRefs.current.length; i++) {
        const el = trackRefs.current[i];
        if (!el) continue;
        const dir = i % 2 === 0 ? -1 : 1;
        const target = pausedRow.current === i ? 0 : BASE_SPEED * dir;
        const current = speeds.current[i] ?? target;
        // Exponential approach — frame-rate independent, and it eases rather
        // than snapping, which is what makes the stop feel physical.
        const next = current + (target - current) * Math.min(DAMPING * dt, 1);
        speeds.current[i] = next;

        let offset = (offsets.current[i] ?? 0) + next * dt;
        // The track holds two identical copies, so wrapping at half its width
        // is invisible.
        const span = el.scrollWidth / 2;
        if (span > 0) {
          if (offset <= -span) offset += span;
          if (offset >= 0) offset -= span;
        }
        offsets.current[i] = offset;
        el.style.transform = `translate3d(${offset}px,0,0)`;
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reduced, rows.length]);

  const enter = (id: string, row: number) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      pausedRow.current = row;
      setActiveId(id);
    }, HOVER_DELAY_MS);
  };

  const leave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    pausedRow.current = null;
    setActiveId(null);
  };

  useEffect(() => () => void (hoverTimer.current && clearTimeout(hoverTimer.current)), []);

  if (!dances.length) {
    return (
      <p className="dance-wall__empty">
        Nothing matches. Clear the search, or add a dance you can&apos;t find here.
      </p>
    );
  }

  if (reduced) {
    return (
      <div className="dance-wall dance-wall--static">
        {dances.map((d) => (
          <DanceTile
            key={d.id}
            dance={d}
            active={activeId === d.id}
            onEnter={() => setActiveId(d.id)}
            onLeave={() => setActiveId(null)}
            onOpen={() => onOpen(d)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="dance-wall">
      {rows.map((row, i) => (
        <div className="dance-row" key={i}>
          <div
            className="dance-row__track"
            ref={(el) => {
              trackRefs.current[i] = el;
            }}
          >
            {/* Two copies: the second is what the first wraps into. It is
                aria-hidden so a screen reader reads the wall once. */}
            {[0, 1].map((copy) =>
              row.map((d) => {
                // The active key is per-COPY, not per-dance: both copies are on
                // screen at once during a wrap, and keying by dance id alone
                // would pause the row under the cursor while playing the video
                // in the twin tile somewhere else along the track.
                const key = `${i}-${copy}-${d.id}`;
                return (
                  <div key={key} aria-hidden={copy === 1}>
                    <DanceTile
                      dance={d}
                      active={activeId === key}
                      onEnter={() => enter(key, i)}
                      onLeave={leave}
                      onOpen={() => onOpen(d)}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
