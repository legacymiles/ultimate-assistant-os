// ---------------------------------------------------------------------------
// Auteur — project persistence.
//
// Same local-first shape as the rest of the hub: the list of projects is one
// JSON blob under one key, saved through saveSynced so it also lands in the
// signed-in user's app_state row and follows them across devices.
//
// Only STRUCTURE is stored here. Reference images, uploaded audio and rendered
// clips are bytes, and bytes go to IndexedDB (media.ts) keyed by the mediaId
// the structure carries. That keeps this blob small enough for localStorage
// and for a jsonb row, and it is why a project survives a reload here where
// Seedance Studio's did not. A thumbnail per reference is the one exception:
// a few KB of data URL so cards render before IndexedDB answers.
// ---------------------------------------------------------------------------

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { nowIso, uid } from "@/lib/utils";
import { templateById } from "./constants";
import type { Project, Scene, Shot, ShotTake } from "./types";

/** Also the app_state sync key; components pass it to useRemotePull. */
export const KEY = "auteur:v1";

export function blankProject(seed: Partial<Project> = {}): Project {
  const ts = nowIso();
  const templateId = seed.templateId ?? "short-film";
  const template = templateById(templateId);
  return {
    id: uid("prj"),
    title: "Untitled",
    idea: "",
    templateId,
    genreIds: [],
    aspectRatio: template.aspect,
    targetDurationSec: template.targetSec,
    status: "draft",
    concept: null,
    characters: [],
    worlds: [],
    style: null,
    scenes: [],
    references: [],
    audio: null,
    notes: "",
    createdAt: ts,
    updatedAt: ts,
    ...seed,
  };
}

export function blankTake(prompt: string, posterHue: number, retakeNote?: string): ShotTake {
  return {
    id: uid("tk"),
    createdAt: nowIso(),
    prompt,
    status: "queued",
    engine: "placeholder",
    posterHue,
    retakeNote,
  };
}

export function loadProjects(): Project[] {
  const list = loadLocal<Project[]>(KEY, []);
  return Array.isArray(list) ? list.map(normalize) : [];
}

export function saveProject(project: Project): Project[] {
  const list = loadProjects();
  const next = { ...serialize(project), updatedAt: nowIso() };
  const idx = list.findIndex((p) => p.id === project.id);
  if (idx >= 0) list[idx] = next;
  else list.unshift(next);
  saveSynced(KEY, list);
  return list;
}

export function deleteProject(id: string): Project[] {
  const list = loadProjects().filter((p) => p.id !== id);
  saveSynced(KEY, list);
  return list;
}

/** What is written. Structure only; nothing here is heavy. */
function serialize(p: Project): Project {
  return p;
}

/**
 * Fill in fields older saves may lack, so a schema bump never breaks a load.
 *
 * Also settles any take that was mid-generation when the page was last
 * open: it cannot be resumed, so it becomes an error the user can retry
 * rather than a spinner that never ends. This happens on LOAD, never on
 * save, because a save happens while a render is legitimately in flight.
 */
function normalize(p: Project): Project {
  const base = blankProject();
  return {
    ...base,
    ...p,
    characters: p.characters ?? [],
    worlds: p.worlds ?? [],
    references: p.references ?? [],
    scenes: (p.scenes ?? []).map((s: Scene) => ({
      ...s,
      shots: (s.shots ?? []).map((sh: Shot) => ({
        ...sh,
        dialogue: sh.dialogue ?? "",
        takes: (sh.takes ?? []).map((t) =>
          t.status === "generating" || t.status === "queued"
            ? { ...t, status: "error" as const, error: "Interrupted — retry" }
            : t,
        ),
        referenceIds: sh.referenceIds ?? [],
        prompt: sh.prompt ?? { text: "", cameraLine: "", soundscape: "", music: "", references: [], notes: "" },
      })),
    })),
  };
}

// ----- small tree helpers the UI leans on ----------------------------------

export function allShots(p: Project): { scene: Scene; shot: Shot; index: number }[] {
  const out: { scene: Scene; shot: Shot; index: number }[] = [];
  let i = 0;
  for (const scene of p.scenes) for (const shot of scene.shots) out.push({ scene, shot, index: i++ });
  return out;
}

export function findShot(p: Project, shotId: string): { scene: Scene; shot: Shot; index: number } | null {
  return allShots(p).find((x) => x.shot.id === shotId) ?? null;
}

export function updateShot(p: Project, shotId: string, fn: (s: Shot) => Shot): Project {
  return {
    ...p,
    scenes: p.scenes.map((sc) => ({
      ...sc,
      shots: sc.shots.map((sh) => (sh.id === shotId ? fn(sh) : sh)),
    })),
  };
}

export function activeTake(shot: Shot): ShotTake | null {
  return shot.takes.find((t) => t.id === shot.activeTakeId) ?? shot.takes[shot.takes.length - 1] ?? null;
}

export function totalDuration(p: Project): number {
  return allShots(p).reduce((s, x) => s + x.shot.durationSec, 0);
}

export function progress(p: Project): { done: number; total: number } {
  const shots = allShots(p);
  const done = shots.filter((x) => activeTake(x.shot)?.status === "done").length;
  return { done, total: shots.length };
}
