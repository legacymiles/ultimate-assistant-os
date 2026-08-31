"use client";

import { formatDistance } from "@/lib/friends-night-out/geo";
import { isHiddenGem } from "@/lib/friends-night-out/normalize";
import type { FnoEvent } from "@/lib/friends-night-out/types";
import { GemBadge, Chip, PriceChip, SourceChips, priceEdge } from "./chips";

// ---------------------------------------------------------------------------
// One dated event.
//
// The card leads with the reason to care, not the metadata: title, then what
// makes it a find (gem badge, followed name, series cadence), then the
// practical line. Price, distance and time are small and last because they are
// what you check AFTER you have decided you are interested.
// ---------------------------------------------------------------------------

export function EventCard({
  event,
  saved,
  onSave,
  onGoing,
  onVenue,
}: {
  event: FnoEvent;
  saved?: boolean;
  onSave?: (e: FnoEvent) => void;
  onGoing?: (e: FnoEvent) => void;
  /** Drill into everything else at this venue — discovery is transitive. */
  onVenue?: (venue: string) => void;
}) {
  const gem = isHiddenGem(event);
  const start = new Date(event.startsAt);

  return (
    <article
      className="group relative flex gap-3 overflow-hidden rounded-xl border transition-all duration-200"
      style={{
        background: "linear-gradient(160deg, #12141c 0%, #14161f 100%)",
        borderColor: gem ? "rgba(236,72,153,0.24)" : "#20242f",
      }}
    >
      {/* Price colour, readable at a glance without reading the chip. */}
      <span
        aria-hidden
        className="w-[3px] shrink-0"
        style={{ background: priceEdge(event.price.tier) }}
      />

      {event.imageUrl ? (
        <div
          className="hidden h-auto w-28 shrink-0 bg-cover bg-center sm:block"
          style={{ backgroundImage: `url(${event.imageUrl})` }}
          role="presentation"
        />
      ) : null}

      <div className="min-w-0 flex-1 px-3 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {gem ? <GemBadge score={event.obscurity} /> : null}
          {event.watchHits?.length ? (
            <Chip tone="accent" title="Matches something on your watchlist">
              ★ {event.watchHits[0]}
            </Chip>
          ) : null}
          {event.series ? (
            <Chip title={`${event.series.occurrences} dates found`}>
              {event.series.label}
            </Chip>
          ) : null}
        </div>

        <h3 className="mt-1.5 truncate text-[15px] font-semibold text-[#e9ecf3]">
          {event.url ? (
            <a
              href={event.url}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:underline"
            >
              {event.title}
            </a>
          ) : (
            event.title
          )}
        </h3>

        {event.description ? (
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-[#8b93a5]">
            {event.description}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-[#7c839a]">
          <time dateTime={event.startsAt} className="text-[#b6bdcd]">
            {formatWhen(start, event.allDay)}
          </time>
          <span aria-hidden>·</span>
          <button
            type="button"
            onClick={() => onVenue?.(event.venue.name)}
            className="truncate text-left hover:text-[#b6bdcd] hover:underline"
            title="See everything else at this venue"
          >
            {event.venue.name}
          </button>
          {event.distanceMi !== undefined ? (
            <>
              <span aria-hidden>·</span>
              <span>{formatDistance(event.distanceMi)}</span>
            </>
          ) : null}
          {event.venue.sizeBand ? (
            <>
              <span aria-hidden>·</span>
              <span>{sizeLabel(event.venue.sizeBand)}</span>
            </>
          ) : null}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <PriceChip price={event.price} />
            <Chip>{event.category}</Chip>
            <SourceChips sources={event.sources} />
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onGoing?.(event)}
              className="rounded-md px-2 py-1 text-[11px] transition-colors"
              style={{
                background: event.going ? "rgba(52,211,153,0.16)" : "transparent",
                color: event.going ? "#6ee7b7" : "#7c839a",
              }}
            >
              {event.going ? "Going" : "I'm in"}
            </button>
            <button
              type="button"
              onClick={() => onSave?.(event)}
              aria-label={saved ? "Saved" : "Save"}
              className="rounded-md px-2 py-1 text-[13px] transition-colors"
              style={{ color: saved ? "#fcd34d" : "#5b6478" }}
            >
              {saved ? "★" : "☆"}
            </button>
          </div>
        </div>

        {/* Confidence is only surfaced when it is low enough to matter — a
            number on every card would be noise, but an unverified event the
            user is about to drive to deserves a warning. */}
        {event.confidence < 0.6 ? (
          <p className="mt-2 text-[11px] text-[#a06a3d]">
            Unverified — this came from one source and could not be confirmed. Check before you go.
          </p>
        ) : null}
      </div>
    </article>
  );
}

function sizeLabel(band: string): string {
  switch (band) {
    case "intimate":
      return "under 100";
    case "small":
      return "100–500";
    case "mid":
      return "500–2k";
    default:
      return "2k+";
  }
}

function formatWhen(d: Date, allDay: boolean): string {
  const now = new Date();
  const days = Math.round((d.getTime() - now.getTime()) / 86_400_000);
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = allDay
    ? ""
    : ` · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;

  if (days === 0) return `Today${time}`;
  if (days === 1) return `Tomorrow${time}`;
  if (days < 7) return `${weekday}${time}`;
  return `${weekday} ${date}${time}`;
}
