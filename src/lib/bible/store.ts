// ---------------------------------------------------------------------------
// The store.
//
// localStorage is the read path and Supabase is a second home for the same
// bytes (src/lib/sync/appState.ts), exactly as every other app here works: the
// Bible opens instantly, keeps working with no keys configured, and the same
// ideas show up on the phone.
//
// Seeds and the owner's own ideas live together under one rule: SAME ID WINS.
// Edit the seeded plan and the edit is stored under its id, and from then on
// the stored copy IS the idea. Delete it and the id is remembered in
// `hiddenSeeds`, because a deleted seed that comes back on reload is the most
// annoying bug a vault can have.
//
// Everything with logic in it is a pure reducer taking a store and returning a
// new one, so it is testable in vitest's node environment. The two functions
// that touch localStorage have no logic at all.
// ---------------------------------------------------------------------------

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { SEED_IDEAS } from "./seed";
import type { BibleStore, HomeBase, Idea, Plan } from "./types";

export const BIBLE_KEY = "bible:v1";

/** What is actually on this device, before seeds are folded in. */
export function loadRaw(): BibleStore {
  const raw = loadLocal<Partial<BibleStore>>(BIBLE_KEY, {});
  return {
    homeBase: raw.homeBase ?? null,
    ideas: Array.isArray(raw.ideas) ? raw.ideas : [],
    hiddenSeeds: Array.isArray(raw.hiddenSeeds) ? raw.hiddenSeeds : [],
    lastRoom: typeof raw.lastRoom === "string" ? raw.lastRoom : null,
  };
}

export function saveStore(store: BibleStore): void {
  saveSynced(BIBLE_KEY, store);
}

/**
 * Fold the seeds and the stored ideas into one list, by id.
 *
 * A local twelve lines rather than importing EA World's `mergeById`: the two
 * vaults share a pattern, not a dependency, and coupling two unrelated apps so
 * one of them can skip a loop is a trade nobody wants to debug later.
 */
export function mergeSeeded(seeds: Idea[], stored: Idea[], hidden: string[]): Idea[] {
  const hide = new Set(hidden);
  const overrides = new Map(stored.map((i) => [i.id, i]));
  const out: Idea[] = [];

  for (const seed of seeds) {
    // The override is consumed either way: leaving an edited copy in the map
    // means the loop below appends it, which would resurrect a deleted seed.
    const override = overrides.get(seed.id);
    overrides.delete(seed.id);
    if (hide.has(seed.id)) continue;
    out.push(override ?? seed);
  }
  for (const own of stored) {
    if (overrides.has(own.id)) out.push(own);
  }
  return out;
}

export interface BibleView {
  homeBase: HomeBase | null;
  ideas: Idea[];
  /** True for anything the store holds — the owner's own, or an edited seed. */
  isOwn: (id: string) => boolean;
}

export function resolve(raw: BibleStore): BibleView {
  const own = new Set(raw.ideas.map((i) => i.id));
  return {
    homeBase: raw.homeBase,
    ideas: mergeSeeded(SEED_IDEAS, raw.ideas, raw.hiddenSeeds),
    // A seed the owner has edited is stored, so it reads as his — which is
    // true, and is what lets the table show that it is no longer the shipped one.
    isOwn: (id) => own.has(id),
  };
}

export function load(): BibleView {
  return resolve(loadRaw());
}

/** True for an id that only exists as a seed, which `deleteIdea` has to know. */
export function isSeedId(id: string): boolean {
  return SEED_IDEAS.some((i) => i.id === id);
}

// --- reducers --------------------------------------------------------------
// Each returns the new store rather than writing it, so a component holds one
// state and has one save path. A seeded idea edited for the first time arrives
// with no stored copy, so "update" is an upsert.

export function upsertIdea(store: BibleStore, idea: Idea): BibleStore {
  const stamped = { ...idea, updatedAt: new Date().toISOString() };
  const index = store.ideas.findIndex((i) => i.id === idea.id);
  const ideas = index === -1
    ? [...store.ideas, stamped]
    : store.ideas.map((i, at) => (at === index ? stamped : i));
  return { ...store, ideas };
}

export function deleteIdea(store: BibleStore, id: string, isSeed: boolean): BibleStore {
  return {
    ...store,
    ideas: store.ideas.filter((i) => i.id !== id),
    hiddenSeeds: isSeed && !store.hiddenSeeds.includes(id)
      ? [...store.hiddenSeeds, id]
      : store.hiddenSeeds,
  };
}

export function setHomeBase(store: BibleStore, homeBase: HomeBase): BibleStore {
  return { ...store, homeBase };
}

export function setLastRoom(store: BibleStore, lastRoom: string): BibleStore {
  return { ...store, lastRoom };
}

/** The plan on screen: the newest version. Null before one is generated. */
export function currentPlan(idea: Idea): Plan | null {
  return idea.plans.length ? idea.plans[idea.plans.length - 1] : null;
}

/** Keep the old version. "Cheaper" and "the good one" both have to survive. */
export function pushPlan(idea: Idea, plan: Plan): Idea {
  return { ...idea, plans: [...idea.plans, plan] };
}

// `uid` deliberately lives in ./ids and is imported where needed, so the ids the
// server mints while cleaning a generation and the ids the store mints for the
// owner's own ideas come out of one implementation.
