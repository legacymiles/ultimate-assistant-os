// ---------------------------------------------------------------------------
// Seedance Studio — local persistence.
//
// Mirrors the hub's local-first pattern (see src/lib/repo). Only the STRUCTURE
// of a project is persisted (prompts, moods, effects, names) — never the heavy
// binaries (uploaded media / rendered clips are session-only object URLs), so
// we never blow the localStorage quota. A Postgres-backed repo can implement
// the same shape later; production stores media in Vercel Blob.
// ---------------------------------------------------------------------------

import { saveSynced } from "@/lib/sync/appState";
import { nowIso, uid } from "@/lib/utils";
import { DEFAULT_DURATION, MOODS } from "./constants";
import type { Segment, SeedanceProject } from "./types";
import { scopedKey } from "@/lib/sync/identity";

/** Also the app_state sync key; components pass it to useRemotePull. */
export const KEY = "seedance-studio:v1";

export function blankSegment(): Segment {
  return {
    id: uid("seg"),
    prompt: "",
    mood: MOODS[0].label,
    effect: "None",
    type: "broll",
    durationSec: DEFAULT_DURATION,
    refs: [],
    status: "idle",
  };
}

export function blankProject(): SeedanceProject {
  const ts = nowIso();
  return {
    id: uid("sdp"),
    name: "Untitled reel",
    basePrompt: "",
    globalMood: MOODS[0].label,
    aspectRatio: "16:9",
    song: null,
    segments: [blankSegment()],
    created_at: ts,
    updated_at: ts,
  };
}

/** Strip session-only binaries + volatile generation state before persisting. */
function serialize(p: SeedanceProject): SeedanceProject {
  return {
    ...p,
    song: p.song ? { name: p.song.name, type: p.song.type } : null,
    segments: p.segments.map((s) => ({
      id: s.id,
      prompt: s.prompt,
      mood: s.mood,
      effect: s.effect,
      type: s.type,
      durationSec: s.durationSec,
      refs: s.refs.map((r) => ({ id: r.id, name: r.name, kind: r.kind, type: r.type })),
      status: "idle" as const,
    })),
  };
}

export function loadProjects(): SeedanceProject[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(scopedKey(KEY));
    if (!raw) return [];
    const list = JSON.parse(raw) as SeedanceProject[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveProject(project: SeedanceProject): SeedanceProject[] {
  const list = loadProjects();
  const next = { ...serialize(project), updated_at: nowIso() };
  const idx = list.findIndex((p) => p.id === project.id);
  if (idx >= 0) list[idx] = next;
  else list.unshift(next);
  persist(list);
  return list;
}

export function deleteProject(id: string): SeedanceProject[] {
  const list = loadProjects().filter((p) => p.id !== id);
  persist(list);
  return list;
}

function persist(list: SeedanceProject[]) {
  // Only project structure lives here, never the heavy media, so this blob is
  // small enough to also push to the signed-in user's app_state row. Failures
  // are non-fatal on both paths; the session state is intact regardless.
  saveSynced(KEY, list);
}
