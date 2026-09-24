"use client";

// ---------------------------------------------------------------------------
// Stage 1 of the engine, in the owner's browser: decode, measure, lay a clock.
//
// All of it is free and none of it needs a key. That is not a nice-to-have —
// it is what lets the app be honest: the tempo, the bar lines, the sections and
// the loud moments are MEASURED from the owner's own file here, so a missing API
// key costs the words and nothing else, and the timeline the board is built on
// is never a guess a model made about a track it could not hear.
//
// The transcript is the one part that cannot be measured. It is fetched
// separately (transcribe.ts) and folded in afterwards, so a failed or skipped
// transcription leaves a complete, usable timeline rather than no timeline.
// ---------------------------------------------------------------------------

import { analyzeRange, loadAudio, type LoadedAudio } from "@/lib/soundprint/audio-analysis";
import { beatGrid, hits, onsetEnvelope, sections } from "./grid";
import { labelSections, type AudioTimeline, type Line, type TimelineSection } from "./timeline";

export interface AnalyzeResult {
  timeline: AudioTimeline;
  /** Kept for the waveform and for cutting transcription clips. Session-only. */
  audio: LoadedAudio;
}

/**
 * Decode a track and measure everything about it.
 *
 * Throws only when the browser cannot decode the file at all — every other
 * failure degrades into a timeline with less in it, because a song whose tempo
 * could not be found is still a song you can cut by hand.
 */
export async function analyzeSong(file: File): Promise<AnalyzeResult> {
  let audio: LoadedAudio;
  try {
    audio = await loadAudio(file);
  } catch {
    throw new Error(
      `This browser couldn't decode ${file.name || "that file"}. MP3, WAV, M4A and FLAC all work.`,
    );
  }

  const features = analyzeRange(audio, 0, audio.durationSec);
  const env = onsetEnvelope(audio.samples, audio.sampleRate);
  const grid = beatGrid(env, features.bpm, { durationSec: audio.durationSec });
  const raw = sections(env, grid, { durationSec: audio.durationSec });
  const labels = labelSections(raw, null);

  const timeline: AudioTimeline = {
    name: file.name.replace(/\.[^.]+$/, "") || "Untitled track",
    durationSec: audio.durationSec,
    bpm: features.bpm,
    bpmConfidence: features.bpmConfidence,
    key: features.key,
    keyConfidence: features.keyConfidence,
    brightness: features.brightness,
    percussion: features.percussionLabel,
    dynamics: features.dynamics,
    density: features.density,
    analyzer: features.analyzer,
    grid,
    sections: raw.map(
      (s, i): TimelineSection => ({ ...s, id: `sec-${i + 1}`, provisional: labels[i], lines: [] }),
    ),
    hits: hits(env),
    lines: null,
    lyricSource: "none",
  };

  return { timeline, audio };
}

/**
 * Fold words into a measured timeline.
 *
 * Separate from `analyzeSong` because the words can arrive three ways — heard by
 * a model, pasted by the owner, or never — and the timeline has to be complete
 * and correct in all three. Re-labelling the sections here is the point of doing
 * it as a second pass: "verse" and "chorus" are decided by what is SUNG over a
 * stretch, so the provisional labels are worth redoing the moment there are
 * words to redo them with.
 */
export function withLines(
  timeline: AudioTimeline,
  lines: Line[] | null,
  source: AudioTimeline["lyricSource"],
  note?: string,
): AudioTimeline {
  const kept = lines?.length ? [...lines].sort((a, b) => a.startSec - b.startSec) : null;
  const labels = labelSections(timeline.sections, kept);
  return {
    ...timeline,
    lines: kept,
    lyricSource: kept ? source : "none",
    ...(note ? { lyricNote: note } : {}),
    sections: timeline.sections.map((s, i) => ({
      ...s,
      provisional: labels[i],
      lines: (kept ?? []).filter((l) => l.endSec > s.startSec && l.startSec < s.endSec),
    })),
  };
}

/**
 * Lyrics the owner pasted, spread across the stretches of the song that have
 * energy in them.
 *
 * This is an alignment, not a transcription, and the difference matters enough
 * to be explicit in the UI: nothing here heard the words. What it does is
 * honest and useful — it distributes the lines the owner gave over the sections
 * that are NOT instrumental, in order, proportionally to each section's length,
 * so the board has words roughly where they belong and the owner can drag them
 * true. Without it, pasted lyrics would be a blob with no clock at all.
 */
export function alignPastedLyrics(timeline: AudioTimeline, text: string): Line[] {
  const raw = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    // A bracketed line is a structure marker, not a lyric: "[Chorus]".
    .filter((l) => l && !/^[[(].*[\])]$/.test(l));
  if (!raw.length) return [];

  // Only the sung sections get words. An intro nobody sings over should not be
  // handed the first line of the first verse.
  const over = timeline.sections.filter((s) => s.provisional !== "instrumental");
  const spans = (over.length ? over : timeline.sections).map((s) => ({
    startSec: s.startSec,
    endSec: s.endSec,
  }));
  const total = spans.reduce((t, s) => t + (s.endSec - s.startSec), 0) || timeline.durationSec;

  const out: Line[] = [];
  let taken = 0;
  for (const span of spans) {
    const share = (span.endSec - span.startSec) / total;
    const count = Math.max(0, Math.round(raw.length * share));
    const slice = raw.slice(taken, taken + count);
    taken += slice.length;
    const each = slice.length ? (span.endSec - span.startSec) / slice.length : 0;
    slice.forEach((text, i) => {
      out.push({
        startSec: Math.round((span.startSec + i * each) * 100) / 100,
        endSec: Math.round((span.startSec + (i + 1) * each) * 100) / 100,
        text,
        owned: true,
      });
    });
  }
  // Rounding can leave the last lines unplaced; they belong at the end.
  const rest = raw.slice(taken);
  if (rest.length && spans.length) {
    const last = spans[spans.length - 1];
    const each = (last.endSec - last.startSec) / (rest.length + 1);
    rest.forEach((text, i) => {
      out.push({
        startSec: Math.round((last.startSec + i * each) * 100) / 100,
        endSec: Math.round((last.startSec + (i + 1) * each) * 100) / 100,
        text,
        owned: true,
      });
    });
  }
  return out.sort((a, b) => a.startSec - b.startSec);
}
