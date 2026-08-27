// ---------------------------------------------------------------------------
// Soundprint — turn a reference song into the two prompts an AI music platform
// needs: a Style/Genre prompt and a Lyrics prompt.
//
// These types are shared by the client UI, the API route and the offline
// heuristic engine, exactly like Blueprint's types.ts.
// ---------------------------------------------------------------------------

/** Which part of the reference track we're chasing. */
export type SectionFocus =
  | "intro"
  | "verse"
  | "pre-chorus"
  | "chorus"
  | "bridge"
  | "breakdown"
  | "outro"
  | "whole";

export const SECTION_LABELS: Record<SectionFocus, string> = {
  intro: "Intro",
  verse: "Verse",
  "pre-chorus": "Pre-chorus",
  chorus: "Chorus",
  bridge: "Bridge",
  breakdown: "Breakdown",
  outro: "Outro",
  whole: "Whole song",
};

/** What we want the finished track to do with the analysed section. */
export type Scope = "hold" | "extend";

export const SCOPE_LABELS: Record<Scope, string> = {
  hold: "Stay in this texture",
  extend: "Build a full song from it",
};

export const SCOPE_HINTS: Record<Scope, string> = {
  hold:
    "The whole track keeps the mood of that section — it never drops into the " +
    "full arrangement.",
  extend:
    "That section becomes the opening, then the song develops naturally from it.",
};

/** How vocals are handled. */
export type VocalMode = "instrumental" | "original" | "mood";

export const VOCAL_LABELS: Record<VocalMode, string> = {
  instrumental: "Instrumental",
  original: "Write original lyrics",
  mood: "Lyrics that match the mood",
};

/** Everything the user gives us up front. */
export interface SongBrief {
  /** Natural-language request, e.g. "only the intro, before the beat drops". */
  request: string;
  /** Optional explicit reference, e.g. "The Reason — Hoobastank". */
  reference: string;
  section: SectionFocus;
  scope: Scope;
  vocals: VocalMode;
  /** Model id used as the "ears". */
  modelId: string;
  /** Manual descriptors chosen in the offline / assisted builder. */
  manual: ManualSelection;
  /** Present when the user attached audio for the model to actually listen to. */
  audio: AudioAttachment | null;
}

export interface AudioAttachment {
  name: string;
  /** Base64 payload without the data: prefix. */
  data: string;
  /** Container format passed to the model: mp3, wav, m4a, ogg, flac, webm. */
  format: string;
  bytes: number;
}

/** Chips the user can pick by hand — also the whole offline experience. */
export interface ManualSelection {
  genres: string[];
  moods: string[];
  instruments: string[];
  production: string[];
  vocalTraits: string[];
}

export function emptyManual(): ManualSelection {
  return { genres: [], moods: [], instruments: [], production: [], vocalTraits: [] };
}

/**
 * The measured facts pulled off the waveform in the browser. Serialisable, so
 * it can travel to the API route and be handed to the model as ground truth.
 */
export interface Measured {
  startSec: number;
  endSec: number;
  bpm: number;
  key: string;
  brightness: string;
  /** 0–1 — the number behind "does the beat come in?". */
  percussion: number;
  percussionLabel: string;
  dynamics: string;
  density: string;
  stereo: string;
  /** Pre-rendered summary handed straight to the model. */
  summary: string;
}

/** The producer's read of the reference. */
export interface VocalProfile {
  /** e.g. "male tenor, sits mid-to-high in chest voice". */
  range: string;
  /** Timbre words: rasp, breathy, nasal, smoky, clean. */
  texture: string[];
  /** Phrasing + attitude: restrained, behind the beat, belted. */
  delivery: string[];
  /** Treatment: doubling, plate reverb, slapback, tight compression. */
  effects: string[];
}

export interface StyleBreakdown {
  /** Reflected back so the user can see the request was understood. */
  understood: string;
  genres: string[];
  moods: string[];
  tempo: string;
  key: string;
  instrumentation: string[];
  production: string[];
  structure: string;
  era: string;
  vocal: VocalProfile | null;
  /** Descriptive scenes/eras — never "clone this artist". */
  adjacent: string[];
  /** What must NOT appear (the "don't bring the beat in" list). */
  avoid: string[];
}

export function emptyBreakdown(): StyleBreakdown {
  return {
    understood: "",
    genres: [],
    moods: [],
    tempo: "",
    key: "",
    instrumentation: [],
    production: [],
    structure: "",
    era: "",
    vocal: null,
    adjacent: [],
    avoid: [],
  };
}

/** Target platform for the generated prompts. Suno only. */
export type PlatformId = "suno";

/** The deliverable — the two prompts, plus the extras each platform supports. */
export interface PromptSet {
  platform: PlatformId;
  title: string;
  /** The Style / Genre field. */
  style: string;
  /** The Lyrics field, with [Section] meta-tags. */
  lyrics: string;
  /** Suno's "Exclude Styles" field — how we keep the beat out. */
  exclude: string;
  /** Short, practical tips for pasting this in. */
  notes: string[];
}

/** Which engine produced a result — surfaced subtly in the UI. */
export type Engine = "ai" | "heuristic";

/**
 * A real performer the user named. We never ask a platform to imitate them —
 * we translate them into `profile`, which is both legal and more accurate.
 */
export interface PerformerSwap {
  name: string;
  profile: string;
}

export interface AnalysisResult {
  breakdown: StyleBreakdown;
  prompts: PromptSet;
  platform: PlatformId;
  performers: PerformerSwap[];
  engine: Engine;
  /** Why we fell back, when we did — e.g. a missing key or a failed call. */
  notice?: string;
}
