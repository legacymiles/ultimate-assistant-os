"use client";

// ---------------------------------------------------------------------------
// The Studio's charts, hand-drawn in SVG (no chart library on this page).
//
// Following the dataviz method: every chart here is ONE series, so it wears
// the brand colour and needs no legend — the heading names it. Lines are 2px,
// grid and axes recessive, text in ink tokens (never the series colour), and
// every chart has a hover layer: a crosshair + tooltip on lines, a per-cell
// tooltip on the heatmap. Magnitude on the heatmap is one hue, light → dark.
// ---------------------------------------------------------------------------

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { compact } from "@/lib/social-personas/studio";

const BRAND = "var(--color-brand)";

/** A tiny trend line for table rows. Its tooltip is the native title. */
export function Sparkline({ values, width = 84, height = 22, label }: { values: number[]; width?: number; height?: number; label: string }) {
  const id = useId();
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => [i * step, height - 2 - (v / max) * (height - 4)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const total = values.reduce((s, n) => s + n, 0);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${compact(total)} over ${values.length} days`}>
      <title>{`${label}: ${values.map((v) => compact(v)).join(" · ")}`}</title>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--color-brand)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--color-brand)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {total > 0 ? (
        <>
          <path d={`${d}L${width},${height}L0,${height}Z`} fill={`url(#${id})`} />
          <path d={d} fill="none" stroke={BRAND} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        </>
      ) : (
        <line x1={0} x2={width} y1={height - 2} y2={height - 2} stroke="var(--color-line)" strokeDasharray="2 3" />
      )}
    </svg>
  );
}

export interface LinePoint {
  x: number;
  y: number;
  /** Tooltip heading for the point. */
  label: string;
}

/**
 * A single-series line with a crosshair + tooltip. `x` is numeric (hours, or
 * day index); the caller formats ticks and labels.
 */
export function LineChart({
  points,
  height = 180,
  yLabel,
  xTicks,
  empty,
}: {
  points: LinePoint[];
  height?: number;
  yLabel: string;
  xTicks: { x: number; label: string }[];
  empty: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the real pixel width, so text and strokes stay their true size
  // however wide the card is (a scaled viewBox blows 10px labels up to 20px).
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height;
  const pad = { l: 44, r: 12, t: 12, b: 24 };
  const minX = points.length ? points[0].x : 0;
  const maxX = points.length ? Math.max(minX + 1, points[points.length - 1].x) : 1;
  const maxY = niceMax(Math.max(1, ...points.map((p) => p.y)));
  const sx = (x: number) => pad.l + ((x - minX) / (maxX - minX)) * (W - pad.l - pad.r);
  const sy = (y: number) => H - pad.b - (y / maxY) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
  const yTicks = [0, maxY / 2, maxY];

  const onMove = (e: React.PointerEvent) => {
    const svg = ref.current;
    if (!svg || !points.length) return;
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(sx(points[i].x) - x) < Math.abs(sx(points[best].x) - x)) best = i;
    setHover(best);
  };

  if (points.length < 2) {
    return <div className="flex items-center justify-center rounded-lg border border-dashed border-line px-3 text-center text-xs text-ink-faint" style={{ height }}>{empty}</div>;
  }
  const hp = hover != null ? points[hover] : null;
  return (
    <div className="relative" ref={box}>
      <svg
        ref={ref}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block max-w-full touch-none"
        role="img"
        aria-label={`${yLabel} over time, latest ${compact(points[points.length - 1].y)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke="var(--color-line-soft)" />
            <text x={pad.l - 6} y={sy(t) + 3} textAnchor="end" className="fill-[var(--color-ink-faint)] text-[10px] tabular-nums">
              {compact(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t.x} x={sx(t.x)} y={H - 6} textAnchor="middle" className="fill-[var(--color-ink-faint)] text-[10px]">
            {t.label}
          </text>
        ))}
        <path d={`${d}L${sx(points[points.length - 1].x)},${sy(0)}L${sx(points[0].x)},${sy(0)}Z`} fill="var(--color-brand)" opacity={0.1} />
        <path d={d} fill="none" stroke={BRAND} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {/* The latest value, direct-labelled — the one number worth a label. */}
        <circle cx={sx(points[points.length - 1].x)} cy={sy(points[points.length - 1].y)} r={4} fill={BRAND} stroke="var(--color-panel)" strokeWidth={2} />
        {hp && (
          <g pointerEvents="none">
            <line x1={sx(hp.x)} x2={sx(hp.x)} y1={pad.t} y2={H - pad.b} stroke="var(--color-ink-faint)" strokeDasharray="3 3" />
            <circle cx={sx(hp.x)} cy={sy(hp.y)} r={5} fill={BRAND} stroke="var(--color-panel)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-elevated px-2 py-1 text-[11px] shadow-xl"
          style={{ left: `${(sx(hp.x) / W) * 100}%` }}
        >
          <div className="text-ink-faint">{hp.label}</div>
          <div className="font-semibold tabular-nums text-ink">
            {hp.y.toLocaleString()} {yLabel}
          </div>
        </div>
      )}
    </div>
  );
}

function niceMax(n: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  const m = n / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** When-to-post heatmap: 7 days × 24 hours, darker = posts there did better. */
export function TimeHeatmap({ grid, counts }: { grid: (number | null)[][]; counts?: number[][] }) {
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const max = useMemo(() => Math.max(1, ...grid.flat().map((v) => v ?? 0)), [grid]);
  const has = grid.some((r) => r.some((v) => v != null));
  if (!has) return <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-ink-faint">Needs a few posts with dates and views — sync an account or add post links.</div>;
  const hv = hover ? grid[hover.d][hover.h] : null;
  return (
    <div className="relative">
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: "28px repeat(24, minmax(0, 1fr))" }} onPointerLeave={() => setHover(null)}>
        {grid.map((row, d) => (
          <div key={d} className="contents">
            <div className="pr-1 text-right text-[10px] leading-[14px] text-ink-faint">{DOW[d]}</div>
            {row.map((v, h) => (
              <button
                key={h}
                type="button"
                aria-label={`${DOW[d]} ${hourLabel(h)}: ${v == null ? "no posts" : `${v.toFixed(1)}× your usual`}`}
                onPointerEnter={() => setHover({ d, h })}
                onFocus={() => setHover({ d, h })}
                className="h-[14px] rounded-[2px] outline-none ring-brand focus-visible:ring-2"
                style={{
                  background: v == null ? "var(--color-panel-2)" : `color-mix(in oklab, var(--color-brand) ${Math.round(18 + (Math.min(v, max) / max) * 82)}%, var(--color-panel-2))`,
                }}
              />
            ))}
          </div>
        ))}
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="text-center text-[9px] text-ink-faint">
            {h % 6 === 0 ? hourLabel(h) : ""}
          </div>
        ))}
      </div>
      {hover && (
        <div className="pointer-events-none absolute -top-8 right-0 rounded-md border border-line bg-elevated px-2 py-1 text-[11px] shadow-xl">
          <span className="text-ink-faint">
            {DOW[hover.d]} {hourLabel(hover.h)} ·{" "}
          </span>
          <span className="font-semibold text-ink">
            {hv == null ? "no posts yet" : `${hv.toFixed(1)}× your usual reach`}
            {counts && hv != null ? ` (${counts[hover.d][hover.h]} posts)` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

export function hourLabel(h: number): string {
  return h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`;
}

export const DOW_NAMES = DOW;
