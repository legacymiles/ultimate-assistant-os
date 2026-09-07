// ---------------------------------------------------------------------------
// Friends Night Out — local-first data access.
//
// Backed by localStorage. Every mutator returns the fresh data so components do
// `setData(result)` and never read storage directly — the same boundary Recall
// and AI Rankings use, so a shared/cloud backend can replace load() and save()
// without a single component changing.
// ---------------------------------------------------------------------------

import { nowIso, uid } from "../utils";
import { DEFAULT_FEEDS } from "./seed";
import type {
  DateNightPlan,
  Feed,
  FnoData,
  FnoEvent,
  FnoPlace,
  OrganizerSub,
  UserPrefs,
  WatchItem,
  WatchKind,
} from "./types";
import { pushRemote, stampLocal } from "@/lib/sync/appState";
import { scopedKey } from "@/lib/sync/identity";

/** Also the app_state sync key; components pass it to useRemotePull. */
export const KEY = "friends-night-out:v1";

export const DEFAULT_RADIUS_MI = 25;

function defaultPrefs(): UserPrefs {
  return {
    origin: null,
    radiusMi: DEFAULT_RADIUS_MI,
    eventCategories: [],
    activityCategories: [],
    aiSweepEnabled: true,
    updatedAt: nowIso(),
    onboarded: false,
  };
}

function emptyData(): FnoData {
  return {
    prefs: defaultPrefs(),
    feeds: [],
    watchlist: [],
    organizers: [],
    savedEvents: [],
    savedPlaces: [],
    savedPlans: [],
    cache: { events: [], places: [] },
  };
}

function buildSeed(): FnoData {
  const at = nowIso();
  return {
    ...emptyData(),
    feeds: DEFAULT_FEEDS.map((f: Omit<Feed, "id" | "addedAt">) => ({
      ...f,
      id: uid("feed"),
      addedAt: at,
    })),
  };
}

// ----- persistence ---------------------------------------------------------

function load(): FnoData {
  if (typeof window === "undefined") return emptyData();
  try {
    const raw = window.localStorage.getItem(scopedKey(KEY));
    if (!raw) return save(buildSeed());
    const parsed = JSON.parse(raw) as Partial<FnoData>;
    // Merge against a fresh shape so a store written by an older build never
    // arrives missing a key the current UI reads.
    const base = emptyData();
    return {
      prefs: { ...base.prefs, ...(parsed.prefs ?? {}) },
      feeds: Array.isArray(parsed.feeds) ? parsed.feeds : base.feeds,
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
      organizers: Array.isArray(parsed.organizers) ? parsed.organizers : [],
      savedEvents: Array.isArray(parsed.savedEvents) ? parsed.savedEvents : [],
      savedPlaces: Array.isArray(parsed.savedPlaces) ? parsed.savedPlaces : [],
      savedPlans: Array.isArray(parsed.savedPlans) ? parsed.savedPlans : [],
      cache: { ...base.cache, ...(parsed.cache ?? {}) },
    };
  } catch {
    return buildSeed();
  }
}

function save(data: FnoData): FnoData {
  // The cached events and places are a refetchable optimisation rather than
  // anything the user typed, so they are stripped before the round trip: the
  // other device can rebuild them, and leaving them out keeps the row small.
  void pushRemote(KEY, { ...data, cache: { events: [], places: [] } });

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(scopedKey(KEY), JSON.stringify(data));
      stampLocal(KEY);
    } catch {
      // Quota is the realistic failure — a big cache of events with images.
      // Drop the cache and retry once; losing it costs one refetch, whereas
      // losing the write costs the user's saved events.
      try {
        const trimmed: FnoData = { ...data, cache: { events: [], places: [] } };
        window.localStorage.setItem(scopedKey(KEY), JSON.stringify(trimmed));
        stampLocal(KEY);
        return trimmed;
      } catch {
        // Give up silently: the in-memory copy is still correct for this session.
      }
    }
  }
  return data;
}

export function getData(): FnoData {
  return load();
}

// ----- preferences ---------------------------------------------------------

export function updatePrefs(patch: Partial<UserPrefs>): FnoData {
  const data = load();
  return save({
    ...data,
    prefs: { ...data.prefs, ...patch, updatedAt: nowIso() },
  });
}

// ----- feeds ---------------------------------------------------------------

export function addFeed(input: { label: string; url: string; kind?: Feed["kind"] }): FnoData {
  const data = load();
  const url = input.url.trim();
  if (!url) return data;
  // Same URL twice is the common paste mistake; treat it as a no-op rather than
  // creating a duplicate that doubles that feed's weight in the obscurity score.
  if (data.feeds.some((f) => f.url === url)) return data;
  const feed: Feed = {
    id: uid("feed"),
    label: input.label.trim() || hostLabel(url),
    url,
    kind: input.kind ?? "auto",
    enabled: true,
    addedAt: nowIso(),
  };
  return save({ ...data, feeds: [...data.feeds, feed] });
}

export function updateFeed(id: string, patch: Partial<Feed>): FnoData {
  const data = load();
  return save({
    ...data,
    feeds: data.feeds.map((f) => (f.id === id ? { ...f, ...patch } : f)),
  });
}

export function removeFeed(id: string): FnoData {
  const data = load();
  return save({ ...data, feeds: data.feeds.filter((f) => f.id !== id) });
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Feed";
  }
}

// ----- saved events & places ----------------------------------------------

export function saveEvent(event: FnoEvent): FnoData {
  const data = load();
  const existing = data.savedEvents.find((e) => e.id === event.id);
  if (existing) return data;
  return save({
    ...data,
    savedEvents: [...data.savedEvents, { ...event, savedAt: nowIso() }],
  });
}

export function unsaveEvent(id: string): FnoData {
  const data = load();
  return save({ ...data, savedEvents: data.savedEvents.filter((e) => e.id !== id) });
}

export function toggleGoing(id: string): FnoData {
  const data = load();
  const inSaved = data.savedEvents.find((e) => e.id === id);
  // Marking "going" on an unsaved event saves it too — you cannot be going to
  // something the app has forgotten about.
  if (!inSaved) {
    const fromCache = data.cache.events.find((e) => e.id === id);
    if (!fromCache) return data;
    return save({
      ...data,
      savedEvents: [
        ...data.savedEvents,
        { ...fromCache, savedAt: nowIso(), going: true },
      ],
    });
  }
  return save({
    ...data,
    savedEvents: data.savedEvents.map((e) =>
      e.id === id ? { ...e, going: !e.going } : e,
    ),
  });
}

export function savePlace(place: FnoPlace): FnoData {
  const data = load();
  if (data.savedPlaces.some((p) => p.id === place.id)) return data;
  return save({
    ...data,
    savedPlaces: [...data.savedPlaces, { ...place, savedAt: nowIso() }],
  });
}

export function unsavePlace(id: string): FnoData {
  const data = load();
  return save({ ...data, savedPlaces: data.savedPlaces.filter((p) => p.id !== id) });
}

/** Events added through the Inbox — they live in savedEvents from birth. */
export function addInboxEvent(event: Omit<FnoEvent, "id" | "savedAt">): FnoData {
  const data = load();
  const full: FnoEvent = { ...event, id: uid("evt"), savedAt: nowIso() };
  return save({ ...data, savedEvents: [...data.savedEvents, full] });
}

// ----- watchlist -----------------------------------------------------------

export function addWatch(kind: WatchKind, name: string): FnoData {
  const data = load();
  const trimmed = name.trim();
  if (trimmed.length < 2) return data;
  const exists = data.watchlist.some(
    (w) => w.kind === kind && w.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (exists) return data;
  const item: WatchItem = { id: uid("watch"), kind, name: trimmed, addedAt: nowIso() };
  return save({ ...data, watchlist: [...data.watchlist, item] });
}

export function removeWatch(id: string): FnoData {
  const data = load();
  return save({ ...data, watchlist: data.watchlist.filter((w) => w.id !== id) });
}

// ----- organizer subscriptions ---------------------------------------------

export function addOrganizer(
  input: Omit<OrganizerSub, "id" | "addedAt">,
): FnoData {
  const data = load();
  const exists = data.organizers.some(
    (o) => o.platform === input.platform && o.externalId === input.externalId,
  );
  if (exists) return data;
  const sub: OrganizerSub = { ...input, id: uid("org"), addedAt: nowIso() };
  return save({ ...data, organizers: [...data.organizers, sub] });
}

export function removeOrganizer(id: string): FnoData {
  const data = load();
  return save({ ...data, organizers: data.organizers.filter((o) => o.id !== id) });
}

// ----- dismissals ----------------------------------------------------------

/**
 * "Seen it" — the board stops re-showing this place.
 *
 * Kept in savedPlaces with a dismissedAt rather than a separate list, so a
 * dismissed place that later gets saved does not end up in both states.
 */
export function dismissPlace(place: FnoPlace): FnoData {
  const data = load();
  const existing = data.savedPlaces.find((p) => p.osmId === place.osmId);
  if (existing) {
    return save({
      ...data,
      savedPlaces: data.savedPlaces.map((p) =>
        p.osmId === place.osmId ? { ...p, dismissedAt: nowIso(), savedAt: undefined } : p,
      ),
    });
  }
  return save({
    ...data,
    savedPlaces: [...data.savedPlaces, { ...place, dismissedAt: nowIso() }],
  });
}

export function undismissPlace(osmId: string): FnoData {
  const data = load();
  return save({
    ...data,
    savedPlaces: data.savedPlaces.filter(
      (p) => !(p.osmId === osmId && p.dismissedAt && !p.savedAt),
    ),
  });
}

/** OSM ids the user has waved away, so the board can filter them out. */
export function dismissedIds(data: FnoData): Set<string> {
  return new Set(
    data.savedPlaces
      .filter((p) => p.dismissedAt && !p.savedAt && p.osmId)
      .map((p) => p.osmId as string),
  );
}

// ----- date night plans ----------------------------------------------------

export function savePlan(plan: DateNightPlan): FnoData {
  const data = load();
  if (data.savedPlans.some((p) => p.id === plan.id)) return data;
  return save({
    ...data,
    savedPlans: [...data.savedPlans, { ...plan, savedAt: nowIso() }],
  });
}

export function unsavePlan(id: string): FnoData {
  const data = load();
  return save({ ...data, savedPlans: data.savedPlans.filter((p) => p.id !== id) });
}

// ----- search cache --------------------------------------------------------

export function cacheEvents(events: FnoEvent[]): FnoData {
  const data = load();
  return save({
    ...data,
    cache: { ...data.cache, events, eventsAt: nowIso() },
  });
}

export function cachePlaces(places: FnoPlace[]): FnoData {
  const data = load();
  return save({
    ...data,
    cache: { ...data.cache, places, placesAt: nowIso() },
  });
}

// ----- export / import -----------------------------------------------------

export function exportJson(): string {
  return JSON.stringify(load(), null, 2);
}

export function importJson(raw: string): FnoData {
  const parsed = JSON.parse(raw) as Partial<FnoData>;
  const base = emptyData();
  return save({
    prefs: { ...base.prefs, ...(parsed.prefs ?? {}) },
    feeds: Array.isArray(parsed.feeds) ? parsed.feeds : [],
    watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
    organizers: Array.isArray(parsed.organizers) ? parsed.organizers : [],
    savedEvents: Array.isArray(parsed.savedEvents) ? parsed.savedEvents : [],
    savedPlaces: Array.isArray(parsed.savedPlaces) ? parsed.savedPlaces : [],
    savedPlans: Array.isArray(parsed.savedPlans) ? parsed.savedPlans : [],
    cache: { events: [], places: [] },
  });
}

export function resetAll(): FnoData {
  return save(buildSeed());
}
