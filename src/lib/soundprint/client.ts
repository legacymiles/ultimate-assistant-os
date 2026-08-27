// ---------------------------------------------------------------------------
// Soundprint — client helpers. Typed wrapper around /api/soundprint plus the
// bridge from measured audio features to the serialisable payload.
// ---------------------------------------------------------------------------

"use client";

import { featuresToBrief, type AudioFeatures } from "./audio-analysis";
import { heuristicBreakdown, heuristicPerformers } from "./heuristics";
import type { ProviderStatus } from "./models";
import { assemblePrompts } from "./prompt-template";
import type { AnalysisResult, Measured, SongBrief } from "./types";

/** AudioFeatures (rich, client-only) → Measured (small, serialisable). */
export function toMeasured(f: AudioFeatures | null): Measured | null {
  if (!f) return null;
  return {
    startSec: f.startSec,
    endSec: f.endSec,
    bpm: f.bpm,
    key: f.key,
    brightness: f.brightness,
    percussion: f.percussion,
    percussionLabel: f.percussionLabel,
    dynamics: f.dynamics,
    density: f.density,
    stereo: f.stereo,
    summary: featuresToBrief(f),
  };
}

export async function analyze(
  brief: SongBrief,
  measured: Measured | null,
): Promise<AnalysisResult> {
  const local = (): AnalysisResult => {
    const breakdown = heuristicBreakdown(brief, measured);
    const performers = heuristicPerformers(brief);
    return {
      breakdown,
      prompts: assemblePrompts(breakdown, brief, "suno", performers),
      platform: "suno",
      performers,
      engine: "heuristic",
    };
  };

  try {
    const res = await fetch("/api/soundprint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief, measured }),
    });
    if (!res.ok) throw new Error(`Soundprint API ${res.status}`);
    return (await res.json()) as AnalysisResult;
  } catch (err) {
    // Network or server failure: degrade to the offline engine rather than
    // dead-ending. The measurements are still real, so this stays useful.
    console.error("Soundprint request failed, using local engine:", err);
    return local();
  }
}

/** Which providers have keys configured — drives the hints in the model picker. */
export async function fetchProviderStatus(): Promise<ProviderStatus> {
  try {
    const res = await fetch("/api/soundprint");
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as ProviderStatus;
  } catch {
    return { openrouter: false, gateway: false };
  }
}

export interface SunoTrack {
  songId: string;
  audioUrl: string;
  sunoUrl: string;
}

export interface SunoTrackResult {
  track: SunoTrack | null;
  error: string;
}

/**
 * Resolve a pasted Suno link to its public audio so the real track plays here.
 * The server does the work: short links redirect, and it verifies the audio is
 * public before handing it back.
 */
export async function resolveSunoTrack(url: string): Promise<SunoTrackResult> {
  try {
    const res = await fetch("/api/soundprint/suno-track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json()) as Partial<SunoTrack> & { error?: string };
    if (!res.ok || !data.audioUrl || !data.songId) {
      return { track: null, error: data.error ?? `Request failed (${res.status}).` };
    }
    return {
      track: { songId: data.songId, audioUrl: data.audioUrl, sunoUrl: data.sunoUrl ?? "" },
      error: "",
    };
  } catch (err) {
    return {
      track: null,
      error: err instanceof Error ? err.message : "Could not reach the resolver.",
    };
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
