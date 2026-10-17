// ---------------------------------------------------------------------------
// Jarvis's own state: memories, conversations, inbox, calendar.
//
// Same storage contract as every other app in the hub (see src/lib/sync):
// localStorage is the read path, Supabase's app_state row is a second home for
// the same bytes. The owner's Four-Cs profile is NOT here — it stays under the
// New Dashboard key so the rename cannot lose it.
// ---------------------------------------------------------------------------

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { coerceUpdates, emptyUpdates } from "./updates";
import type { JarvisStore } from "./types";

export const JARVIS_KEY = "jarvis";

/** Short, stable-enough ids. Same approach as the other apps here. */
export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}


export function emptyJarvis(): JarvisStore {
  return {
    version: 1,
    memories: [],
    proposals: [],
    conversations: [],
    chat: null,
    messages: [],
    events: [],
    actions: [],
    mutedSources: [],
    updates: emptyUpdates(),
    lastSync: "",
  };
}

/**
 * Repair a loaded blob. Storage is shared across devices and app versions, so
 * a missing array here must never take a tab down.
 */
export function coerceStore(raw: unknown): JarvisStore {
  const base = emptyJarvis();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<JarvisStore>;
  const arr = <T,>(v: unknown, fallback: T[]): T[] => (Array.isArray(v) ? (v as T[]) : fallback);
  return {
    version: 1,
    memories: arr(r.memories, base.memories),
    proposals: arr(r.proposals, base.proposals),
    conversations: arr(r.conversations, base.conversations),
    // A store written before the Chat tab had its own transcript has none.
    chat: r.chat && typeof r.chat === "object" && Array.isArray(r.chat.turns) ? r.chat : null,
    messages: arr(r.messages, base.messages),
    events: arr(r.events, base.events),
    actions: arr(r.actions, base.actions),
    mutedSources: arr(r.mutedSources, base.mutedSources),
    updates: coerceUpdates(r.updates),
    lastSync: typeof r.lastSync === "string" ? r.lastSync : "",
  };
}

export function loadJarvis(): JarvisStore {
  return coerceStore(loadLocal<unknown>(JARVIS_KEY, null));
}

export function saveJarvis(store: JarvisStore): void {
  saveSynced(JARVIS_KEY, store);
}
