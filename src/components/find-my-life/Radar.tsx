"use client";

// ---------------------------------------------------------------------------
// The Life Radar: you in the middle, every located thing as a blip at its real
// direction and (log-scaled) distance, so the keys in the next room and the car
// across town are both readable at a glance. The sweep lights each blip as it
// passes — the delay comes from the blip's bearing, so it's always in sync.
// With Compass on, the whole dish turns with your phone and the blips point at
// the real things around you.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { bearingDeg, bestFix, distanceM, freshness, RING_LABELS, radarRadius, ringRadius, type Device, type Fix } from "@/lib/find-my-life/engine";
import { KindIcon } from "./KindIcon";

const R = 46; // radar radius in the 100-unit SVG box
const SWEEP_S = 4.2;
/** Ring distances are written along this bearing (just east of south), out of the way. */
const LABEL_A = (163 * Math.PI) / 180;

export interface RadarProps {
  devices: Device[];
  center: Fix | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Phone heading, degrees clockwise from north (Compass mode). */
  heading?: number | null;
  onPing?: () => void;
  mini?: boolean;
  allClear?: boolean;
  label?: string;
}

interface Placed {
  d: Device;
  x: number; // % from left
  y: number; // % from top
  angle: number; // screen degrees, for the sweep delay
  edge: boolean;
}

export function Radar({ devices, center, selectedId, onSelect, heading, onPing, mini, allClear, label }: RadarProps) {
  const [pings, setPings] = useState<number[]>([]);
  const rot = heading ?? 0;

  const placed = useMemo<Placed[]>(() => {
    if (!center) return [];
    const raw = devices
      .map((d) => ({ d, f: bestFix(d) }))
      .filter((x): x is { d: Device; f: Fix } => Boolean(x.f))
      .map(({ d, f }) => {
        const m = distanceM(center, f);
        const r = radarRadius(m) * R;
        const b = bearingDeg(center, f);
        const a = (b * Math.PI) / 180;
        return { d, x: 50 + Math.sin(a) * r, y: 50 - Math.cos(a) * r, angle: b, edge: radarRadius(m) >= 1, m };
      });
    // Never on top of "you": things in the same room sit on a small inner ring
    // at their true direction. Then blips that would overlap (everything at
    // home) push each other apart a little — same side, still readable.
    const rMin = mini ? 5 : 12;
    const minD = mini ? 5 : 10.5;
    const pts = raw.map((p) => {
      const r = Math.max(rMin, Math.hypot(p.x - 50, p.y - 50));
      const a = (p.angle * Math.PI) / 180;
      return { ...p, x: 50 + Math.sin(a) * r, y: 50 - Math.cos(a) * r };
    });
    for (let pass = 0; pass < 60; pass++) {
      let moved = false;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          let dx = pts[j].x - pts[i].x;
          let dy = pts[j].y - pts[i].y;
          let dist = Math.hypot(dx, dy);
          if (dist >= minD) continue;
          if (dist < 0.01) {
            // exactly the same spot: split them sideways, deterministically
            dx = Math.cos(i + j);
            dy = Math.sin(i + j);
            dist = 1;
          }
          const push = (minD - dist) / 2;
          pts[i].x -= (dx / dist) * push;
          pts[i].y -= (dy / dist) * push;
          pts[j].x += (dx / dist) * push;
          pts[j].y += (dy / dist) * push;
          moved = true;
        }
      }
      // keep everything inside the dish and off the centre dot
      for (const p of pts) {
        const r = Math.hypot(p.x - 50, p.y - 50) || 1;
        const clamped = Math.min(R, Math.max(rMin, r));
        p.x = 50 + ((p.x - 50) / r) * clamped;
        p.y = 50 + ((p.y - 50) / r) * clamped;
        p.angle = (Math.atan2(p.x - 50, 50 - p.y) * 180) / Math.PI;
        if (p.angle < 0) p.angle += 360;
      }
      if (!moved) break;
    }
    return pts;
  }, [devices, center, mini]);

  /** Names only where they have room; the picked one always shows. */
  const crowded = (p: Placed) => placed.length > 5 && placed.some((q) => q !== p && Math.abs(q.x - p.x) < 20 && q.y > p.y - 4 && q.y - p.y < 16);

  const sel = placed.find((p) => p.d.id === selectedId);
  const now = new Date();

  const ping = () => {
    const id = Date.now();
    setPings((p) => [...p.slice(-2), id]);
    setTimeout(() => setPings((p) => p.filter((x) => x !== id)), 1200);
    onPing?.();
  };

  return (
    <div className="fml-radar" role="group" aria-label={label ?? "Radar of your things around you"} onClick={mini ? undefined : ping}>
      <div className="fml-radar-face" aria-hidden />
      <div className="fml-rot" style={{ transform: `rotate(${-rot}deg)` }}>
        <div className="fml-sweep" style={{ inset: `${50 - R}%` }} aria-hidden />
        <svg className="fml-svg" viewBox="0 0 100 100" aria-hidden>
          <line className="fml-axis" x1={50} y1={50 - R} x2={50} y2={50 + R} />
          <line className="fml-axis" x1={50 - R} y1={50} x2={50 + R} y2={50} />
          {RING_LABELS.map((l, i) => {
            const r = ringRadius(i) * R;
            return (
              <g key={l}>
                <circle className="fml-ring" cx={50} cy={50} r={r} />
                {!mini && (
                  <text
                    className="fml-ring-label"
                    x={50 + Math.sin(LABEL_A) * r + 1}
                    y={50 - Math.cos(LABEL_A) * r + 1.2}
                    transform={`rotate(${rot} ${50 + Math.sin(LABEL_A) * r} ${50 - Math.cos(LABEL_A) * r})`}
                  >
                    {l}
                  </text>
                )}
              </g>
            );
          })}
          <circle cx={50} cy={50} r={R} fill="none" stroke="rgb(59 227 255 / 0.35)" strokeWidth={0.5} />
          {!mini &&
            [
              ["N", 0],
              ["E", 90],
              ["S", 180],
              ["W", 270],
            ].map(([t, a]) => {
              const rad = ((a as number) * Math.PI) / 180;
              const x = 50 + Math.sin(rad) * (R + 3.6);
              const y = 50 - Math.cos(rad) * (R + 3.6);
              return (
                <text key={t} x={x} y={y} className={`fml-tick ${t === "N" ? "fml-tick-n" : ""}`} transform={`rotate(${rot} ${x} ${y})`}>
                  {t}
                </text>
              );
            })}
          {sel && <line className="fml-bearing" x1={50} y1={50} x2={sel.x} y2={sel.y} />}
        </svg>
        {placed.map((p) => {
          const f = freshness(bestFix(p.d), now);
          const delay = (p.angle / 360) * SWEEP_S;
          return (
            <button
              key={p.d.id}
              type="button"
              className={`fml-blip ${p.edge ? "fml-blip-edge" : ""}`}
              style={{ left: `${p.x}%`, top: `${p.y}%`, transform: `rotate(${rot}deg)` }}
              data-f={f}
              data-lost={p.d.lost ? "true" : undefined}
              aria-pressed={p.d.id === selectedId}
              aria-label={`${p.d.name}${p.edge ? ", far away" : ""}`}
              tabIndex={mini ? -1 : 0}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.(p.d.id);
              }}
            >
              <span className="fml-blip-core" style={{ ["--delay" as string]: `${delay.toFixed(2)}s` }}>
                {!mini && <KindIcon kind={p.d.kind} size={15} />}
              </span>
              {!mini && (p.d.id === selectedId || !crowded(p)) && <span className="fml-blip-name">{p.d.name}</span>}
            </button>
          );
        })}
      </div>
      <span className="fml-you" aria-hidden />
      {pings.map((id) => (
        <span key={id} className="fml-ping" aria-hidden />
      ))}
      {allClear && !mini && <span className="fml-clear">All accounted for</span>}
    </div>
  );
}
