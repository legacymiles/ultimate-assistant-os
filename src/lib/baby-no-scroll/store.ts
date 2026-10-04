// ---------------------------------------------------------------------------
// What the app remembers: the parent's settings and their saved shows.
//
// One blob behind the hub's sync helper, which means localStorage is the read
// path and Supabase is an optional second home for the same bytes. The phone
// that a baby actually watches on is rarely the machine the show was found on,
// so this is one of the apps where the sync earns its place.
// ---------------------------------------------------------------------------

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { DEFAULT_SETTINGS, type Settings, type Show, type Target } from "./types";

export const KEY = "baby-no-scroll:v1";

/** Settings as stored, with anything missing or corrupt filled from defaults. */
export function loadSettings(): Settings {
  const raw = loadLocal<Partial<Settings>>(KEY, {});
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    // A bad shows array would take the setup screen down, and a parent would
    // have no way to clear it.
    shows: Array.isArray(raw.shows) ? raw.shows.filter(isShow) : [],
  };
}

export function saveSettings(s: Settings): void {
  saveSynced(KEY, s);
}

function isShow(v: unknown): v is Show {
  if (!v || typeof v !== "object") return false;
  const s = v as Partial<Show>;
  return typeof s.id === "string" && typeof s.name === "string" && !!s.target;
}

/** Newest use first — the thing that went on last night goes on again tonight. */
export function sortedShows(shows: Show[]): Show[] {
  return [...shows].sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0));
}

function keyOf(t: Target): string {
  return t.kind === "playlist" ? `p:${t.id}` : `v:${t.id}:${t.list ?? ""}`;
}

/**
 * Save a show, or bring an existing one back to the top. Saving the same link
 * twice under two names is the sort of mess that makes a list unusable, so the
 * target is the identity and the name is just what it is called today.
 */
export function upsertShow(shows: Show[], name: string, target: Target): Show[] {
  const k = keyOf(target);
  const now = Date.now();
  const existing = shows.find((s) => keyOf(s.target) === k);
  if (existing) {
    return shows.map((s) =>
      s === existing ? { ...s, name: name.trim() || s.name, usedAt: now } : s,
    );
  }
  const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return [...shows, { id, name: name.trim() || "Untitled", target, usedAt: now }];
}

export function touchShow(shows: Show[], id: string): Show[] {
  return shows.map((s) => (s.id === id ? { ...s, usedAt: Date.now() } : s));
}

export function removeShow(shows: Show[], id: string): Show[] {
  return shows.filter((s) => s.id !== id);
}
