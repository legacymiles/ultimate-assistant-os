// ---------------------------------------------------------------------------
// How Jarvis sounds: which voice, how fast, how expressive, how repeatable.
//
// Pure. The screen renders from these functions and `useVoice` sends what
// `ttsBody` builds, so what you hear in the preview is what you hear in an
// answer — there is no second code path to drift.
// ---------------------------------------------------------------------------

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { VOICES, type PhononVoice } from "./voices";

export const KEY = "voice-settings:v1";

/** What the catalog actually states. "unstated" is a fact, not a gap. */
export type Accent = "british" | "american" | "unstated";

/** The filter pills across the top of the stage. */
export type VoiceFilter = "all" | Accent | "characters";

export const FILTERS: { id: VoiceFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "british", label: "British" },
  { id: "american", label: "American" },
  { id: "unstated", label: "Not stated" },
  { id: "characters", label: "Characters" },
];

/**
 * The accent a description states, or "unstated".
 *
 * Read from the catalog's prose because that is the only place it exists. Note
 * "English accent" counts as British and "standard American" as American; a
 * description that mentions neither is left alone rather than guessed at.
 */
export function accentOf(description: string): Accent {
  const d = description.toLowerCase();
  if (/\bbritish\b|\brp accent\b|\benglish accent\b/.test(d)) return "british";
  if (/\bamerican\b/.test(d)) return "american";
  return "unstated";
}

export function matchesFilter(v: PhononVoice, filter: VoiceFilter): boolean {
  if (filter === "all") return true;
  if (filter === "characters") return v.character === true;
  return accentOf(v.description) === filter;
}

/** The voices a filter and a search box leave, in catalog order. */
export function filterVoices(voices: PhononVoice[], filter: VoiceFilter, query = ""): PhononVoice[] {
  const q = query.trim().toLowerCase();
  return voices.filter(
    (v) =>
      matchesFilter(v, filter) &&
      (!q || v.name.toLowerCase().includes(q) || v.description.toLowerCase().includes(q)),
  );
}

/** How many voices sit behind each pill — shown on the pill, so it cannot lie. */
export function countsFor(voices: PhononVoice[]): Record<VoiceFilter, number> {
  const count = (f: VoiceFilter) => voices.filter((v) => matchesFilter(v, f)).length;
  return {
    all: count("all"),
    british: count("british"),
    american: count("american"),
    unstated: count("unstated"),
    characters: count("characters"),
  };
}

export function voiceByName(name: string, voices: PhononVoice[] = VOICES): PhononVoice | undefined {
  const n = name.trim().toLowerCase();
  return voices.find((v) => v.name.toLowerCase() === n);
}

export interface VoiceSettings {
  /** A voice name from the catalog, e.g. "Hadley". */
  voice: string;
  /** Playback tempo, 0.5-2. Applied by ffmpeg, so the pitch is unchanged. */
  speed: number;
  /** Phonon's sampling temperature, 0-1. Higher is livelier and less steady. */
  expression: number;
  /**
   * Locked = the same words come out the same way every time (Phonon's fixed
   * seed). Unlocked sends a fresh seed per line, so a repeated sentence varies.
   */
  consistency: boolean;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  voice: "Hadley",
  speed: 1,
  expression: 0.3,
  consistency: true,
};

export function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** Anything missing, corrupt or out of range filled from the defaults. */
export function clampSettings(raw: Partial<VoiceSettings> | null | undefined): VoiceSettings {
  const r = raw ?? {};
  const named = typeof r.voice === "string" && voiceByName(r.voice);
  return {
    // A voice the catalog no longer has would fail silently on every line, so
    // it falls back to the default rather than being kept.
    voice: named ? named.name : DEFAULT_VOICE_SETTINGS.voice,
    speed: clamp(typeof r.speed === "number" ? r.speed : DEFAULT_VOICE_SETTINGS.speed, 0.5, 2),
    expression: clamp(
      typeof r.expression === "number" ? r.expression : DEFAULT_VOICE_SETTINGS.expression,
      0,
      1,
    ),
    consistency: typeof r.consistency === "boolean" ? r.consistency : DEFAULT_VOICE_SETTINGS.consistency,
  };
}

export function loadVoiceSettings(): VoiceSettings {
  return clampSettings(loadLocal<Partial<VoiceSettings>>(KEY, {}));
}

/**
 * Fired after a save, so anything showing the current voice (the status dock)
 * updates without being wired to the stage that changed it.
 */
export const VOICE_SETTINGS_CHANGED = "voice-settings:changed";

export function saveVoiceSettings(s: VoiceSettings): void {
  const next = clampSettings(s);
  saveSynced(KEY, next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<VoiceSettings>(VOICE_SETTINGS_CHANGED, { detail: next }));
  }
}

/** The POST body /api/tts gets, for a preview and for a real answer alike. */
export function ttsBody(
  text: string,
  s: VoiceSettings,
  randomSeed: () => number = () => Math.floor(Math.random() * 2 ** 31),
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    text,
    voiceId: s.voice,
    speed: clamp(s.speed, 0.5, 2),
    temperature: clamp(s.expression, 0, 1),
  };
  // Locked leaves the seed out: Phonon's own default seed is already fixed, so
  // saying nothing is what "the same every time" means.
  if (!s.consistency) body.seed = randomSeed();
  return body;
}

/** One short line the owner can hear a voice on. */
export const PREVIEW_LINE = "Good evening. This is how I sound when I answer you.";
