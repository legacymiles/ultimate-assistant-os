// ---------------------------------------------------------------------------
// Music Creator — the shapes every tool in the studio shares.
//
// The studio is a container for music tools that will not resemble each other:
// a mashup tool wants a waveform and a timeline, a hook creator wants a wall of
// short takes, a song creator wants a lyric sheet. So the only things defined
// here are the things they genuinely have in common — a project, a render, a
// voice, a job — and each tool keeps its own state inside `Project.data`.
//
// `data` is deliberately an opaque per-tool bag. It means a new tool can store
// whatever it needs without a migration, and no tool can accidentally depend on
// another's internals.
// ---------------------------------------------------------------------------

/** Chain-of-thought / planning mode. YuE2's `cot` field, named as the UI says it. */
export type PlanMode = "full" | "melody" | "off";

/**
 * A YuE2 generation request, in YuE2's own field names.
 *
 * Kept identical to `yue2.protocol.SongRequest` on purpose: the server passes
 * this through to the pipeline unchanged, so a field renamed for the UI's
 * benefit here would be a translation layer that can silently drift.
 */
export interface SongRequest {
  /** Genre, instruments, vocal character, language, tempo — all in prose. */
  style: string;
  /** The words, with `[Verse]` / `[Chorus]` section tags. */
  lyrics: string;
  cot: PlanMode;
  seed: number;
  /** An ABC score to realise instead of planning a new one. Needs cot ≠ "off". */
  abc?: string | null;
  /** Text guidance, 0–20. Null means YuE2's own default. */
  cfg_scale?: number | null;
}

export type RenderKind = "song" | "vocal" | "mix" | "stem" | "transcription";

/**
 * One thing the GPU server produced.
 *
 * `fileId` is the server's handle; `url` is only ever a blob: URL made in this
 * browser after download. Nothing here holds audio bytes — renders are far too
 * big for the synced store, and a project that reopens with a dead link is
 * better than a store that stops saving at all.
 */
export interface Render {
  id: string;
  kind: RenderKind;
  label: string;
  fileId: string | null;
  jobId: string | null;
  created: number;
  /** Truncation flags, timings, the score — whatever the job reported back. */
  meta?: Record<string, unknown>;
  /** Set when the job failed, so a dead render says why instead of vanishing. */
  error?: string;
}

export interface Project {
  id: string;
  title: string;
  /** Which tool created it — the studio reopens a project in its own tool. */
  toolId: string;
  created: number;
  updated: number;
  request: SongRequest;
  renders: Render[];
  /** Voice Library id, when the project's vocal is performed by a saved voice. */
  voiceId?: string;
  notes?: string;
  /** Per-tool state. Opaque to the studio; each tool owns its own key space. */
  data?: Record<string, unknown>;
}

/**
 * A saved voice in the Voice Library.
 *
 * AuK is zero-shot: there is no trained per-voice checkpoint anywhere, so a
 * "profile" is a reference clip plus what we know about it. That is why the
 * clip itself is kept here as a data URL — `serverRefId` is only a cache of
 * where the GPU server filed a copy, and a server that was rebuilt, swapped or
 * rented by the hour will not have it. Holding the clip locally means the
 * library survives that and re-registers the voice on first use.
 */
export interface VoiceProfile {
  id: string;
  name: string;
  /** The artist searched for, when the clip came from a catalogue lookup. */
  artist?: string;
  source: "upload" | "recording" | "preview" | "link";
  /** Where the clip came from, for the honesty line on the card. */
  sourceNote?: string;
  created: number;
  durationS?: number;
  /** The reference clip. Kept local; never synced (see store.ts). */
  clipDataUrl?: string;
  /** The GPU server's id for its copy of the clip. A cache, not the truth. */
  serverRefId?: string;
  /** What the clip says, when known — AuK clones better with a transcript. */
  transcript?: string;
  /** A short test render, so "Preview" does not need the GPU every time. */
  previewFileId?: string;
}

export type JobStatus = "queued" | "running" | "done" | "error";

export interface Job {
  status: JobStatus;
  progress: number;
  stage: string;
  result: Record<string, unknown> | null;
  error: string | null;
}

/** What `/health` reports. Everything is optional — an old server may omit it. */
export interface ServerHealth {
  ok: boolean;
  engines?: {
    yue2?: { available: boolean; loaded: boolean; model?: string };
    auk?: { available: boolean; loaded: boolean };
    sheetsage?: { available: boolean };
  };
  gpu?: { name: string; vram_gb: number; free_gb: number };
  queue?: { running: string | null; pending: number };
  idle_stop?: { enabled: boolean; limit_minutes?: number; idle_minutes?: number };
  version?: string;
}

/** The RunPod pod behind the server, when the site manages one (see pod.ts). */
export interface PodInfo {
  managed: boolean;
  status?: string;
  gpu?: string;
  costPerHour?: number;
  error?: string;
}

/** Health plus how we got it, so the UI can say *why* something is unavailable. */
export interface ServerState {
  reachable: boolean;
  /** The pod's own state — lets a stopped GPU be woken instead of reported dead. */
  pod?: PodInfo;
  /** Set when unreachable or misconfigured — shown to the user verbatim. */
  reason?: string;
  health?: ServerHealth;
  checkedAt: number;
}

/** A track found by the artist search. Catalogue metadata plus a preview clip. */
export interface ArtistTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  /** A 30-second preview from the public catalogue, or null when none exists. */
  previewUrl: string | null;
  releaseYear?: number;
}
