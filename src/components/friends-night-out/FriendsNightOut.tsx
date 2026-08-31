"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as store from "@/lib/friends-night-out/store";
import { DEMO_EVENTS, DEMO_ORIGIN, DEMO_PLACES } from "@/lib/friends-night-out/seed";
import { browserTimeZone } from "@/lib/friends-night-out/time";
import type {
  DateNightPlan,
  FnoData,
  FnoEvent,
  FnoPlace,
  Origin,
  SourceStatus,
  WatchKind,
} from "@/lib/friends-night-out/types";
import { AlwaysOnView } from "./AlwaysOnView";
import { DateNightView } from "./DateNightView";
import { InboxView } from "./InboxView";
import { Onboarding } from "./Onboarding";
import { SourcesPanel, type Discovered } from "./SourcesPanel";
import { UpcomingView } from "./UpcomingView";

// ---------------------------------------------------------------------------
// The shell.
//
// Holds the store, runs the two searches, and owns the tab state. Everything
// below it is presentational — the views receive data and callbacks and never
// touch localStorage, which is what lets a shared backend replace the store
// later without a component rewrite.
// ---------------------------------------------------------------------------

type Tab = "upcoming" | "always" | "date" | "inbox";

const TABS: [Tab, string, string][] = [
  ["upcoming", "Upcoming", "One-off events with a date"],
  ["always", "Always On", "Standing & seasonal places"],
  ["date", "Date Night", "Whole evenings, composed"],
  ["inbox", "Inbox", "Paste a link or a flyer"],
];

export function FriendsNightOut() {
  const [data, setData] = useState<FnoData | null>(null);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [demo, setDemo] = useState(false);

  const [events, setEvents] = useState<FnoEvent[]>([]);
  const [places, setPlaces] = useState<FnoPlace[]>([]);
  const [statuses, setStatuses] = useState<SourceStatus[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingPlaces, setLoadingPlaces] = useState(false);

  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<Discovered[] | null>(null);

  useEffect(() => {
    setData(store.getData());
  }, []);

  const prefs = data?.prefs;
  const origin = prefs?.origin ?? null;

  // ----- searches ---------------------------------------------------------

  const runEventSearch = useCallback(
    async (current: FnoData) => {
      const o = current.prefs.origin;
      if (!o) return;
      setLoadingEvents(true);
      try {
        const res = await fetch("/api/fno/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: o.lat,
            lon: o.lon,
            radiusMi: current.prefs.radiusMi,
            placeLabel: o.label,
            feeds: current.feeds.filter((f) => f.enabled),
            organizers: current.organizers,
            watchlist: current.watchlist,
            skipAiSweep: !current.prefs.aiSweepEnabled,
            // Community calendars publish floating local times. Without the
            // viewer's zone the server resolves them in its own, which shifts
            // every one of them by hours on a UTC host.
            timeZone: browserTimeZone(),
          }),
        });
        const payload = await res.json();
        setEvents(payload.events ?? []);
        setStatuses((prev) => mergeStatuses(prev, payload.sources ?? []));
        store.cacheEvents(payload.events ?? []);
      } catch {
        setStatuses((prev) =>
          mergeStatuses(prev, [
            { id: "feed", label: "Event search", ok: false, error: "The search request failed." },
          ]),
        );
      } finally {
        setLoadingEvents(false);
      }
    },
    [],
  );

  const runPlaceSearch = useCallback(async (current: FnoData) => {
    const o = current.prefs.origin;
    if (!o) return;
    setLoadingPlaces(true);
    try {
      const res = await fetch("/api/fno/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: o.lat, lon: o.lon, radiusMi: current.prefs.radiusMi }),
      });
      const payload = await res.json();
      setPlaces(payload.places ?? []);
      setStatuses((prev) => mergeStatuses(prev, payload.sources ?? []));
      store.cachePlaces(payload.places ?? []);
    } catch {
      setStatuses((prev) =>
        mergeStatuses(prev, [
          { id: "overpass", label: "OpenStreetMap", ok: false, error: "The request failed." },
        ]),
      );
    } finally {
      setLoadingPlaces(false);
    }
  }, []);

  // Show the cache immediately on mount, then refresh behind it. A board that
  // renders instantly and updates beats a spinner every visit.
  useEffect(() => {
    if (!data || !data.prefs.onboarded || demo) return;
    if (data.cache.events.length) setEvents(data.cache.events);
    if (data.cache.places.length) setPlaces(data.cache.places);
    runEventSearch(data);
    runPlaceSearch(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.prefs.onboarded, data?.prefs.origin?.lat, data?.prefs.radiusMi, demo]);

  // ----- mutations --------------------------------------------------------

  const savedEventIds = useMemo(
    () => new Set((data?.savedEvents ?? []).map((e) => e.id)),
    [data],
  );
  const savedPlaceIds = useMemo(
    () => new Set((data?.savedPlaces ?? []).filter((p) => p.savedAt).map((p) => p.id)),
    [data],
  );
  const savedPlanIds = useMemo(
    () => new Set((data?.savedPlans ?? []).map((p) => p.id)),
    [data],
  );
  const dismissed = useMemo(
    () => (data ? store.dismissedIds(data) : new Set<string>()),
    [data],
  );

  const visiblePlaces = useMemo(
    () => places.filter((p) => !p.osmId || !dismissed.has(p.osmId)),
    [places, dismissed],
  );

  // Saved events live alongside search results so an Inbox addition appears in
  // Upcoming without waiting for a refetch.
  const allEvents = useMemo(() => {
    const inbox = (data?.savedEvents ?? []).filter((e) =>
      e.sources.some((s) => s.id === "inbox"),
    );
    const byId = new Set(events.map((e) => e.id));
    return [...events, ...inbox.filter((e) => !byId.has(e.id))];
  }, [events, data]);

  function apply(next: FnoData) {
    setData(next);
  }

  async function discover() {
    if (!origin || !data) return;
    setDiscovering(true);
    setDiscovered(null);
    try {
      const res = await fetch("/api/fno/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: origin.lat, lon: origin.lon, radiusMi: data.prefs.radiusMi }),
      });
      const payload = await res.json();
      setDiscovered(payload.feeds ?? []);
    } catch {
      setDiscovered([]);
    } finally {
      setDiscovering(false);
    }
  }

  // ----- render -----------------------------------------------------------

  if (!data) {
    return <div className="min-h-screen bg-[#0a0b0f]" />;
  }

  if (!data.prefs.onboarded && !demo) {
    return (
      <div className="min-h-screen bg-[#0a0b0f]">
        <Onboarding
          onDone={(o: Origin, radiusMi) => {
            const next = store.updatePrefs({ origin: o, radiusMi, onboarded: true });
            apply(next);
          }}
          onDemo={() => {
            setDemo(true);
            setEvents(DEMO_EVENTS);
            setPlaces(DEMO_PLACES);
            setStatuses([
              {
                id: "seed",
                label: "Demo data",
                ok: true,
                reason: "Invented listings so the empty app has something to show.",
                count: DEMO_EVENTS.length + DEMO_PLACES.length,
              },
            ]);
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0b0f] text-[#e9ecf3]">
      <header className="sticky top-0 z-20 border-b border-[#1a1e26] bg-[#0a0b0f]/92 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-5 py-3">
          <Link
            href="/"
            className="text-[12px] text-[#5b6478] transition-colors hover:text-[#9aa3b5]"
          >
            ← OS
          </Link>
          <h1 className="text-[15px] font-semibold">Friends Night Out</h1>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <RadiusControl
              origin={demo ? { ...DEMO_ORIGIN } : origin}
              radiusMi={data.prefs.radiusMi}
              disabled={demo}
              onChange={(radiusMi) => apply(store.updatePrefs({ radiusMi }))}
              onReset={() => apply(store.updatePrefs({ onboarded: false }))}
            />
            <button
              type="button"
              onClick={() => setSourcesOpen((v) => !v)}
              className="rounded-lg border border-[#20242f] bg-[#101219] px-2.5 py-1.5 text-[12px] text-[#7c839a] hover:text-[#c3cad9]"
            >
              Sources
              <span className="ml-1.5 text-[11px] text-[#5b6478]">
                {statuses.filter((s) => s.ok).length}/{statuses.length || 0}
              </span>
            </button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-5 pb-2">
          {TABS.map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              title={hint}
              className="whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] transition-colors"
              style={{
                background: tab === id ? "#1a1e28" : "transparent",
                color: tab === id ? "#e9ecf3" : "#6b7385",
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {demo ? (
        <div className="border-b border-[#2c2418] bg-[#161208] px-5 py-2 text-center text-[12px] text-[#d4a15e]">
          Demo data — these listings are invented.{" "}
          <button
            type="button"
            onClick={() => {
              setDemo(false);
              setEvents([]);
              setPlaces([]);
              setStatuses([]);
            }}
            className="underline"
          >
            Set your real location
          </button>
        </div>
      ) : null}

      <main className="mx-auto grid max-w-6xl gap-5 px-5 py-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {tab === "upcoming" ? (
            <UpcomingView
              events={allEvents}
              savedIds={savedEventIds}
              loading={loadingEvents && !allEvents.length}
              onSave={(e) => apply(savedEventIds.has(e.id) ? store.unsaveEvent(e.id) : store.saveEvent(e))}
              onGoing={(e) => apply(store.toggleGoing(e.id))}
            />
          ) : null}

          {tab === "always" ? (
            <AlwaysOnView
              places={visiblePlaces}
              savedIds={savedPlaceIds}
              loading={loadingPlaces && !places.length}
              onSave={(p) => apply(savedPlaceIds.has(p.id) ? store.unsavePlace(p.id) : store.savePlace(p))}
              onDismiss={(p) => apply(store.dismissPlace(p))}
            />
          ) : null}

          {tab === "date" ? (
            <DateNightView
              origin={demo ? DEMO_ORIGIN : origin}
              places={visiblePlaces}
              events={allEvents}
              savedPlanIds={savedPlanIds}
              onSavePlan={(p: DateNightPlan) =>
                apply(savedPlanIds.has(p.id) ? store.unsavePlan(p.id) : store.savePlan(p))
              }
            />
          ) : null}

          {tab === "inbox" ? (
            <InboxView
              savedEvents={data.savedEvents}
              organizers={data.organizers}
              savedIds={savedEventIds}
              onAdd={(e) => apply(store.addInboxEvent(e))}
              onFollowOrganizer={(hint) => apply(store.addOrganizer(hint))}
              onUnfollow={(id) => apply(store.removeOrganizer(id))}
              onSave={(e) => apply(savedEventIds.has(e.id) ? store.unsaveEvent(e.id) : store.saveEvent(e))}
              onGoing={(e) => apply(store.toggleGoing(e.id))}
            />
          ) : null}
        </div>

        {sourcesOpen ? (
          <SourcesPanel
            statuses={statuses}
            feeds={data.feeds}
            watchlist={data.watchlist}
            aiSweepEnabled={data.prefs.aiSweepEnabled}
            discovering={discovering}
            discovered={discovered}
            onClose={() => setSourcesOpen(false)}
            onDiscover={discover}
            onAcceptDiscovered={(d) => {
              const next = store.addFeed({ label: d.label, url: d.url, kind: d.kind });
              apply(next);
              setDiscovered((prev) => prev?.filter((x) => x.url !== d.url) ?? null);
              runEventSearch(next);
            }}
            onAddFeed={(label, url) => {
              const next = store.addFeed({ label, url });
              apply(next);
              runEventSearch(next);
            }}
            onRemoveFeed={(id) => apply(store.removeFeed(id))}
            onToggleFeed={(id, enabled) => apply(store.updateFeed(id, { enabled }))}
            onAddWatch={(kind: WatchKind, name) => apply(store.addWatch(kind, name))}
            onRemoveWatch={(id) => apply(store.removeWatch(id))}
            onToggleAiSweep={() =>
              apply(store.updatePrefs({ aiSweepEnabled: !data.prefs.aiSweepEnabled }))
            }
          />
        ) : null}
      </main>
    </div>
  );
}

function RadiusControl({
  origin,
  radiusMi,
  disabled,
  onChange,
  onReset,
}: {
  origin: Origin | null;
  radiusMi: number;
  disabled?: boolean;
  onChange: (r: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#20242f] bg-[#101219] px-2.5 py-1.5">
      <button
        type="button"
        onClick={onReset}
        disabled={disabled}
        className="max-w-[190px] truncate text-[12px] text-[#c3cad9] hover:underline disabled:no-underline disabled:opacity-70"
        title="Change location"
      >
        {origin?.label ?? "Set a location"}
      </button>
      <span aria-hidden className="text-[#333a4a]">
        |
      </span>
      <select
        value={radiusMi}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="bg-transparent text-[12px] text-[#7c839a] outline-none disabled:opacity-50"
        aria-label="Search radius"
      >
        {[10, 15, 25, 40, 60, 100].map((r) => (
          <option key={r} value={r} className="bg-[#101219]">
            {r} mi
          </option>
        ))}
      </select>
    </div>
  );
}

/** Keep one row per source, newest result wins, so both searches can report. */
function mergeStatuses(prev: SourceStatus[], next: SourceStatus[]): SourceStatus[] {
  const byKey = new Map(prev.map((s) => [`${s.id}:${s.label}`, s]));
  for (const s of next) byKey.set(`${s.id}:${s.label}`, s);
  return [...byKey.values()];
}
