// ---------------------------------------------------------------------------
// Voice Studio — shared types (client + server).
// ---------------------------------------------------------------------------

export type TtsFormat = "mp3" | "wav";

/** What the /api/tts backend can currently do (reported to the client). */
export interface TtsCapabilities {
  /** fish-audio = hosted API keyed; self-hosted = own server; browser = no key. */
  mode: "fish-audio" | "self-hosted" | "browser";
  /** Whether cloning is available (needs a real model backend, not the browser). */
  cloning: boolean;
}

/** A reusable cloned voice, stored locally and re-sent as inline references. */
export interface ClonedVoice {
  id: string;
  name: string;
  transcript: string;
  /**
   * data: URL of the reference clip (base64), 10–30s.
   *
   * Absent on a record pulled from another device: there the audio lives in
   * the voice-clips bucket and audioPath points at it. media.clipUrl() turns
   * that into something playable.
   */
  audioDataUrl?: string;
  /** Path in the voice-clips storage bucket, once uploaded. */
  audioPath?: string;
  createdAt: string;
}

/** One generated (or fallback) clip in history. */
export interface HistoryItem {
  id: string;
  text: string;
  voiceName: string;
  createdAt: string;
  source: "fish" | "browser";
  /** data: URL of the produced audio (absent for browser-fallback clips). */
  audioDataUrl?: string;
  /** Path in the voice-clips storage bucket, once uploaded. */
  audioPath?: string;
  format?: TtsFormat;
}

/** The clone reference sent to the server for instant voice cloning. */
export interface CloneReference {
  /** base64 (no data: prefix) of the reference clip. */
  audioBase64: string;
  transcript: string;
}

/** POST /api/tts request body. */
export interface TtsRequest {
  text: string;
  format: TtsFormat;
  /** Playback speed 0.5–2.0. */
  speed: number;
  /** A fish.audio voice/model id (preset or pasted). Omit for the default voice. */
  voiceId?: string;
  /** Inline cloning reference (takes priority over voiceId). */
  reference?: CloneReference;
}

/** A built-in "default voice" sentinel used by the picker. */
export const DEFAULT_VOICE_ID = "default";

/**
 * Curated preset voices (fish.audio `reference_id`s). Left empty by default so
 * we never ship broken ids — the picker always offers Default + paste-your-own,
 * and verified public voice ids can be appended here.
 */
export const PRESET_VOICES: { id: string; name: string; referenceId: string }[] = [];

export const MAX_HISTORY = 20;
