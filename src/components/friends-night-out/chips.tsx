"use client";

// ---------------------------------------------------------------------------
// The shared visual language.
//
// Price colour is the one thing that has to read identically in all four views,
// so it lives here rather than in each card. The mapping is deliberately not
// four shades of one hue — free vs paid is the fastest decision a person makes
// scanning this board, and it should survive a squint.
// ---------------------------------------------------------------------------

import type { Price, PriceTier, VibeTag } from "@/lib/friends-night-out/types";

const TIER_STYLE: Record<PriceTier, { bg: string; text: string; edge: string; label: string }> = {
  free: { bg: "rgba(52,211,153,0.14)", text: "#6ee7b7", edge: "#34d399", label: "Free" },
  paid: { bg: "rgba(251,191,36,0.14)", text: "#fcd34d", edge: "#fbbf24", label: "Paid" },
  donation: { bg: "rgba(167,139,250,0.16)", text: "#c4b5fd", edge: "#a78bfa", label: "Donation" },
  unknown: { bg: "rgba(148,163,184,0.12)", text: "#94a3b8", edge: "#475569", label: "Price not listed" },
};

/** The 3px bar down the left of every card. */
export function priceEdge(tier: PriceTier): string {
  return TIER_STYLE[tier].edge;
}

function priceText(price: Price): string {
  if (price.tier === "free") return price.note ?? "Free";
  if (price.tier === "donation") return price.note ?? "Donation";
  if (price.tier === "unknown") return "Price not listed";
  if (price.min !== undefined && price.max !== undefined && price.max > price.min) {
    return `$${fmt(price.min)}–${fmt(price.max)}`;
  }
  if (price.min !== undefined) return `$${fmt(price.min)}`;
  return price.note ?? "Paid";
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function PriceChip({ price, dim }: { price: Price; dim?: boolean }) {
  const style = TIER_STYLE[price.tier];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{
        background: style.bg,
        color: style.text,
        opacity: dim ? 0.65 : 1,
      }}
      title={price.note}
    >
      {priceText(price)}
    </span>
  );
}

/**
 * Hidden Gem.
 *
 * Gated on obscurity AND confidence upstream — an unverifiable find never wears
 * this. Without that gate the badge would sit on the least-checked pipeline in
 * the app, since a single-source event scores highest on obscurity by
 * construction.
 */
export function GemBadge({ score }: { score: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
      style={{
        background: "linear-gradient(100deg, rgba(236,72,153,0.22), rgba(56,189,248,0.22))",
        color: "#f9a8d4",
        boxShadow: "0 0 0 1px rgba(236,72,153,0.28), 0 0 18px -6px rgba(236,72,153,0.7)",
      }}
      title={`Obscurity ${score}/100 — few sources carry this`}
    >
      <span aria-hidden>◈</span> Hidden gem
    </span>
  );
}

export function Chip({
  children,
  tone = "neutral",
  title,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "warn";
  title?: string;
}) {
  const tones = {
    neutral: { bg: "rgba(148,163,184,0.10)", color: "#9aa3b5" },
    accent: { bg: "rgba(56,189,248,0.14)", color: "#7dd3fc" },
    warn: { bg: "rgba(251,146,60,0.14)", color: "#fdba74" },
  } as const;
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap"
      style={tones[tone]}
    >
      {children}
    </span>
  );
}

const VIBE_TONE: Record<VibeTag, "neutral" | "accent" | "warn"> = {
  Abandoned: "warn",
  Underground: "accent",
  "Free & Weird": "accent",
  "Big View": "accent",
  "Big Machines": "neutral",
  "Only One Near You": "accent",
  "Locally Owned": "neutral",
};

export function VibeChips({ vibes }: { vibes: VibeTag[] }) {
  if (!vibes.length) return null;
  return (
    <>
      {vibes.slice(0, 3).map((v) => (
        <Chip key={v} tone={VIBE_TONE[v]}>
          {v}
        </Chip>
      ))}
    </>
  );
}

/** Source badges — how many places carry this, which is the obscurity input. */
export function SourceChips({
  sources,
}: {
  sources: { id: string; label: string; url?: string }[];
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {sources.slice(0, 3).map((s, i) => (
        <span
          key={`${s.id}-${s.label}-${i}`}
          className="text-[10px] uppercase tracking-wide"
          style={{ color: "#5b6478" }}
        >
          {s.label}
          {i < Math.min(sources.length, 3) - 1 ? " ·" : ""}
        </span>
      ))}
      {sources.length > 3 ? (
        <span className="text-[10px]" style={{ color: "#5b6478" }}>
          +{sources.length - 3}
        </span>
      ) : null}
    </span>
  );
}
