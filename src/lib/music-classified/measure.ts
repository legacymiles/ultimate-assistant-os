"use client";

// Measuring audio in the browser with Soundprint's analyzer.
//
// Two sources: Apple's 30s catalogue preview (CORS-open, so no proxy — decoded,
// measured and dropped) and the user's own uploads, which also yield a short
// WAV clip for the listening model.

import { analyzeRange, loadAudio, type AudioFeatures } from "@/lib/soundprint/audio-analysis";
import type { Measured } from "./types";
import { bytesToBase64, CLIP_RATE, CLIP_SECONDS, encodeWav, loudestWindow, resampleLinear } from "./wav";

const PREVIEW_HOST = /(^|\.)(itunes\.apple\.com|mzstatic\.com|apple\.com)$/i;

function toMeasured(f: AudioFeatures): Measured | null {
  if (!Number.isFinite(f.bpm) || f.bpm <= 0) return null;
  return {
    bpm: Math.round(f.bpm),
    bpmConfidence: f.bpmConfidence,
    key: f.key,
    keyConfidence: f.keyConfidence,
    brightness: f.brightness,
    percussion: f.percussionLabel,
    dynamics: f.dynamics,
    density: f.density,
  };
}

export async function measurePreview(url: string | undefined, signal?: AbortSignal): Promise<Measured | null> {
  if (!url) return null;
  try {
    if (!PREVIEW_HOST.test(new URL(url).hostname)) return null;
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size > 4_000_000) return null;
    const audio = await loadAudio(new File([blob], "preview.m4a", { type: blob.type || "audio/mp4" }));
    return toMeasured(analyzeRange(audio, 0, audio.durationSec));
  } catch {
    // Decoding unsupported, network blocked, aborted — measuring is a bonus.
    return null;
  }
}

/**
 * Decode an uploaded song, measure its loudest stretch and cut a clip to send
 * to the listening model. Throws only when the file can't be decoded at all.
 */
export async function analyzeUpload(
  file: File,
): Promise<{ measured: Measured | null; clip: string | null; durationSec: number }> {
  let audio;
  try {
    audio = await loadAudio(file);
  } catch {
    throw new Error("this browser couldn't decode that audio file (try MP3, WAV or M4A)");
  }
  // Derived rather than assumed, so a change to the loader's rate can't skew it.
  const rate = audio.samples.length / audio.durationSec;
  const start = loudestWindow(audio.samples, rate, CLIP_SECONDS);
  const end = Math.min(audio.durationSec, start + CLIP_SECONDS);

  let measured: Measured | null = null;
  try {
    // A minute around the loud stretch: long enough for a stable tempo, short
    // enough that a 6-minute song doesn't stall the tab.
    measured = toMeasured(analyzeRange(audio, Math.max(0, start - 10), Math.min(audio.durationSec, end + 10)));
  } catch {
    /* measuring is a bonus */
  }

  let clip: string | null = null;
  try {
    const slice = audio.samples.subarray(Math.floor(start * rate), Math.floor(end * rate));
    clip = bytesToBase64(encodeWav(resampleLinear(slice, rate, CLIP_RATE), CLIP_RATE));
  } catch {
    /* the model will work from measurements */
  }
  return { measured, clip, durationSec: audio.durationSec };
}
