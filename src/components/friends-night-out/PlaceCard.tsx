"use client";

import { inSeason, seasonLabel } from "@/lib/friends-night-out/categories";
import { formatDistance } from "@/lib/friends-night-out/geo";
import type { FnoPlace } from "@/lib/friends-night-out/types";
import { Chip, PriceChip, VibeChips, priceEdge } from "./chips";

// ---------------------------------------------------------------------------
// One standing place.
//
// The hook line is the whole card. A place presented as name + category + miles
// is a directory row and produces no reaction, however obscure it actually is —
// so when a hook exists it gets the visual weight, and the taxonomy shrinks to
// a chip.
//
// Two deliberate restraints:
//   The price chip is OMITTED when unknown rather than rendered grey. OSM
//   carries a fee tag on a small minority of places, so a chip on every card
//   would paint the board grey and make the few real ones look curated.
//   Out-of-season cards dim, but only when the season is actually evidenced.
//   An unknown season never dims anything.
// ---------------------------------------------------------------------------

export function PlaceCard({
  place,
  saved,
  onSave,
  onDismiss,
  onNearby,
}: {
  place: FnoPlace;
  saved?: boolean;
  onSave?: (p: FnoPlace) => void;
  onDismiss?: (p: FnoPlace) => void;
  onNearby?: (p: FnoPlace) => void;
}) {
  const open = inSeason(place.season);
  const season = seasonLabel(place.season, place.seasonEvidence);
  const dim = !open;

  return (
    <article
      className="relative flex overflow-hidden rounded-xl border transition-all duration-200"
      style={{
        background: "linear-gradient(160deg, #12141c 0%, #14161f 100%)",
        borderColor: place.obscurity >= 80 ? "rgba(125,211,252,0.20)" : "#20242f",
        opacity: dim ? 0.62 : 1,
      }}
    >
      <span
        aria-hidden
        className="w-[3px] shrink-0"
        style={{
          background:
            place.price.tier === "unknown" ? "#2a3040" : priceEdge(place.price.tier),
        }}
      />

      <div className="min-w-0 flex-1 px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 truncate text-[15px] font-semibold text-[#e9ecf3]">
            {place.url ? (
              <a
                href={place.url}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:underline"
              >
                {place.name}
              </a>
            ) : (
              place.name
            )}
          </h3>
          <span
            className="shrink-0 text-[11px] tabular-nums"
            style={{ color: place.obscurity >= 80 ? "#7dd3fc" : "#5b6478" }}
            title={`Obscurity ${place.obscurity}/100`}
          >
            {place.obscurity}
          </span>
        </div>

        {place.hook ? (
          <p className="mt-1.5 text-[13px] leading-snug text-[#c3cad9]">{place.hook}</p>
        ) : place.description ? (
          <p className="mt-1.5 text-[12.5px] leading-snug text-[#8b93a5]">
            {place.description}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-[#7c839a]">
          <span>{formatDistance(place.distanceMi)}</span>
          {place.address ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{place.address}</span>
            </>
          ) : null}
          {season ? (
            <>
              <span aria-hidden>·</span>
              <span style={{ color: open ? "#7c839a" : "#a06a3d" }}>{season}</span>
            </>
          ) : null}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {place.price.tier !== "unknown" ? <PriceChip price={place.price} /> : null}
            {place.osmTag ? <Chip>{place.osmTag}</Chip> : null}
            <VibeChips vibes={place.vibes} />
            {place.chain ? <Chip title="Part of a chain">chain</Chip> : null}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onNearby?.(place)}
              className="rounded-md px-2 py-1 text-[11px] text-[#7c839a] transition-colors hover:text-[#b6bdcd]"
              title="Other finds within a mile of here"
            >
              nearby
            </button>
            <button
              type="button"
              onClick={() => onDismiss?.(place)}
              className="rounded-md px-2 py-1 text-[11px] text-[#5b6478] transition-colors hover:text-[#9aa3b5]"
              title="Stop showing me this"
            >
              seen it
            </button>
            <button
              type="button"
              onClick={() => onSave?.(place)}
              aria-label={saved ? "Saved" : "Save"}
              className="rounded-md px-2 py-1 text-[13px] transition-colors"
              style={{ color: saved ? "#fcd34d" : "#5b6478" }}
            >
              {saved ? "★" : "☆"}
            </button>
          </div>
        </div>

        {/* An entry nobody has checked in years is more likely to be wrong. */}
        {isStale(place.checkDate) ? (
          <p className="mt-2 text-[11px] text-[#6b7385]">
            Last verified in OpenStreetMap {place.checkDate?.slice(0, 4)} — worth a call ahead.
          </p>
        ) : null}
      </div>
    </article>
  );
}

function isStale(checkDate?: string): boolean {
  if (!checkDate) return false;
  const t = new Date(checkDate).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t > 5 * 365 * 86_400_000;
}
