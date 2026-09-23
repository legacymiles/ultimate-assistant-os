"use client";

// Shared furniture: transport glyphs, the licence chip, the match meter.
// Drawn here rather than pulled from the hub icon set because the set has no
// transport controls, and a Unicode triangle is not an icon.

import type { SVGProps } from "react";
import { cn } from "@/lib/utils";
import type { Licence, LicenceKind } from "@/lib/mp3-download/types";

const glyph = (p: SVGProps<SVGSVGElement>) => ({
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

export const Play = (p: SVGProps<SVGSVGElement>) => (
  <svg {...glyph(p)}>
    <path d="M7 4.8v14.4a.6.6 0 0 0 .92.5l11.3-7.2a.6.6 0 0 0 0-1l-11.3-7.2a.6.6 0 0 0-.92.5Z" />
  </svg>
);

export const Pause = (p: SVGProps<SVGSVGElement>) => (
  <svg {...glyph(p)}>
    <path d="M9 4v16M15 4v16" />
  </svg>
);

export const Waves = (p: SVGProps<SVGSVGElement>) => (
  <svg {...glyph(p)}>
    <path d="M3 12h1.5M7.5 8v8M12 5v14M16.5 8v8M21 12h-1.5" />
  </svg>
);

const LICENCE_TONE: Record<LicenceKind, string> = {
  "public-domain": "border-core/35 bg-core/12 text-core",
  cc: "border-support/35 bg-support/12 text-support",
  // Amber, the same as an unstated licence: "rights not verified" is a warning
  // about the row, not a neutral fact, and the colour should say so.
  youtube: "border-amber-400/35 bg-amber-400/10 text-amber-300",
  open: "border-amber-400/35 bg-amber-400/10 text-amber-300",
  own: "border-line bg-panel-2 text-ink-muted",
  preview: "border-accent/35 bg-accent/12 text-accent",
};

export function LicenceChip({ licence, className }: { licence: Licence; className?: string }) {
  const body = (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-[3px] text-[10.5px] font-semibold leading-none tracking-wide",
        LICENCE_TONE[licence.kind],
        className,
      )}
    >
      {licence.label}
    </span>
  );
  if (!licence.url) return body;
  return (
    <a
      href={licence.url}
      target="_blank"
      rel="noreferrer noopener"
      title={"Read the licence: " + licence.label}
      className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
    >
      {body}
    </a>
  );
}

/**
 * The match meter.
 *
 * A number alone ("71") tells nobody whether to trust the row, so the bar is
 * the reading and the number is the precision. Colour carries the verdict:
 * green is the record, blue is probably it, amber is a cover.
 */
export function MatchMeter({ score, reasons }: { score: number; reasons: string[] }) {
  const tone =
    score >= 85 ? "bg-core" : score >= 65 ? "bg-support" : score >= 45 ? "bg-amber-400" : "bg-ink-faint";
  return (
    <span className="flex items-center gap-2" title={reasons.join(" · ")}>
      <span className="relative block h-1 w-14 shrink-0 overflow-hidden rounded-full bg-line">
        <span
          className={cn("absolute inset-y-0 left-0 rounded-full", tone)}
          style={{ width: Math.max(4, score) + "%" }}
        />
      </span>
      <span className="font-mono text-[11px] tabular-nums text-ink-muted">{score}</span>
    </span>
  );
}

/** A small circular transport button used in every table row. */
export function PlayButton({
  active,
  playing,
  loading,
  onClick,
  label,
}: {
  active: boolean;
  playing: boolean;
  loading: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={playing ? "Pause " + label : "Play " + label}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-full border transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
        active
          ? "border-brand/60 bg-brand/20 text-ink shadow-[0_2px_10px_-4px_rgb(99_102_241_/_0.9)]"
          : "border-line bg-panel-2 text-ink-muted hover:border-brand/40 hover:text-ink",
      )}
    >
      {loading ? (
        <Waves width={13} height={13} className="animate-pulse" />
      ) : playing ? (
        <Pause width={12} height={12} />
      ) : (
        <Play width={12} height={12} className="translate-x-px" />
      )}
    </button>
  );
}
