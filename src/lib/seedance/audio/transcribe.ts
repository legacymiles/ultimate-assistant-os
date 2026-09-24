"use client";

// ---------------------------------------------------------------------------
// Getting the words, in chunks, and putting them back together.
//
// A whole song cannot be sent in one request: 40 seconds of 16 kHz mono WAV is
// already ~1.7 MB of base64 and the platform's body cap is 4.5 MB. So the track
// is cut here, each piece is transcribed on its own clock, and the pieces are
// stitched back onto the song's clock.
//
// The chunks OVERLAP on purpose. A line that straddles a boundary is heard
// half-way by both neighbours and fully by neither, which is how a transcript
// ends up with "driving through the" and "city all night" as separate lines. An
// overlap means at least one chunk hears the whole line; `mergeLines` then has
// to drop the duplicate, and that de-duplication is the only reason this file is
// more than a loop.
//
// The provider seam is the route (src/app/api/seedance/transcribe), not here:
// this file knows about cutting and merging, never about which model listens.
// ---------------------------------------------------------------------------

import type { LoadedAudio } from "@/lib/soundprint/audio-analysis";
import { bytesToBase64, encodeWav, resampleLinear } from "@/lib/music-classified/wav";
import type { Line } from "./timeline";

/** What one request carries. Under the body cap with room to spare. */
export const CHUNK_SEC = 40;
/** Enough to contain any single sung line, so no line is only ever heard in half. */
export const OVERLAP_SEC = 4;
/** What the listening model is sent. More than speech needs, and small. */
const CLIP_RATE = 16_000;

export interface TranscribeProgress {
  /** Chunks finished. */
  done: number;
  total: number;
}

export interface TranscribeOutcome {
  lines: Line[];
  /** True when at least one chunk was really listened to. */
  heard: boolean;
  /** What to tell the owner: the first real reason nothing came back. */
  note?: string;
}

/** One chunk of the decoded song, as base64 WAV at the rate the model wants. */
function clipAt(audio: LoadedAudio, startSec: number, endSec: number): string | null {
  try {
    const rate = audio.sampleRate;
    const slice = audio.samples.subarray(
      Math.max(0, Math.floor(startSec * rate)),
      Math.min(audio.samples.length, Math.floor(endSec * rate)),
    );
    if (slice.length < rate * 0.5) return null;
    return bytesToBase64(encodeWav(resampleLinear(slice, rate, CLIP_RATE), CLIP_RATE));
  } catch {
    return null;
  }
}

/** Where each chunk starts and ends. Overlapping, and covering the whole track. */
export function chunksOf(durationSec: number): { startSec: number; endSec: number }[] {
  const out: { startSec: number; endSec: number }[] = [];
  if (durationSec <= 0) return out;
  const step = CHUNK_SEC - OVERLAP_SEC;
  for (let at = 0; at < durationSec; at += step) {
    const endSec = Math.min(durationSec, at + CHUNK_SEC);
    out.push({ startSec: at, endSec });
    // The last chunk reaching the end is the last chunk: without this, a step
    // that lands exactly on the end adds an empty one.
    if (endSec >= durationSec) break;
  }
  return out;
}

/** Words, stripped to what makes two transcriptions of one line comparable. */
function fingerprint(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * One transcript out of several overlapping ones.
 *
 * Two chunks that both heard a line report it at nearly the same second with
 * nearly the same words, and a naive concatenation keeps both. The test used
 * here is deliberately loose on text and tight on time: an overlapping window is
 * seconds wide, so anything inside it saying roughly the same thing IS the same
 * line, whereas a genuine repeat of a hook comes back a whole section later.
 *
 * The EARLIER chunk's version wins, because it heard the line with more audio
 * after it — a line at the trailing edge of one chunk is the one most likely to
 * have been cut off, and that is the version being discarded.
 */
export function mergeLines(groups: Line[][]): Line[] {
  const kept: Line[] = [];
  for (const group of groups) {
    for (const line of group) {
      const print = fingerprint(line.text);
      if (!print) continue;
      const duplicate = kept.some((k) => {
        if (Math.abs(k.startSec - line.startSec) > OVERLAP_SEC) return false;
        const other = fingerprint(k.text);
        return other === print || other.includes(print) || print.includes(other);
      });
      if (!duplicate) kept.push(line);
    }
  }
  return kept.sort((a, b) => a.startSec - b.startSec);
}

/**
 * Transcribe a whole decoded song.
 *
 * Chunks are sent one at a time rather than in parallel: the owner is watching a
 * progress count, a rate limit on chunk three would otherwise lose chunks four
 * through eight as well, and nothing here is fast enough for the concurrency to
 * be the thing that matters.
 */
export async function transcribeSong(
  audio: LoadedAudio,
  opts: {
    hint?: string;
    /** Real lyrics, when the owner has them: the model then only decides times. */
    known?: string;
    onProgress?: (p: TranscribeProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<TranscribeOutcome> {
  const chunks = chunksOf(audio.durationSec);
  const groups: Line[][] = [];
  let heard = false;
  let note: string | undefined;

  for (const [i, chunk] of chunks.entries()) {
    if (opts.signal?.aborted) break;
    const clip = clipAt(audio, chunk.startSec, chunk.endSec);
    if (!clip) {
      opts.onProgress?.({ done: i + 1, total: chunks.length });
      continue;
    }
    try {
      const res = await fetch("/api/seedance/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clip,
          offsetSec: chunk.startSec,
          durationSec: chunk.endSec - chunk.startSec,
          hint: opts.hint,
          known: opts.known,
        }),
        signal: opts.signal,
      });
      const data = (await res.json()) as {
        lines?: { startSec: number; endSec: number; text: string; words?: { atSec: number; text: string }[] }[];
        heard?: boolean;
        note?: string;
      };
      if (data.heard) heard = true;
      // The first reason is the useful one: a missing key repeated eight times
      // is still one missing key.
      if (data.note && !note) note = data.note;
      if (data.lines?.length) groups.push(data.lines.map((l) => ({ ...l })));
    } catch (err) {
      if (opts.signal?.aborted) break;
      console.error("Transcribing a chunk failed:", err);
      if (!note) note = "Part of the track couldn't be transcribed. What was heard is still here.";
    }
    opts.onProgress?.({ done: i + 1, total: chunks.length });
  }

  return { lines: mergeLines(groups), heard, note };
}
