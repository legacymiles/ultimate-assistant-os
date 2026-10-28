"use client";

// The things that are yours alone in Cook Connect: how you rank each recipe
// (1–10, "for my personal preference" — owner's words) and your settings.
//
// Nobody else reads these, so they are one synced blob per account rather than
// database tables: they follow you to every device through app_state, work in
// demo mode with no setup, and need no SQL to be run by hand.

import { useCallback, useSyncExternalStore } from "react";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { clampRank } from "./categories";
import type { Side } from "./sides";

export const PERSONAL_KEY = "cook-connect:personal:v1";

export interface CookSettings {
  /** Which half the app opens on. "last" = wherever you were. */
  openOn: "last" | Side;
  /** Whose posts the feed starts on. */
  feedScope: "following" | "everyone";
  /** Calm the scroll and page animations. "system" follows the device setting. */
  motion: "system" | "full" | "reduced";
  /** Rank shown on recipe cards in lists. */
  showRanksOnCards: boolean;
}

export const DEFAULT_SETTINGS: CookSettings = {
  openOn: "last",
  feedScope: "following",
  motion: "system",
  showRanksOnCards: true,
};

export interface PersonalData {
  /** recipe id → 1..10 */
  ranks: Record<string, number>;
  /** recipe id → when it was ranked, newest first in "Recently ranked". */
  rankedAt: Record<string, string>;
  settings: CookSettings;
}

type Blob = Record<string, PersonalData>;

const EMPTY: PersonalData = { ranks: {}, rankedAt: {}, settings: DEFAULT_SETTINGS };

/** Repair whatever is stored: unknown keys dropped, ranks clamped, settings filled in. */
export function repairPersonal(raw: unknown): PersonalData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<PersonalData>;
  const ranks: Record<string, number> = {};
  for (const [id, v] of Object.entries(r.ranks ?? {})) {
    const n = clampRank(v);
    if (n) ranks[id] = n;
  }
  const s = (r.settings ?? {}) as Partial<CookSettings>;
  return {
    ranks,
    rankedAt: { ...(r.rankedAt ?? {}) },
    settings: {
      openOn: s.openOn === "cookbook" || s.openOn === "connect" ? s.openOn : "last",
      feedScope: s.feedScope === "everyone" ? "everyone" : "following",
      motion: s.motion === "full" || s.motion === "reduced" ? s.motion : "system",
      showRanksOnCards: s.showRanksOnCards !== false,
    },
  };
}

/* ── A tiny shared store so every screen sees a change at once ─── */

const listeners = new Set<() => void>();
let cache: { blob: Blob; version: number } | null = null;

function read(): Blob {
  if (!cache) cache = { blob: loadLocal<Blob>(PERSONAL_KEY, {}), version: 0 };
  return cache.blob;
}

function write(blob: Blob) {
  cache = { blob, version: (cache?.version ?? 0) + 1 };
  saveSynced(PERSONAL_KEY, blob);
  listeners.forEach((fn) => fn());
}

function reloadFromDisk() {
  cache = { blob: loadLocal<Blob>(PERSONAL_KEY, {}), version: (cache?.version ?? 0) + 1 };
  listeners.forEach((fn) => fn());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const snapshot = () => { read(); return cache!.version; };
const serverSnapshot = () => -1;

/** Read your personal data outside React (e.g. the side to open on). */
export function readPersonal(userId: string | null): PersonalData {
  if (!userId) return EMPTY;
  return repairPersonal(read()[userId]);
}

export function usePersonal(userId: string | null) {
  // Settle against the server once per mount, then re-read.
  useRemotePull(PERSONAL_KEY, reloadFromDisk);
  const version = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const data = version < 0 || !userId ? EMPTY : repairPersonal(read()[userId]);

  const update = useCallback((fn: (prev: PersonalData) => PersonalData) => {
    if (!userId) return;
    const blob = read();
    write({ ...blob, [userId]: fn(repairPersonal(blob[userId])) });
  }, [userId]);

  const setRank = useCallback((recipeId: string, value: number | null) => {
    update((prev) => {
      const ranks = { ...prev.ranks };
      const rankedAt = { ...prev.rankedAt };
      const n = clampRank(value);
      if (n) { ranks[recipeId] = n; rankedAt[recipeId] = new Date().toISOString(); }
      else { delete ranks[recipeId]; delete rankedAt[recipeId]; }
      return { ...prev, ranks, rankedAt };
    });
  }, [update]);

  const updateSettings = useCallback((patch: Partial<CookSettings>) => {
    update((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
  }, [update]);

  return { ...data, setRank, updateSettings };
}
