"use client";

import { useMemo, useRef, useState } from "react";
import type { ChartPoint } from "@/lib/calculator/engine";

interface Props {
  points: ChartPoint[];
  /** Vertical reference lines (e.g. break-even, target, current price). */
  markers?: { price: number; label: string; color: string }[];
  pricePrecision: number;
  height?: number;
}

// Self-contained SVG profit chart. No charting library; renders fast even on
// mobile, animates with CSS, and shows a live crosshair tooltip on hover.
export function ProfitChart({ points, markers = [], pricePrecision, height = 240 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; p: ChartPoint } | null>(null);

  const { path, areaPath, zeroY, scaleX, scaleY, minPnl, maxPnl, minPrice, maxPrice } = useMemo(
    () => buildPaths(points, height),
    [points, height],
  );

  if (!points.length) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl border border-dashed border-line text-xs text-ink-faint"
        style={{ height }}
      >
        Add orders to see the profit curve.
      </div>
    );
  }

  const W = 1000; // viewBox width; SVG scales to container.
  const padL = 56;
  const padR = 16;
  const padTop = 12;
  const padBot = 28;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const ratio = (px - padL) / (W - padL - padR);
    const idx = Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))));
    const p = points[idx];
    setHover({ x: scaleX(p.price), y: scaleY(p.pnl), p });
  };

  return (
    <div ref={wrapRef} className="relative">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="block h-auto w-full"
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Zero line */}
        {minPnl < 0 && maxPnl > 0 && (
          <line
            x1={padL}
            x2={W - padR}
            y1={zeroY}
            y2={zeroY}
            stroke="#262a38"
            strokeDasharray="3 4"
          />
        )}

        {/* P/L area: green above zero, red below */}
        {path && (
          <>
            <defs>
              <linearGradient id="moc-up" x1="0" y1={padTop} x2="0" y2={zeroY} gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#22c55e" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="moc-down" x1="0" y1={zeroY} x2="0" y2={height - padBot} gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#ef4444" stopOpacity="0" />
                <stop offset="100%" stopColor="#ef4444" stopOpacity="0.35" />
              </linearGradient>
              <clipPath id="moc-clip-up">
                <rect x={0} y={padTop} width={W} height={Math.max(0, zeroY - padTop)} />
              </clipPath>
              <clipPath id="moc-clip-down">
                <rect x={0} y={zeroY} width={W} height={Math.max(0, height - padBot - zeroY)} />
              </clipPath>
            </defs>
            <path d={areaPath} fill="url(#moc-up)" clipPath="url(#moc-clip-up)" />
            <path d={areaPath} fill="url(#moc-down)" clipPath="url(#moc-clip-down)" />
            <path d={path} stroke="#6366f1" strokeWidth="2" fill="none" />
          </>
        )}

        {/* Markers (break-even, target, current) */}
        {markers.map((m, i) =>
          m.price >= minPrice && m.price <= maxPrice ? (
            <g key={i}>
              <line
                x1={scaleX(m.price)}
                x2={scaleX(m.price)}
                y1={padTop}
                y2={height - padBot}
                stroke={m.color}
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.8"
              />
              <text
                x={scaleX(m.price) + 4}
                y={padTop + 12}
                fill={m.color}
                fontSize="10"
                fontWeight="600"
              >
                {m.label}
              </text>
            </g>
          ) : null,
        )}

        {/* Y-axis labels (3 ticks) */}
        {[maxPnl, (maxPnl + minPnl) / 2, minPnl].map((v, i) => (
          <text
            key={i}
            x={padL - 8}
            y={scaleY(v) + 4}
            textAnchor="end"
            fontSize="10"
            fill="#6b7385"
          >
            {fmtMoneyShort(v)}
          </text>
        ))}
        {/* X-axis labels */}
        {[minPrice, (minPrice + maxPrice) / 2, maxPrice].map((v, i) => (
          <text
            key={i}
            x={scaleX(v)}
            y={height - 8}
            textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
            fontSize="10"
            fill="#6b7385"
          >
            {v.toFixed(pricePrecision)}
          </text>
        ))}

        {/* Crosshair */}
        {hover && (
          <g>
            <line
              x1={hover.x}
              x2={hover.x}
              y1={padTop}
              y2={height - padBot}
              stroke="#9aa3b5"
              strokeDasharray="2 3"
            />
            <circle cx={hover.x} cy={hover.y} r="4" fill="#6366f1" stroke="#0a0b0f" strokeWidth="2" />
          </g>
        )}
      </svg>

      {/* Tooltip */}
      {hover && wrapRef.current && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-line bg-panel/95 px-2.5 py-1.5 text-[11px] shadow-lg backdrop-blur"
          style={{
            left: `calc(${(hover.x / W) * 100}% + 8px)`,
            top: 8,
          }}
        >
          <div className="font-semibold text-ink">
            {hover.p.price.toFixed(pricePrecision)}
          </div>
          <div className={hover.p.pnl >= 0 ? "text-core" : "text-red-400"}>
            {fmtMoneyShort(hover.p.pnl)}
          </div>
        </div>
      )}
    </div>
  );
}

function buildPaths(points: ChartPoint[], height: number) {
  const W = 1000;
  const padL = 56;
  const padR = 16;
  const padTop = 12;
  const padBot = 28;

  if (!points.length) {
    return {
      path: "",
      areaPath: "",
      zeroY: height / 2,
      scaleX: (_: number) => 0,
      scaleY: (_: number) => 0,
      minPnl: 0,
      maxPnl: 0,
      minPrice: 0,
      maxPrice: 0,
    };
  }

  const prices = points.map((p) => p.price);
  const pnls = points.map((p) => p.pnl);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  let minPnl = Math.min(...pnls, 0);
  let maxPnl = Math.max(...pnls, 0);
  if (minPnl === maxPnl) {
    minPnl -= 1;
    maxPnl += 1;
  }

  const scaleX = (p: number) =>
    padL + ((p - minPrice) / (maxPrice - minPrice || 1)) * (W - padL - padR);
  const scaleY = (v: number) =>
    padTop + (1 - (v - minPnl) / (maxPnl - minPnl)) * (height - padTop - padBot);

  const zeroY = scaleY(0);

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(p.price).toFixed(2)} ${scaleY(p.pnl).toFixed(2)}`)
    .join(" ");
  const areaPath =
    `M ${scaleX(points[0].price).toFixed(2)} ${zeroY.toFixed(2)} ` +
    points
      .map((p) => `L ${scaleX(p.price).toFixed(2)} ${scaleY(p.pnl).toFixed(2)}`)
      .join(" ") +
    ` L ${scaleX(points[points.length - 1].price).toFixed(2)} ${zeroY.toFixed(2)} Z`;

  return { path, areaPath, zeroY, scaleX, scaleY, minPnl, maxPnl, minPrice, maxPrice };
}

function fmtMoneyShort(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}
