// ---------------------------------------------------------------------------
// Seedance Studio — client helpers: the render call, waveform decoding, and
// turning a dropped file into a reference.
// ---------------------------------------------------------------------------

"use client";

import { ASPECT_CSS, placeholderHue } from "./constants";
import { composePrompt } from "./prompt";
import type { GenerateResult, MediaRef, PlacedPrompt, Reel } from "./types";

export { ASPECT_CSS };

/**
 * Render one block. Sends the composed prompt plus the block's first image to
 * /api/seedance. On any failure it degrades to a deterministic placeholder in
 * the block's own colour, so the cutting room never dead-ends.
 */
export async function renderBlock(reel: Reel, placed: PlacedPrompt): Promise<GenerateResult> {
  const { block, lipSynced } = placed;
  const prompt = composePrompt({ reel, block, lipSynced });
  const hue = placeholderHue(lipSynced);
  const imageRef = block.refs.find((r) => r.kind === "image" && r.url);

  try {
    const res = await fetch("/api/seedance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: "generate",
        prompt,
        aspectRatio: reel.aspectRatio,
        durationSec: block.durationSec,
        image: imageRef?.url ?? null,
        moodHue: hue,
        lipsync: lipSynced,
        audioStartSec: placed.startSec,
      }),
    });
    if (!res.ok) throw new Error(`Seedance API ${res.status}`);
    return (await res.json()) as GenerateResult;
  } catch (err) {
    console.error("Seedance render failed, using placeholder:", err);
    return { status: "done", engine: "placeholder", posterHue: hue };
  }
}

// ----- upload → MediaRef ---------------------------------------------------

export function fileToMediaRef(file: File): Promise<MediaRef> {
  return new Promise((resolve, reject) => {
    const kind: MediaRef["kind"] = file.type.startsWith("video/") ? "video" : "image";
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        id: `ref_${Math.random().toString(36).slice(2, 9)}`,
        name: file.name,
        kind,
        type: file.type,
        url: String(reader.result),
      });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ----- the waveform --------------------------------------------------------

/** How many peaks a song is reduced to. Enough detail to find a downbeat. */
export const PEAK_COUNT = 1600;

/**
 * Decode an audio file to normalised 0–1 peaks. This is the real shape of the
 * owner's song, not a decorative sine: the whole point of the app is placing a
 * block on a specific moment, and you cannot aim at a fake waveform.
 *
 * Decoding is best-effort — an unsupported codec returns no peaks and the song
 * bar falls back to a plain bed, which still carries the duration.
 */
export async function decodeSong(
  file: File,
): Promise<{ durationSec: number; peaks: number[] } | null> {
  const Ctx: typeof AudioContext | undefined =
    window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const data = buffer.getChannelData(0);
    const per = Math.max(1, Math.floor(data.length / PEAK_COUNT));
    const peaks: number[] = [];
    let max = 0;
    for (let i = 0; i < PEAK_COUNT; i++) {
      let peak = 0;
      const from = i * per;
      for (let j = from; j < from + per && j < data.length; j++) {
        const v = Math.abs(data[j]);
        if (v > peak) peak = v;
      }
      peaks.push(peak);
      if (peak > max) max = peak;
    }
    const scale = max > 0 ? 1 / max : 0;
    return { durationSec: buffer.duration, peaks: peaks.map((p) => p * scale) };
  } catch (err) {
    console.error("Could not decode the song for a waveform:", err);
    return null;
  } finally {
    void ctx.close();
  }
}
