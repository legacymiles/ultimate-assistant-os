"use client";

import { useMemo, useState } from "react";
import { ACTIVITY_CATEGORY_ORDER, inSeason } from "@/lib/friends-night-out/categories";
import { surpriseMe } from "@/lib/friends-night-out/dateNight";
import { distanceMi } from "@/lib/friends-night-out/geo";
import { VIBE_TAGS, type ActivityCategory, type FnoPlace, type VibeTag } from "@/lib/friends-night-out/types";
import { PlaceCard } from "./PlaceCard";

// ---------------------------------------------------------------------------
// Always On — the standing and seasonal board.
//
// Sorted by obscurity rather than distance. A metro has forty climbing gyms and
// one curling sheet; distance-sorting floats the nearest generic thing to the
// top, which is the maps-app failure mode this view exists to avoid. Distance
// is a filter here, not the sort.
//
// "Surprise me" is deliberately prominent. Filtering is a narrowing gesture,
// and someone who already knows the categories they like will never filter
// their way into something new — they have to be handed it.
// ---------------------------------------------------------------------------

export function AlwaysOnView({
  places,
  savedIds,
  onSave,
  onDismiss,
  loading,
}: {
  places: FnoPlace[];
  savedIds: Set<string>;
  onSave: (p: FnoPlace) => void;
  onDismiss: (p: FnoPlace) => void;
  loading: boolean;
}) {
  const [category, setCategory] = useState<ActivityCategory | "all">("all");
  const [vibe, setVibe] = useState<VibeTag | "all">("all");
  const [openNow, setOpenNow] = useState(true);
  const [localOnly, setLocalOnly] = useState(false);
  const [surprise, setSurprise] = useState<FnoPlace | null>(null);
  const [nearbyOf, setNearbyOf] = useState<FnoPlace | null>(null);

  const visible = useMemo(() => {
    let list = places;
    if (category !== "all") list = list.filter((p) => p.category === category);
    if (vibe !== "all") list = list.filter((p) => p.vibes.includes(vibe));
    if (localOnly) list = list.filter((p) => !p.chain);
    // Out-of-season stays visible by default: knowing the rink opens in six
    // weeks is planning information, and hiding it makes the area look emptier
    // than it is.
    if (openNow) list = list.filter((p) => inSeason(p.season));
    return list;
  }, [places, category, vibe, openNow, localOnly]);

  const nearby = useMemo(() => {
    if (!nearbyOf) return [];
    return places
      .filter((p) => p.id !== nearbyOf.id)
      .map((p) => ({ p, d: distanceMi(nearbyOf, p) }))
      .filter((x) => x.d <= 1)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4)
      .map((x) => x.p);
  }, [nearbyOf, places]);

  const categories = useMemo(() => {
    const present = new Set(places.map((p) => p.category));
    return ACTIVITY_CATEGORY_ORDER.filter((c) => present.has(c));
  }, [places]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSurprise(surpriseMe(places, new Date(), new Set(surprise ? [surprise.id] : [])))}
          className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-transform hover:scale-[1.02]"
          style={{
            background: "linear-gradient(100deg, rgba(236,72,153,0.20), rgba(56,189,248,0.20))",
            color: "#f0abfc",
            boxShadow: "0 0 0 1px rgba(236,72,153,0.25)",
          }}
        >
          ✦ Surprise me
        </button>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ActivityCategory | "all")}
          className="rounded-lg border border-[#20242f] bg-[#101219] px-2 py-1.5 text-[12px] text-[#b6bdcd] outline-none focus:border-[#2f3547]"
        >
          <option value="all">Everything</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={vibe}
          onChange={(e) => setVibe(e.target.value as VibeTag | "all")}
          className="rounded-lg border border-[#20242f] bg-[#101219] px-2 py-1.5 text-[12px] text-[#b6bdcd] outline-none focus:border-[#2f3547]"
        >
          <option value="all">Any vibe</option>
          {VIBE_TAGS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>

        <Toggle on={openNow} onClick={() => setOpenNow((v) => !v)} label="Open this season" />
        <Toggle on={localOnly} onClick={() => setLocalOnly((v) => !v)} label="No chains" />
      </div>

      {surprise ? (
        <section
          className="rounded-xl border p-4"
          style={{
            borderColor: "rgba(236,72,153,0.28)",
            background:
              "linear-gradient(140deg, rgba(236,72,153,0.08), rgba(56,189,248,0.06) 60%, transparent)",
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#f0abfc]">
              Go here
            </span>
            <button
              type="button"
              onClick={() => setSurprise(null)}
              className="text-[12px] text-[#6b7385] hover:text-[#9aa3b5]"
            >
              dismiss
            </button>
          </div>
          <h3 className="mt-2 text-[19px] font-semibold text-[#e9ecf3]">{surprise.name}</h3>
          {surprise.hook ? (
            <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-[#c3cad9]">
              {surprise.hook}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-[#8b93a5]">
            <span>{surprise.distanceMi?.toFixed(1)} mi away</span>
            <span aria-hidden>·</span>
            <span>{surprise.category}</span>
            {surprise.url ? (
              <>
                <span aria-hidden>·</span>
                <a
                  href={surprise.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[#7dd3fc] hover:underline"
                >
                  website
                </a>
              </>
            ) : null}
            <a
              href={`https://www.openstreetmap.org/?mlat=${surprise.lat}&mlon=${surprise.lon}#map=17/${surprise.lat}/${surprise.lon}`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[#7dd3fc] hover:underline"
            >
              directions
            </a>
          </div>
        </section>
      ) : null}

      {nearbyOf ? (
        <section className="space-y-2 rounded-xl border border-[#20242f] bg-[#0e1016] p-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[#b6bdcd]">
              Within a mile of <strong>{nearbyOf.name}</strong>
            </span>
            <button
              type="button"
              onClick={() => setNearbyOf(null)}
              className="text-[12px] text-[#6b7385] hover:text-[#9aa3b5]"
            >
              close
            </button>
          </div>
          {nearby.length ? (
            nearby.map((p) => (
              <PlaceCard key={p.id} place={p} saved={savedIds.has(p.id)} onSave={onSave} />
            ))
          ) : (
            <p className="py-2 text-[12.5px] text-[#6b7385]">
              Nothing else within a mile — this one is on its own out there.
            </p>
          )}
        </section>
      ) : null}

      {loading ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-[128px] animate-pulse rounded-xl border border-[#1c2029] bg-[#101219]"
            />
          ))}
        </div>
      ) : !visible.length ? (
        <div className="rounded-xl border border-dashed border-[#242938] px-4 py-10 text-center">
          <p className="text-[13.5px] text-[#9aa3b5]">Nothing here with those filters.</p>
          <p className="mt-1.5 text-[12.5px] text-[#6b7385]">
            {places.length
              ? `${places.length} places are in range with the filters cleared.`
              : "Try a wider radius — the rarest things tend to sit just outside town."}
          </p>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {visible.map((p) => (
            <PlaceCard
              key={p.id}
              place={p}
              saved={savedIds.has(p.id)}
              onSave={onSave}
              onDismiss={onDismiss}
              onNearby={setNearbyOf}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors"
      style={{
        borderColor: on ? "#2f3547" : "#20242f",
        background: on ? "#1a1e28" : "#101219",
        color: on ? "#c3cad9" : "#6b7385",
      }}
    >
      {label}
    </button>
  );
}
