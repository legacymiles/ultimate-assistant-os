// ---------------------------------------------------------------------------
// Updates — what changed since you last looked.
//
// The dashboard's one live panel. Everything else there is a standing view of
// what Jarvis knows; this is the part that moves.
//
// Two decisions worth knowing, because they are what keep it honest:
//
// 1. UPDATES ARE DERIVED, NEVER STORED. Nothing appends a notification row.
//    Every collector below reads the live data and works out what is news
//    right now. So a deleted list item stops being an update, an item added on
//    the phone appears on the laptop with no sync of its own, and there is no
//    second copy of the truth to drift. The store keeps three small things —
//    a "seen" watermark, the ids you dismissed, the ids that already popped up
//    — and nothing else.
//
// 2. ATTRIBUTION IS ONLY CLAIMED WHERE IT IS RECORDED. A list item knows its
//    author, so "Mum added milk" is safe. A ticked item records only *when* it
//    was completed, never by whom, so that update says "ticked off" and names
//    nobody. Jarvis does not guess who did something.
//
// `at` is for sorting and for the unread comparison; `when` is the phrase the
// row shows. They differ on purpose for the calendar: an event becomes news
// when it comes inside the look-ahead window (that is `at`, and it ages
// normally from there), but the phrase a person wants to read is "in 40m".
// ---------------------------------------------------------------------------

import { eventStart } from "@/lib/recall/calendar/types";
import type { CalendarEvent } from "@/lib/recall/calendar/types";
import type { BoardPayload } from "@/lib/recall/lists/types";
import type { Item } from "@/lib/recall/types";
import type { MemoryProposal, PendingAction } from "./types";

export type UpdateSource = "lists" | "calendar" | "photos" | "memory" | "actions";

export const UPDATE_SOURCES: UpdateSource[] = ["lists", "calendar", "photos", "memory", "actions"];

export const UPDATE_LABEL: Record<UpdateSource, string> = {
  lists: "Lists",
  calendar: "Calendar",
  photos: "Photos",
  memory: "Memory",
  actions: "Waiting on you",
};

/** What each source is allowed to tell you, in the owner's terms. */
export const UPDATE_ABOUT: Record<UpdateSource, string> = {
  lists: "Someone adds or ticks off an item on the family board.",
  calendar: "An event on your calendar is about to start.",
  photos: "Photos arrive from your phone.",
  memory: "Jarvis has something he would like to remember.",
  actions: "An action is sitting on the confirm card, unanswered.",
};

/** The dot beside a row. Same hues as the memory core, so the app reads as one. */
export const UPDATE_COLOR: Record<UpdateSource, string> = {
  lists: "#5ee0c0", // mint
  calendar: "#ff5fa2", // pink
  photos: "#ff9f7f", // coral
  memory: "#8b8cff", // violet
  actions: "#ffd479", // amber
};

/** Which tab a row opens. */
export const UPDATE_TAB: Record<UpdateSource, string> = {
  lists: "lists",
  calendar: "calendar",
  photos: "photos",
  memory: "memory",
  actions: "chat",
};

export interface JarvisUpdate {
  /** Deterministic: the same happening always produces the same id, so
   *  dismissing it sticks and a pop-up fires exactly once. */
  id: string;
  source: UpdateSource;
  title: string;
  /** The quiet half of the line: "added to Shopping", "starts 14:30". */
  detail: string;
  /** ISO. Sorting and the unread comparison only — never displayed. */
  at: string;
  /** The phrase the row shows on the right: "12m ago", "in 40m". */
  when: string;
  /**
   * ISO start time, on the rows that are about something still to happen.
   * These sort above everything else, soonest first: an appointment in
   * 35 minutes belongs at the top of the feed, not filed by when it happened
   * to enter the window. Presence of this field is what "upcoming" means.
   */
  startsAt?: string;
  /** Named only where the data records it. */
  who?: string;
  /** A MEMBER_COLOURS id, when the person has one. */
  colour?: string;
}

export interface SourcePref {
  /** Show this source in the feed at all. */
  on: boolean;
  /** Also raise a browser notification when it is new. */
  popup: boolean;
}

export interface UpdateSettings {
  sources: Record<UpdateSource, SourcePref>;
  /**
   * Include things you did yourself. Off by default: you were there.
   * Only the sources that record an author can honour it.
   */
  includeMine: boolean;
  /** How far back the feed looks. Older than this is not news. */
  windowDays: number;
  /** How early a calendar event starts counting as news. */
  aheadHours: number;
}

export interface UpdateState {
  /** ISO. Anything at or before this has been seen. */
  seenAt: string;
  /** Ids the owner cleared off the feed by hand. */
  dismissed: string[];
  /** Ids that have already raised a pop-up, so none fires twice. */
  notified: string[];
}

export interface UpdatesBlob {
  settings: UpdateSettings;
  state: UpdateState;
}

/** Everything the collectors read. All of it already lives in the app. */
export interface UpdateInputs {
  /** The family board, or null when it could not be read. */
  board: BoardPayload | null;
  events: CalendarEvent[];
  /** Recall items; only the ones under a photo folder are looked at. */
  items: Item[];
  /** Photos root and its descendants. */
  photoFolderIds: Set<string>;
  proposals: MemoryProposal[];
  actions: PendingAction[];
}

/** Ids kept per list before the oldest are forgotten. */
const REMEMBER = 300;

/** Rows in the feed at once. Past this it is an archive, not an update. */
const MAX_ROWS = 60;

export function defaultUpdateSettings(): UpdateSettings {
  const sources = {} as Record<UpdateSource, SourcePref>;
  for (const s of UPDATE_SOURCES) {
    // Pop-ups start off across the board. Turning a notification on is a
    // choice; having one interrupt you unasked is not.
    sources[s] = { on: true, popup: false };
  }
  return { sources, includeMine: false, windowDays: 7, aheadHours: 3 };
}

export function emptyUpdateState(): UpdateState {
  return { seenAt: new Date().toISOString(), dismissed: [], notified: [] };
}

export function emptyUpdates(): UpdatesBlob {
  return { settings: defaultUpdateSettings(), state: emptyUpdateState() };
}

/** Repair a loaded blob. A store written before this feature still works. */
export function coerceUpdates(raw: unknown): UpdatesBlob {
  const base = emptyUpdates();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<UpdatesBlob>;

  const s = (r.settings ?? {}) as Partial<UpdateSettings>;
  const rawSources = (s.sources ?? {}) as Partial<Record<UpdateSource, Partial<SourcePref>>>;
  const sources = {} as Record<UpdateSource, SourcePref>;
  for (const key of UPDATE_SOURCES) {
    const pref = rawSources[key] ?? {};
    sources[key] = {
      on: typeof pref.on === "boolean" ? pref.on : base.settings.sources[key].on,
      popup: typeof pref.popup === "boolean" ? pref.popup : base.settings.sources[key].popup,
    };
  }

  const st = (r.state ?? {}) as Partial<UpdateState>;
  const ids = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-REMEMBER) : [];

  return {
    settings: {
      sources,
      includeMine: s.includeMine === true,
      windowDays: clamp(s.windowDays, 1, 30, base.settings.windowDays),
      aheadHours: clamp(s.aheadHours, 1, 48, base.settings.aheadHours),
    },
    state: {
      seenAt:
        typeof st.seenAt === "string" && !Number.isNaN(Date.parse(st.seenAt))
          ? st.seenAt
          : base.state.seenAt,
      dismissed: ids(st.dismissed),
      notified: ids(st.notified),
    },
  };
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// ----- phrasing ------------------------------------------------------------

/** "just now" / "12m ago" / "3h ago" / "2d ago". */
export function ago(at: string, now: number): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((now - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

/** "now" / "in 40m" / "in 3h". The future half of `ago`. */
export function until(ms: number, now: number): string {
  const mins = Math.round((ms - now) / 60000);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins}m`;
  if (mins < 48 * 60) return `in ${Math.floor(mins / 60)}h`;
  return `in ${Math.floor(mins / 1440)}d`;
}

// ----- collectors ----------------------------------------------------------

/**
 * The family board. Items arrive already filtered to what this viewer may see
 * (the server applies canSee), so nothing here has to think about privacy.
 */
export function listUpdates(board: BoardPayload | null, includeMine: boolean, now: number): JarvisUpdate[] {
  if (!board) return [];
  const listName = (id: string) => board.lists.find((l) => l.id === id)?.name ?? "a list";
  const member = (id: string) => board.members.find((m) => m.id === id);
  const out: JarvisUpdate[] = [];

  for (const item of board.items) {
    const mine = item.authorId === board.me.id;
    if (!mine || includeMine) {
      const who = member(item.authorId);
      out.push({
        id: `lists:add:${item.id}`,
        source: "lists",
        title: item.text,
        detail: `added to ${listName(item.listId)}`,
        at: item.createdAt,
        when: ago(item.createdAt, now),
        who: mine ? "you" : who?.name,
        colour: who?.colour,
      });
    }
    // Completion records a time but not a person, so this row names nobody —
    // and it cannot honour includeMine either, for the same reason.
    if (item.done && item.completedAt) {
      out.push({
        id: `lists:done:${item.id}`,
        source: "lists",
        title: item.text,
        detail: `ticked off in ${listName(item.listId)}`,
        at: item.completedAt,
        when: ago(item.completedAt, now),
      });
    }
  }
  return out;
}

/**
 * Events about to start. An event becomes news when it comes inside the
 * look-ahead window and stops being news 15 minutes after it begins — past
 * that it is not an update, it is something you are already doing or missed.
 */
export function calendarUpdates(events: CalendarEvent[], aheadHours: number, now: number): JarvisUpdate[] {
  const ahead = aheadHours * 3600_000;
  const out: JarvisUpdate[] = [];
  for (const e of events) {
    const start = eventStart(e).getTime();
    if (!Number.isFinite(start)) continue;
    const opens = start - ahead;
    if (now < opens || now > start + 15 * 60_000) continue;
    out.push({
      id: `calendar:soon:${e.id}`,
      source: "calendar",
      title: e.title,
      detail: e.time ? `starts ${e.time}${e.location ? ` · ${e.location}` : ""}` : "all day today",
      at: new Date(opens).toISOString(),
      startsAt: new Date(start).toISOString(),
      when: until(start, now),
    });
  }
  return out;
}

/**
 * Photos that arrived from the phone, one row per day rather than one per
 * photo — a Shortcut run drops forty at once and forty rows is not an update,
 * it is a wall.
 */
export function photoUpdates(items: Item[], folderIds: Set<string>, now: number): JarvisUpdate[] {
  const byDay = new Map<string, { n: number; newest: string }>();
  for (const it of items) {
    if (it.kind !== "image" || !it.folderId || !folderIds.has(it.folderId)) continue;
    const at = it.createdAt;
    if (!at || Number.isNaN(Date.parse(at))) continue;
    const day = at.slice(0, 10);
    const cur = byDay.get(day);
    if (!cur) byDay.set(day, { n: 1, newest: at });
    else {
      cur.n += 1;
      if (at > cur.newest) cur.newest = at;
    }
  }
  return [...byDay.entries()].map(([day, { n, newest }]) => ({
    id: `photos:${day}`,
    source: "photos" as const,
    title: `${n} photo${n === 1 ? "" : "s"} from your phone`,
    detail: "filed under Photos",
    at: newest,
    when: ago(newest, now),
  }));
}

/** Memories Jarvis drafted after a conversation and has not been told to keep. */
export function memoryUpdates(proposals: MemoryProposal[], now: number): JarvisUpdate[] {
  return proposals.map((p) => ({
    id: `memory:${p.id}`,
    source: "memory" as const,
    title: p.title,
    detail: "Jarvis wants to remember this",
    at: p.createdAt,
    when: ago(p.createdAt, now),
  }));
}

/** Confirm cards nobody has answered. These never go stale on their own. */
export function actionUpdates(actions: PendingAction[], now: number): JarvisUpdate[] {
  return actions
    .filter((a) => a.status === "pending")
    .map((a) => ({
      id: `actions:${a.id}`,
      source: "actions" as const,
      title: a.summary,
      detail: `${a.app} · waiting for your yes`,
      at: a.createdAt,
      when: ago(a.createdAt, now),
    }));
}

// ----- assembly ------------------------------------------------------------

export interface Collected {
  updates: JarvisUpdate[];
  /** How many are newer than the seen watermark. */
  unread: number;
  /** Which ones those are. Upcoming rows are pinned above older unread ones,
   *  so position in the list no longer identifies them. */
  unreadIds: Set<string>;
  /** Per source, how many rows survived — drives the filter chips. */
  counts: Record<UpdateSource, number>;
}

export function collectUpdates(
  inputs: UpdateInputs,
  settings: UpdateSettings,
  state: UpdateState,
  now: number = Date.now(),
): Collected {
  const on = (s: UpdateSource) => settings.sources[s]?.on !== false;
  const raw: JarvisUpdate[] = [
    ...(on("lists") ? listUpdates(inputs.board, settings.includeMine, now) : []),
    ...(on("calendar") ? calendarUpdates(inputs.events, settings.aheadHours, now) : []),
    ...(on("photos") ? photoUpdates(inputs.items, inputs.photoFolderIds, now) : []),
    ...(on("memory") ? memoryUpdates(inputs.proposals, now) : []),
    ...(on("actions") ? actionUpdates(inputs.actions, now) : []),
  ];

  const floor = now - settings.windowDays * 86_400_000;
  const dismissed = new Set(state.dismissed);
  const seen = Date.parse(state.seenAt);

  const updates = raw
    .filter((u) => {
      const t = Date.parse(u.at);
      return Number.isFinite(t) && t >= floor && !dismissed.has(u.id);
    })
    .sort(byUrgency)
    .slice(0, MAX_ROWS);

  const counts = {} as Record<UpdateSource, number>;
  for (const s of UPDATE_SOURCES) counts[s] = 0;
  const unreadIds = new Set<string>();
  for (const u of updates) {
    counts[u.source] += 1;
    if (!Number.isFinite(seen) || Date.parse(u.at) > seen) unreadIds.add(u.id);
  }

  return { updates, unread: unreadIds.size, unreadIds, counts };
}

/**
 * What is about to happen, then what just happened. Within each half the
 * obvious order applies: soonest first above, newest first below.
 */
export function byUrgency(a: JarvisUpdate, b: JarvisUpdate): number {
  if (a.startsAt && b.startsAt) return a.startsAt.localeCompare(b.startsAt);
  if (a.startsAt) return -1;
  if (b.startsAt) return 1;
  return b.at.localeCompare(a.at);
}

export function isUnread(u: JarvisUpdate, state: UpdateState): boolean {
  const seen = Date.parse(state.seenAt);
  return Number.isFinite(seen) ? Date.parse(u.at) > seen : true;
}

/** Updates that should raise a browser notification, and have not yet. */
export function toNotify(
  updates: JarvisUpdate[],
  settings: UpdateSettings,
  state: UpdateState,
): JarvisUpdate[] {
  const already = new Set(state.notified);
  return updates.filter(
    (u) => settings.sources[u.source]?.popup && !already.has(u.id) && isUnread(u, state),
  );
}

// ----- state transitions ---------------------------------------------------

const tail = (list: string[]): string[] => (list.length > REMEMBER ? list.slice(-REMEMBER) : list);

export function markAllRead(state: UpdateState, now: number = Date.now()): UpdateState {
  return { ...state, seenAt: new Date(now).toISOString() };
}

export function dismissUpdate(state: UpdateState, id: string): UpdateState {
  if (state.dismissed.includes(id)) return state;
  return { ...state, dismissed: tail([...state.dismissed, id]) };
}

export function dismissAll(state: UpdateState, updates: JarvisUpdate[], now: number = Date.now()): UpdateState {
  const next = new Set(state.dismissed);
  for (const u of updates) next.add(u.id);
  return { ...state, dismissed: tail([...next]), seenAt: new Date(now).toISOString() };
}

export function recordNotified(state: UpdateState, ids: string[]): UpdateState {
  if (!ids.length) return state;
  const next = new Set(state.notified);
  for (const id of ids) next.add(id);
  return { ...state, notified: tail([...next]) };
}
