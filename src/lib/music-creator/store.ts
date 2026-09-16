"use client";

// ---------------------------------------------------------------------------
// Music Creator — persistence for projects and the Voice Library.
//
// Two stores, two different rules about what leaves the device.
//
// Projects sync. They are text: a style, lyrics, a score, a few render handles.
// Opening the studio on the laptop and finding last night's phone session there
// is the whole point, and the payload is small enough to belong in a jsonb row.
//
// Voices sync WITHOUT their reference clip. The clip is somebody's recorded
// voice; it is also megabytes of base64 that would bloat every pull. So the
// synced copy keeps the name, the source note and the server reference, and the
// audio stays on the device that made it. The consequence is honest and is
// stated in the UI: a voice appears everywhere, but the clip that can re-register
// it after a server rebuild only exists where it was created.
// ---------------------------------------------------------------------------

import { loadLocal, saveLocal, saveSynced } from "@/lib/sync/appState";
import type { Project, Render, SongRequest, VoiceProfile } from "./types";

export const PROJECTS_KEY = "music-creator.projects";
export const VOICES_KEY = "music-creator.voices";

/** Where a voice's clip lives — device-only, deliberately outside the sync. */
const CLIPS_KEY = "music-creator.voice-clips";

/** YuE2's own default seed, so an untouched project matches its example. */
export const DEFAULT_SEED = 831001;

export function emptyRequest(): SongRequest {
  return { style: "", lyrics: "", cot: "full", seed: DEFAULT_SEED, abc: null, cfg_scale: null };
}

// ----- projects ------------------------------------------------------------

export function loadProjects(): Project[] {
  const list = loadLocal<Project[]>(PROJECTS_KEY, []);
  return Array.isArray(list) ? list.filter((p) => p && typeof p.id === "string") : [];
}

export function saveProjects(projects: Project[]): void {
  saveSynced(PROJECTS_KEY, projects);
}

export function newProject(toolId: string, title = "Untitled"): Project {
  const now = Date.now();
  return {
    id: `mc_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    toolId,
    created: now,
    updated: now,
    request: emptyRequest(),
    renders: [],
    data: {},
  };
}

/** Add a render to a project, newest first. */
export function withRender(project: Project, render: Render): Project {
  return { ...project, renders: [render, ...project.renders], updated: Date.now() };
}

// ----- the Voice Library ---------------------------------------------------
//
// `clipDataUrl` is stripped on the way out and merged back in on the way in, so
// callers work with whole VoiceProfile objects and never have to remember the
// split. Only these four functions know about it.

type StoredClip = { id: string; clipDataUrl: string };

function loadClips(): StoredClip[] {
  return loadLocal<StoredClip[]>(CLIPS_KEY, []);
}

export function loadVoices(): VoiceProfile[] {
  const voices = loadLocal<VoiceProfile[]>(VOICES_KEY, []);
  if (!Array.isArray(voices)) return [];
  const clips = new Map(loadClips().map((c) => [c.id, c.clipDataUrl]));
  return voices
    .filter((v) => v && typeof v.id === "string")
    .map((v) => ({ ...v, clipDataUrl: clips.get(v.id) }));
}

export function saveVoices(voices: VoiceProfile[]): void {
  // The clips, on this device only.
  const clips: StoredClip[] = voices
    .filter((v) => !!v.clipDataUrl)
    .map((v) => ({ id: v.id, clipDataUrl: v.clipDataUrl as string }));
  saveLocal(CLIPS_KEY, clips);

  // The records, everywhere.
  saveSynced(
    VOICES_KEY,
    voices.map(({ clipDataUrl: _clip, ...rest }) => rest),
  );
}

/** True when this device holds the clip needed to re-register a voice. */
export function hasClipHere(voice: VoiceProfile): boolean {
  return !!voice.clipDataUrl;
}
