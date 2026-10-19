"use client";

// Favorite skills — starred once, found in one place, on every device.
//
// Keyed by the skill's stable slug (falling back to its row id for hand-added
// skills), so a star survives a re-sync that rewrites the skill's text.
// Synced through app_state like the Deck's widget choices.

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import type { Skill } from "./types";

const KEY = "skills-favorites:v1";
const CHANGED = "skills-favorites-changed";

export const favoriteKey = (s: Pick<Skill, "slug" | "id">) => s.slug || s.id;

function read(): string[] {
  const v = loadLocal<{ keys?: unknown }>(KEY, {});
  return Array.isArray(v.keys) ? v.keys.filter((k): k is string => typeof k === "string") : [];
}

export interface Favorites {
  has: (s: Skill) => boolean;
  toggle: (s: Skill) => void;
  count: number;
}

export function useFavorites(): Favorites {
  const [keys, setKeys] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => setKeys(read());
    sync();
    window.addEventListener(CHANGED, sync);
    return () => window.removeEventListener(CHANGED, sync);
  }, []);
  useRemotePull(KEY, () => setKeys(read()));
  const set = useMemo(() => new Set(keys), [keys]);
  const toggle = useCallback((s: Skill) => {
    const k = favoriteKey(s);
    const cur = read();
    const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    saveSynced(KEY, { keys: next });
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return { has: (s) => set.has(favoriteKey(s)), toggle, count: keys.length };
}
