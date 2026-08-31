"use client";

import { useMemo, useState } from "react";
import { isHiddenGem, sortEvents } from "@/lib/friends-night-out/normalize";
import {
  EVENT_FORMATS,
  SORT_LABELS,
  SORT_MODES,
  VENUE_SIZES,
  VENUE_SIZE_LABELS,
  type EventFormat,
  type FnoEvent,
  type PriceTier,
  type SortMode,
  type VenueSize,
} from "@/lib/friends-night-out/types";
import { EventCard } from "./EventCard";

// ---------------------------------------------------------------------------
// Upcoming — dated events.
//
// Two decisions worth stating:
//
//   The default sort is "For you", not "Hidden gems". Sorting purely by
//   obscurity puts the least-known thing on top whether or not anyone could
//   want it, which in practice produces a feed of rummage sales. "For you"
//   gates on confidence and then ranks by obscurity, so the top of the list is
//   obscure AND believable. Hidden gems stays one click away for the deep cuts.
//
//   Venue size is a first-class filter. "Something under a hundred people" is
//   an actual request, and no category or price filter can express it.
// ---------------------------------------------------------------------------

interface Filters {
  price: PriceTier | "all";
  size: VenueSize | "all";
  format: EventFormat | "all";
  venue: string | null;
  gemsOnly: boolean;
}

const EMPTY: Filters = {
  price: "all",
  size: "all",
  format: "all",
  venue: null,
  gemsOnly: false,
};

export function UpcomingView({
  events,
  savedIds,
  onSave,
  onGoing,
  loading,
}: {
  events: FnoEvent[];
  savedIds: Set<string>;
  onSave: (e: FnoEvent) => void;
  onGoing: (e: FnoEvent) => void;
  loading: boolean;
}) {
  const [sort, setSort] = useState<SortMode>("for-you");
  const [filters, setFilters] = useState<Filters>(EMPTY);

  const filtered = useMemo(() => {
    let list = events;
    if (filters.price !== "all") list = list.filter((e) => e.price.tier === filters.price);
    if (filters.size !== "all") list = list.filter((e) => e.venue.sizeBand === filters.size);
    if (filters.format !== "all") list = list.filter((e) => e.format === filters.format);
    if (filters.venue) {
      const target = filters.venue.toLowerCase();
      list = list.filter((e) => e.venue.name.toLowerCase() === target);
    }
    // Shares the single definition with the badge — two copies of the
    // thresholds would eventually disagree and the filter would hide gems.
    if (filters.gemsOnly) list = list.filter(isHiddenGem);
    return sortEvents(list, sort);
  }, [events, filters, sort]);

  const groups = useMemo(() => groupByWhen(filtered), [filtered]);
  const active =
    filters.price !== "all" ||
    filters.size !== "all" ||
    filters.format !== "all" ||
    filters.venue !== null ||
    filters.gemsOnly;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[#20242f] bg-[#101219] p-1">
          {SORT_MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setSort(m)}
              className="rounded-md px-2.5 py-1 text-[12px] transition-colors"
              style={{
                background: sort === m ? "#1d212d" : "transparent",
                color: sort === m ? "#e9ecf3" : "#7c839a",
              }}
            >
              {SORT_LABELS[m]}
            </button>
          ))}
        </div>

        <Select
          value={filters.price}
          onChange={(v) => setFilters((f) => ({ ...f, price: v as Filters["price"] }))}
          options={[
            ["all", "Any price"],
            ["free", "Free"],
            ["donation", "Donation"],
            ["paid", "Paid"],
            ["unknown", "Unlisted"],
          ]}
        />
        <Select
          value={filters.size}
          onChange={(v) => setFilters((f) => ({ ...f, size: v as Filters["size"] }))}
          options={[
            ["all", "Any room size"],
            ...VENUE_SIZES.map((s) => [s, VENUE_SIZE_LABELS[s]] as [string, string]),
          ]}
        />
        <Select
          value={filters.format}
          onChange={(v) => setFilters((f) => ({ ...f, format: v as Filters["format"] }))}
          options={[
            ["all", "Any kind"],
            ...EVENT_FORMATS.map((f) => [f, f.replace(/-/g, " ")] as [string, string]),
          ]}
        />

        <button
          type="button"
          onClick={() => setFilters((f) => ({ ...f, gemsOnly: !f.gemsOnly }))}
          className="rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors"
          style={{
            borderColor: filters.gemsOnly ? "rgba(236,72,153,0.35)" : "#20242f",
            background: filters.gemsOnly ? "rgba(236,72,153,0.10)" : "#101219",
            color: filters.gemsOnly ? "#f9a8d4" : "#7c839a",
          }}
        >
          ◈ Gems only
        </button>

        {active ? (
          <button
            type="button"
            onClick={() => setFilters(EMPTY)}
            className="text-[12px] text-[#6b7385] hover:text-[#9aa3b5]"
          >
            clear
          </button>
        ) : null}
      </div>

      {filters.venue ? (
        <div className="flex items-center gap-2 rounded-lg border border-[#20242f] bg-[#101219] px-3 py-2 text-[12.5px] text-[#b6bdcd]">
          Everything at <strong className="font-semibold">{filters.venue}</strong>
          <button
            type="button"
            onClick={() => setFilters((f) => ({ ...f, venue: null }))}
            className="ml-auto text-[#6b7385] hover:text-[#9aa3b5]"
          >
            back to all
          </button>
        </div>
      ) : null}

      {loading ? (
        <Skeletons />
      ) : !filtered.length ? (
        <Empty active={active} total={events.length} />
      ) : (
        groups.map(([label, list]) =>
          list.length ? (
            <section key={label} className="space-y-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5b6478]">
                {label}
                <span className="ml-2 font-normal normal-case tracking-normal text-[#454b5c]">
                  {list.length}
                </span>
              </h2>
              <div className="space-y-2">
                {list.map((e) => (
                  <EventCard
                    key={e.id}
                    event={e}
                    saved={savedIds.has(e.id)}
                    onSave={onSave}
                    onGoing={onGoing}
                    onVenue={(venue) => setFilters((f) => ({ ...f, venue }))}
                  />
                ))}
              </div>
            </section>
          ) : null,
        )
      )}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-[#20242f] bg-[#101219] px-2 py-1.5 text-[12px] text-[#b6bdcd] outline-none focus:border-[#2f3547]"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v} className="bg-[#101219]">
          {label}
        </option>
      ))}
    </select>
  );
}

/**
 * "This weekend" means the weekend you are currently in or heading into.
 *
 * The obvious formula — advance to the next Friday — is off by a full week for
 * three days out of seven. Asked on a Saturday it returns NEXT Friday, so
 * tonight's events fall into "Next 7 days" and the weekend heading shows a
 * weekend eight days away. That is precisely the window in which people open a
 * going-out app, so the bug fired exactly when it mattered most.
 */
function groupByWhen(events: FnoEvent[]): [string, FnoEvent[]][] {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday

  const friday = new Date(now);
  if (day === 5 || day === 6) {
    // Already in it — the weekend started at the most recent Friday.
    friday.setDate(now.getDate() - (day - 5));
  } else if (day === 0) {
    // Sunday is the tail of the weekend that began two days ago.
    friday.setDate(now.getDate() - 2);
  } else {
    friday.setDate(now.getDate() + (5 - day));
  }
  friday.setHours(0, 0, 0, 0);

  const monday = new Date(friday);
  monday.setDate(friday.getDate() + 3);

  const weekOut = new Date(now.getTime() + 7 * 86_400_000);
  const monthOut = new Date(now.getTime() + 31 * 86_400_000);

  const weekend: FnoEvent[] = [];
  const week: FnoEvent[] = [];
  const month: FnoEvent[] = [];
  const later: FnoEvent[] = [];

  for (const e of events) {
    const t = new Date(e.startsAt);
    if (t >= friday && t < monday) weekend.push(e);
    else if (t < weekOut) week.push(e);
    else if (t < monthOut) month.push(e);
    else later.push(e);
  }

  return [
    ["This weekend", weekend],
    ["Next 7 days", week],
    ["This month", month],
    ["Later", later],
  ];
}

function Skeletons() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-[104px] animate-pulse rounded-xl border border-[#1c2029] bg-[#101219]"
        />
      ))}
    </div>
  );
}

function Empty({ active, total }: { active: boolean; total: number }) {
  return (
    <div className="rounded-xl border border-dashed border-[#242938] px-4 py-10 text-center">
      <p className="text-[13.5px] text-[#9aa3b5]">
        {active && total > 0
          ? "Nothing matches those filters."
          : "No events found in this radius yet."}
      </p>
      <p className="mt-1.5 text-[12.5px] text-[#6b7385]">
        {active && total > 0
          ? `${total} events are available with the filters cleared.`
          : "Open Sources and run “Find calendars near me” — community calendars are where the events nobody hears about actually live."}
      </p>
    </div>
  );
}
