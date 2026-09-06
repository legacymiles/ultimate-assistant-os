// ---------------------------------------------------------------------------
// The vault — local-first data access.
//
// Backed by localStorage. Every mutator returns the fresh board so components
// do `setData(result)` and never read storage directly — the same boundary
// AI Rankings and Recall use, so a server backend can replace `load` and
// `save` without a single component changing.
//
// Dance of the Day is the one exception: those picks are decided server-side
// and merged in here by `mergeDaily`.
// ---------------------------------------------------------------------------

import { saveSynced } from "@/lib/sync/appState";
import { nowIso, uid } from "../utils";
import { isKnownName } from "./names";
import { GENERATED_SEED } from "./seed.generated";
import type { BoardData, Dance } from "./types";

/** Also the app_state sync key; components pass it to useRemotePull. */
export const KEY = "dances:v1";

function buildSeed(): BoardData {
  const at = nowIso();
  return {
    dances: GENERATED_SEED.map((d) => ({
      id: uid("dance"),
      name: d.name,
      aka: d.aka ?? [],
      song: d.song,
      artist: d.artist,
      creator: d.creator,
      year: d.year,
      tags: d.tags ?? [],
      difficulty: d.difficulty,
      video: d.video,
      source: "seed" as const,
      addedAt: at,
      updatedAt: at,
    })),
  };
}

function load(): BoardData {
  if (typeof window === "undefined") return { dances: [] };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) {
      const seeded = buildSeed();
      save(seeded);
      return seeded;
    }
    const data = JSON.parse(raw) as BoardData;
    const dances = Array.isArray(data.dances) ? data.dances : [];
    return {
      dances: dances.map((d) => ({ ...d, aka: d.aka ?? [], tags: d.tags ?? [] })),
    };
  } catch {
    // Corrupt storage is recoverable: reseeding loses personal scores, but a
    // vault that will not open loses everything.
    return buildSeed();
  }
}

function save(data: BoardData): BoardData {
  // Writes locally and, when signed in, pushes the same blob to app_state so
  // the board follows the user to another device. A quota failure or a failed
  // push is swallowed there: the in-memory board is still correct for this
  // session, so returning it beats throwing at the user mid-edit.
  saveSynced(KEY, data);
  return data;
}

export function getBoard(): BoardData {
  return load();
}

export function addDance(input: Partial<Dance> & { name: string }): BoardData {
  const data = load();
  const at = nowIso();
  data.dances.unshift({
    id: uid("dance"),
    aka: [],
    tags: [],
    source: "manual",
    ...input,
    addedAt: at,
    updatedAt: at,
  });
  return save(data);
}

export function updateDance(id: string, patch: Partial<Dance>): BoardData {
  const data = load();
  const d = data.dances.find((x) => x.id === id);
  if (d) Object.assign(d, patch, { updatedAt: nowIso() });
  return save(data);
}

export function removeDance(id: string): BoardData {
  const data = load();
  data.dances = data.dances.filter((d) => d.id !== id);
  return save(data);
}

/** Set or clear a personal score. `undefined` clears it back to unrated. */
export function setScore(id: string, score: number | undefined): BoardData {
  return updateDance(id, { score });
}

/**
 * Fold server-decided daily picks into the local board.
 *
 * Keyed on the video ref rather than the id, because the server mints its own
 * ids and the same pick arrives on every app open. Without this the vault
 * would gain a duplicate of today's dance every time it was opened.
 *
 * Existing records are left alone — a score you gave a daily pick must survive
 * the next merge.
 */
export function mergeDaily(picks: Dance[]): BoardData {
  const data = load();
  const knownRefs = new Set(data.dances.map((d) => d.video?.ref).filter(Boolean));
  const names = data.dances.map((d) => d.name);
  // Two nets, because they catch different things: the ref check stops the same
  // pick being merged on every app open, and the name check stops the same
  // DANCE arriving under a different video — which the server already rejects,
  // but a board restored from an older export has no server history to rely on.
  const fresh = picks.filter(
    (p) => p.video?.ref && !knownRefs.has(p.video.ref) && !isKnownName(p.name, names)
  );
  if (!fresh.length) return data;
  data.dances.unshift(...fresh);
  return save(data);
}

/** Names only — what Dance of the Day is told to avoid picking again. */
export function knownNames(data: BoardData): string[] {
  return data.dances.map((d) => d.name);
}
