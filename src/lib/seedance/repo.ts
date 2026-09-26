// ---------------------------------------------------------------------------
// Music Video Studio — local persistence.
//
// Mirrors the hub's local-first pattern (see src/lib/repo). Only the STRUCTURE
// of a reel is persisted — prompts, deck selections, durations, lip-sync
// placement — never the heavy binaries: the song, uploaded references and
// rendered clips are session-only object URLs, so the localStorage quota is
// never at risk. A Postgres-backed repo can implement the same shape later;
// production stores media in Vercel Blob.
// ---------------------------------------------------------------------------

import { cleanSelection } from "@/lib/studio/cinema";
import { saveSynced } from "@/lib/sync/appState";
import { scopedKey } from "@/lib/sync/identity";
import { nowIso, uid } from "@/lib/utils";
import { DEFAULT_BLOCK_SEC, MAX_BLOCK_SEC, MIN_BLOCK_SEC, blankPrompt } from "./reel";
import type { LipRange, Reel, VideoPrompt } from "./types";

/** Also the app_state sync key; components pass it to useRemotePull. */
export const KEY = "seedance-studio:v3";

export function blankReel(): Reel {
  const ts = nowIso();
  return {
    id: uid("reel"),
    name: "Untitled music video",
    direction: "",
    cinema: {},
    aspectRatio: "16:9",
    song: null,
    prompts: [blankPrompt()],
    lipsync: [],
    created_at: ts,
    updated_at: ts,
  };
}

function serialize(r: Reel): Reel {
  return {
    ...r,
    cinema: cleanSelection(r.cinema),
    song: r.song
      ? { name: r.song.name, type: r.song.type, durationSec: r.song.durationSec }
      : null,
    prompts: r.prompts.map((b) => ({
      id: b.id,
      prompt: b.prompt,
      cinema: cleanSelection(b.cinema),
      refs: b.refs.map((x) => ({ id: x.id, name: x.name, kind: x.kind, type: x.type })),
      durationSec: b.durationSec,
      status: "idle" as const,
    })),
    lipsync: r.lipsync.map((x) => ({
      id: x.id,
      startSec: x.startSec,
      durationSec: x.durationSec,
    })),
  };
}

const num = (v: unknown, fallback: number) => (Number.isFinite(v) ? Number(v) : fallback);

/** Re-hydrate a stored reel, tolerating anything an older version left behind. */
function revive(raw: unknown): Reel | null {
  const r = raw as Partial<Reel> | null;
  if (!r || typeof r !== "object" || !r.id) return null;
  const base = blankReel();
  const prompts = (Array.isArray(r.prompts) ? (r.prompts as VideoPrompt[]) : [])
    .filter((b) => b && typeof b.id === "string")
    .map((b) => ({
      ...b,
      cinema: cleanSelection(b.cinema),
      refs: b.refs ?? [],
      durationSec: Math.min(
        MAX_BLOCK_SEC,
        Math.max(MIN_BLOCK_SEC, num(b.durationSec, DEFAULT_BLOCK_SEC)),
      ),
      status: "idle" as const,
      videoUrl: undefined,
    }));
  const lipsync = (Array.isArray(r.lipsync) ? (r.lipsync as LipRange[]) : [])
    .filter((x) => x && Number.isFinite(x.startSec))
    .map((x) => ({
      id: x.id,
      startSec: num(x.startSec, 0),
      durationSec: Math.max(1, num(x.durationSec, 5)),
    }));
  return {
    ...base,
    ...r,
    cinema: cleanSelection(r.cinema),
    song: r.song ? { ...r.song, url: undefined, peaks: undefined } : null,
    prompts: prompts.length ? prompts : [blankPrompt()],
    lipsync,
  };
}

export function loadReels(): Reel[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(scopedKey(KEY));
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown[];
    if (!Array.isArray(list)) return [];
    return list.map(revive).filter((r): r is Reel => Boolean(r));
  } catch {
    return [];
  }
}

export function saveReel(reel: Reel): Reel[] {
  const list = loadReels();
  const next = { ...serialize(reel), updated_at: nowIso() };
  const idx = list.findIndex((r) => r.id === reel.id);
  if (idx >= 0) list[idx] = next;
  else list.unshift(next);
  persist(list);
  return list;
}

export function deleteReel(id: string): Reel[] {
  const list = loadReels().filter((r) => r.id !== id);
  persist(list);
  return list;
}

function persist(list: Reel[]) {
  // Only structure lives here, never the media, so this blob is small enough to
  // also push to the signed-in owner's app_state row. Failures are non-fatal on
  // both paths; the session state is intact regardless.
  saveSynced(KEY, list.map(serialize));
}
