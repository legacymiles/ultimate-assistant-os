// ---------------------------------------------------------------------------
// Jarvis's own state: memories, conversations, inbox, calendar, routines.
//
// Same storage contract as every other app in the hub (see src/lib/sync):
// localStorage is the read path, Supabase's app_state row is a second home for
// the same bytes. The owner's Four-Cs profile is NOT here — it stays under the
// New Dashboard key so the rename cannot lose it.
// ---------------------------------------------------------------------------

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { coerceUpdates, emptyUpdates } from "./updates";
import type { JarvisStore, Routine } from "./types";

export const JARVIS_KEY = "jarvis";

/** Short, stable-enough ids. Same approach as the other apps here. */
export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * The five routines from the owner's Everyday Prompt Pack, as editable
 * starting points. They are seeded rather than hardcoded so editing one and
 * reloading keeps the edit.
 */
export const SEED_ROUTINES: Omit<Routine, "id" | "runs">[] = [
  {
    name: "Daily brief",
    needs: ["profile", "calendar", "inbox", "memory"],
    prompt:
      "Give me a daily brief for today in my timezone. Use only what you actually have: my goals, " +
      "tasks, calendar and inbox. Name each source and how fresh it is. Pick my top three " +
      "priorities, one sentence each, flag fixed commitments, and finish with the single best " +
      "action to start now. Separate confirmed facts from suggestions. If something essential is " +
      "missing, tell me what to give you. Do not invent messages, meetings or progress.",
  },
  {
    name: "Triage my inbox",
    needs: ["inbox", "memory", "profile"],
    prompt:
      "Go through my unread messages. For each: what does the sender need, what is time-sensitive, " +
      "and is it Needs reply, Task, Reference or Done? Draft a concise reply for the ones that need " +
      "one, using only confirmed information, in my voice. Do not invent a commitment, deadline, " +
      "price or attachment — mark anything missing for me to fill in. Keep every reply a draft.",
  },
  {
    name: "Plan my week",
    needs: ["calendar", "profile", "memory"],
    prompt:
      "Help me plan this week. Show the source and date range you used and flag overlaps. Propose a " +
      "realistic allocation of focus time around my fixed commitments, leaving buffers for breaks " +
      "and travel. Do not assume an empty calendar proves I am free. Tell me what needs checking. " +
      "Present a draft plan only — do not create or move events.",
  },
  {
    name: "Weekly review",
    needs: ["memory", "calendar", "profile"],
    prompt:
      "Run a weekly review for the last seven days. Compare what I intended with what the records " +
      "actually show. Identify one useful win, the main blocker and one adjustment for next week. " +
      "Propose up to three priorities and one small routine worth repeating. Show which records " +
      "support each conclusion. If the data is incomplete, say so. Suggest any memory or goal " +
      "update as a draft — do not save, send, schedule or complete anything.",
  },
  {
    name: "Capture a memory",
    needs: ["memory"],
    prompt:
      "Turn what I am about to tell you into a proposed memory. Keep only a durable fact, " +
      "preference, decision or lesson that will help later. Give it a title, a category, concise " +
      "content and a source. Separate what I actually said from anything you inferred, and flag a " +
      "conflict with what you already know. Leave unknown dates and sources unknown. Show it to me " +
      "before saving. Never include passwords, keys or whole message histories.",
  },
];

export function emptyJarvis(): JarvisStore {
  return {
    version: 1,
    memories: [],
    proposals: [],
    conversations: [],
    messages: [],
    events: [],
    routines: SEED_ROUTINES.map((r) => ({ ...r, id: uid(), runs: [] })),
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
    messages: arr(r.messages, base.messages),
    events: arr(r.events, base.events),
    // A store saved before the routines existed still gets them.
    routines: arr(r.routines, base.routines).length ? arr(r.routines, base.routines) : base.routines,
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
