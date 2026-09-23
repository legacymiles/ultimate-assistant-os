// ---------------------------------------------------------------------------
// Where everything sits.
//
// Video prompts run end to end from the top of the song, in order, exactly as
// long as the owner trimmed them. Lip-sync ranges are placed anywhere on the
// song and never overlap each other. A video block that a lip-sync range lands
// on sings; the rest play under the music.
//
// Every function here is pure. The components only draw what these return.
// ---------------------------------------------------------------------------

import { uid } from "@/lib/utils";
import type { Interval, LipRange, PlacedPrompt, Reel, VideoPrompt } from "./types";

/** Seedance renders 5–10s; the editor allows a wider range for shaping a cut. */
export const MIN_BLOCK_SEC = 1;
export const MAX_BLOCK_SEC = 15;
export const DEFAULT_BLOCK_SEC = 5;

export const MIN_LIP_SEC = 1;
export const MAX_LIP_SEC = 30;
export const DEFAULT_LIP_SEC = 5;

/** Overlap below this is a nudge, not an instruction to sing. */
export const LIP_TOUCH_SEC = 0.5;

/** The runway before a song is loaded, so the editor is never a blank wall. */
export const DEFAULT_REEL_SEC = 60;

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function blankPrompt(durationSec = DEFAULT_BLOCK_SEC): VideoPrompt {
  return { id: uid("vid"), prompt: "", cinema: {}, refs: [], durationSec, status: "idle" };
}

export function blankLip(startSec: number, durationSec: number): LipRange {
  return { id: uid("lip"), startSec: round2(startSec), durationSec: round2(durationSec) };
}

// ---------------------------------------------------------------------------
// Lengths.
// ---------------------------------------------------------------------------

/** How long the cut runs — the sum of every video block. */
export function videoSec(prompts: VideoPrompt[]): number {
  return round2(prompts.reduce((s, b) => s + b.durationSec, 0));
}

export function songSec(reel: Reel): number {
  return reel.song?.durationSec ?? DEFAULT_REEL_SEC;
}

/**
 * The width of the timeline: the song, or the cut if the owner has already run
 * past the end of it. Both are shown, so a cut that overruns is visible rather
 * than clipped off the right edge.
 */
export function spanSec(reel: Reel): number {
  return Math.max(1, songSec(reel), videoSec(reel.prompts));
}

// ---------------------------------------------------------------------------
// The lip-sync lane.
// ---------------------------------------------------------------------------

export function sortLip(ranges: LipRange[]): LipRange[] {
  return [...ranges].sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id));
}

/** Seconds of [startSec, startSec+durationSec) covered by any lip-sync range. */
export function lipOverlap(ranges: LipRange[], startSec: number, durationSec: number): number {
  const end = startSec + durationSec;
  let covered = 0;
  for (const r of ranges) {
    const from = Math.max(startSec, r.startSec);
    const to = Math.min(end, r.startSec + r.durationSec);
    if (to > from) covered += to - from;
  }
  return round2(covered);
}

/** The free stretches of the song — where another lip-sync range could go. */
export function freeRanges(ranges: LipRange[], totalSec: number): Interval[] {
  const out: Interval[] = [];
  let cursor = 0;
  for (const r of sortLip(ranges)) {
    if (r.startSec - cursor >= MIN_LIP_SEC) {
      out.push({ startSec: round2(cursor), durationSec: round2(r.startSec - cursor) });
    }
    cursor = Math.max(cursor, r.startSec + r.durationSec);
  }
  if (totalSec - cursor >= MIN_LIP_SEC) {
    out.push({ startSec: round2(cursor), durationSec: round2(totalSec - cursor) });
  }
  return out;
}

/**
 * Where a lip-sync range is allowed to be. It is fitted into the free stretch
 * it overlaps most, so a drag that lands on a neighbour slides off it instead
 * of settling there. With nowhere legal to go it stays where it was.
 */
export function clampLip(
  ranges: LipRange[],
  id: string,
  startSec: number,
  durationSec: number,
  totalSec: number,
): { startSec: number; durationSec: number } {
  const current = ranges.find((r) => r.id === id);
  const others = ranges.filter((r) => r.id !== id);
  const wantDur = clamp(durationSec, MIN_LIP_SEC, MAX_LIP_SEC);
  const wantStart = clamp(startSec, 0, Math.max(0, totalSec - wantDur));

  const free = freeRanges(others, totalSec).filter((iv) => iv.durationSec >= MIN_LIP_SEC);
  if (!free.length) {
    return current
      ? { startSec: current.startSec, durationSec: current.durationSec }
      : { startSec: round2(wantStart), durationSec: round2(wantDur) };
  }

  const wantEnd = wantStart + wantDur;
  const wantMid = wantStart + wantDur / 2;
  let best = free[0];
  let bestScore = -Infinity;
  for (const iv of free) {
    const overlap = Math.min(wantEnd, iv.startSec + iv.durationSec) - Math.max(wantStart, iv.startSec);
    const score = Math.max(0, overlap) * 1000 - Math.abs(iv.startSec + iv.durationSec / 2 - wantMid);
    if (score > bestScore) {
      bestScore = score;
      best = iv;
    }
  }

  const dur = Math.min(wantDur, best.durationSec);
  const start = clamp(wantStart, best.startSec, best.startSec + best.durationSec - dur);
  return { startSec: round2(start), durationSec: round2(dur) };
}

/** The first stretch of song with room for a new lip-sync range. */
export function firstFreeSlot(
  ranges: LipRange[],
  totalSec: number,
  wanted = DEFAULT_LIP_SEC,
): { startSec: number; durationSec: number } | null {
  const free = freeRanges(ranges, totalSec);
  if (!free.length) return null;
  const iv = free[0];
  return { startSec: iv.startSec, durationSec: round2(Math.min(wanted, iv.durationSec)) };
}

// ---------------------------------------------------------------------------
// The video lane.
// ---------------------------------------------------------------------------

/** Lay every video block out end to end and mark which ones sing. */
export function layout(reel: Reel): PlacedPrompt[] {
  const out: PlacedPrompt[] = [];
  let cursor = 0;
  reel.prompts.forEach((block, index) => {
    const lipSec = lipOverlap(reel.lipsync, cursor, block.durationSec);
    out.push({
      block,
      index,
      startSec: round2(cursor),
      durationSec: block.durationSec,
      lipSec,
      lipSynced: lipSec >= LIP_TOUCH_SEC,
    });
    cursor = round2(cursor + block.durationSec);
  });
  return out;
}

export function placedAt(reel: Reel, sec: number): PlacedPrompt | null {
  const list = layout(reel);
  for (const p of list) {
    if (sec >= p.startSec && sec < p.startSec + p.durationSec) return p;
  }
  return null;
}

export function resizeBlock(prompts: VideoPrompt[], index: number, durationSec: number): VideoPrompt[] {
  if (index < 0 || index >= prompts.length) return prompts;
  const next = [...prompts];
  next[index] = { ...next[index], durationSec: round2(clamp(durationSec, MIN_BLOCK_SEC, MAX_BLOCK_SEC)) };
  return next;
}

/** Pull a block out of the run and drop it back in at `to`, keeping the rest in order. */
export function reorder(prompts: VideoPrompt[], from: number, to: number): VideoPrompt[] {
  if (from === to || from < 0 || from >= prompts.length) return prompts;
  const target = clamp(to, 0, prompts.length - 1);
  const next = [...prompts];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Add a block after `index`, or at the end when `index` is left out. */
export function addBlock(prompts: VideoPrompt[], index?: number): VideoPrompt[] {
  const block = blankPrompt();
  if (index === undefined || index >= prompts.length - 1) return [...prompts, block];
  const next = [...prompts];
  next.splice(index + 1, 0, block);
  return next;
}

/**
 * Remove a block. The last one standing is emptied instead, because a reel
 * with no blocks has nothing to click and no way back.
 */
export function removeBlock(prompts: VideoPrompt[], index: number): VideoPrompt[] {
  if (index < 0 || index >= prompts.length) return prompts;
  if (prompts.length === 1) return [{ ...blankPrompt(), id: prompts[0].id }];
  return prompts.filter((_, i) => i !== index);
}

/** Duplicate a block, prompt and deck and all — the fastest way to a matched pair. */
export function duplicateBlock(prompts: VideoPrompt[], index: number): VideoPrompt[] {
  const src = prompts[index];
  if (!src) return prompts;
  const next = [...prompts];
  next.splice(index + 1, 0, { ...src, id: uid("vid"), status: "idle", videoUrl: undefined, error: undefined });
  return next;
}
