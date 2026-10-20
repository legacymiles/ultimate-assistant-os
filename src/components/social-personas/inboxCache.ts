"use client";

// The last messages each persona's inbox loaded, kept on this device only, so
// the tab opens instantly and the tab badge can count unread without a fetch.
// Other people's messages never go into the synced persona blob.

import type { InboxThread } from "@/lib/social-personas/inbox";

const key = (personaId: string) => `personas-inbox:${personaId}`;

export function loadInboxCache(personaId: string): InboxThread[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(key(personaId)) ?? "[]");
    return Array.isArray(raw) ? raw.filter((t) => t && typeof t.id === "string" && Array.isArray(t.messages)) : [];
  } catch {
    return [];
  }
}

export function saveInboxCache(personaId: string, threads: InboxThread[]): void {
  try {
    window.localStorage.setItem(key(personaId), JSON.stringify(threads.filter((t) => !t.sample).slice(0, 200)));
  } catch {
    /* storage full or blocked — the inbox still works, it just reloads next time */
  }
}

export function clearInboxCache(personaId: string): void {
  try {
    window.localStorage.removeItem(key(personaId));
  } catch {
    /* ignore */
  }
}
