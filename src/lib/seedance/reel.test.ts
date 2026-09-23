import { describe, expect, it } from "vitest";
import {
  DEFAULT_REEL_SEC,
  MAX_BLOCK_SEC,
  MIN_BLOCK_SEC,
  MIN_LIP_SEC,
  addBlock,
  blankLip,
  blankPrompt,
  clampLip,
  duplicateBlock,
  firstFreeSlot,
  freeRanges,
  layout,
  lipOverlap,
  placedAt,
  removeBlock,
  reorder,
  resizeBlock,
  spanSec,
  videoSec,
} from "./reel";
import type { LipRange, Reel, VideoPrompt } from "./types";

const lip = (start: number, dur: number): LipRange => ({ ...blankLip(start, dur), id: `lip-${start}` });

const blocks = (...durations: number[]): VideoPrompt[] =>
  durations.map((d, i) => ({ ...blankPrompt(d), id: `vid-${i}`, prompt: `shot ${i}` }));

const reel = (prompts: VideoPrompt[], lipsync: LipRange[] = [], songDur = 60): Reel => ({
  id: "r",
  name: "r",
  direction: "",
  cinema: {},
  aspectRatio: "16:9",
  song: { name: "s.mp3", type: "audio/mpeg", durationSec: songDur },
  prompts,
  lipsync,
  created_at: "",
  updated_at: "",
});

describe("lengths", () => {
  it("sums the cut", () => {
    expect(videoSec(blocks(5, 4, 6))).toBe(15);
  });

  it("spans the song when the cut is shorter", () => {
    expect(spanSec(reel(blocks(5, 5)))).toBe(60);
  });

  it("spans the cut when it overruns the song", () => {
    expect(spanSec(reel(blocks(15, 15), [], 20))).toBe(30);
  });

  it("falls back to the runway with no song", () => {
    expect(spanSec({ ...reel(blocks(5)), song: null })).toBe(DEFAULT_REEL_SEC);
  });
});

describe("layout", () => {
  it("lays blocks end to end from zero, with no seam", () => {
    const placed = layout(reel(blocks(5, 4, 6)));
    expect(placed.map((p) => p.startSec)).toEqual([0, 5, 9]);
    expect(placed[2].startSec + placed[2].durationSec).toBe(15);
  });

  it("marks only the blocks a lip-sync range lands on", () => {
    // Range 6→12 touches block 1 (5–9) and block 2 (9–15).
    const placed = layout(reel(blocks(5, 4, 6), [lip(6, 6)]));
    expect(placed.map((p) => p.lipSynced)).toEqual([false, true, true]);
    expect(placed[1].lipSec).toBe(3);
    expect(placed[2].lipSec).toBe(3);
  });

  it("ignores an overlap too small to be an instruction", () => {
    // Only 0.2s of block 0 is covered — a nudge, not a decision to sing.
    const placed = layout(reel(blocks(5, 5), [lip(4.8, 5)]));
    expect(placed[0].lipSynced).toBe(false);
    expect(placed[1].lipSynced).toBe(true);
  });

  it("finds the block under the playhead", () => {
    const r = reel(blocks(5, 4, 6));
    expect(placedAt(r, 0)?.index).toBe(0);
    expect(placedAt(r, 5)?.index).toBe(1);
    expect(placedAt(r, 14.9)?.index).toBe(2);
    expect(placedAt(r, 15)).toBeNull();
  });
});

describe("lipOverlap", () => {
  it("adds up every range that touches the window", () => {
    expect(lipOverlap([lip(0, 3), lip(10, 4)], 2, 10)).toBe(3); // 1s + 2s
  });

  it("is zero when nothing touches", () => {
    expect(lipOverlap([lip(20, 5)], 0, 10)).toBe(0);
  });
});

describe("freeRanges", () => {
  it("is the whole song when nothing is placed", () => {
    expect(freeRanges([], 60)).toEqual([{ startSec: 0, durationSec: 60 }]);
  });

  it("carves around a range", () => {
    expect(freeRanges([lip(10, 5)], 60)).toEqual([
      { startSec: 0, durationSec: 10 },
      { startSec: 15, durationSec: 45 },
    ]);
  });

  it("skips stretches too short to hold a range", () => {
    expect(freeRanges([lip(0, 5), lip(5.5, 5)], 20)).toEqual([{ startSec: 10.5, durationSec: 9.5 }]);
  });
});

describe("clampLip", () => {
  const ranges = [lip(0, 5), lip(20, 5)];

  it("keeps a range inside the song", () => {
    expect(clampLip([], "new", -4, 5, 60)).toEqual({ startSec: 0, durationSec: 5 });
    expect(clampLip([], "new", 58, 5, 60)).toEqual({ startSec: 55, durationSec: 5 });
  });

  it("slides off a neighbour instead of landing on it", () => {
    expect(clampLip(ranges, "new", 1, 5, 60)).toEqual({ startSec: 5, durationSec: 5 });
  });

  it("trims rather than overlapping the range ahead", () => {
    const grown = clampLip(ranges, "lip-0", 0, 30, 60);
    expect(grown.startSec + grown.durationSec).toBeLessThanOrEqual(20);
  });

  it("enforces the minimum length", () => {
    expect(clampLip([], "x", 0, 0.1, 60).durationSec).toBe(MIN_LIP_SEC);
  });

  it("leaves a range where it was when the song is full", () => {
    const full = [lip(0, 30), lip(30, 30)];
    expect(clampLip(full, "lip-30", 2, 30, 60)).toEqual({ startSec: 30, durationSec: 30 });
  });
});

describe("firstFreeSlot", () => {
  it("finds room after an existing range", () => {
    expect(firstFreeSlot([lip(0, 10)], 60)).toEqual({ startSec: 10, durationSec: 5 });
  });

  it("shrinks to fit a short stretch", () => {
    expect(firstFreeSlot([lip(3, 10)], 60)).toEqual({ startSec: 0, durationSec: 3 });
  });

  it("gives up when the song is full", () => {
    expect(firstFreeSlot([lip(0, 30), lip(30, 30)], 60)).toBeNull();
  });
});

describe("editing the video lane", () => {
  it("clamps a resize to what Seedance can render", () => {
    expect(resizeBlock(blocks(5), 0, 99)[0].durationSec).toBe(MAX_BLOCK_SEC);
    expect(resizeBlock(blocks(5), 0, 0)[0].durationSec).toBe(MIN_BLOCK_SEC);
  });

  it("reorders without losing a block", () => {
    const next = reorder(blocks(1, 2, 3), 0, 2);
    expect(next.map((b) => b.prompt)).toEqual(["shot 1", "shot 2", "shot 0"]);
  });

  it("adds after the clicked block, not always at the end", () => {
    const next = addBlock(blocks(1, 2, 3), 0);
    expect(next.map((b) => b.prompt)).toEqual(["shot 0", "", "shot 1", "shot 2"]);
  });

  it("adds at the end with no index", () => {
    expect(addBlock(blocks(1, 2))).toHaveLength(3);
  });

  it("empties rather than deleting the last block", () => {
    const next = removeBlock(blocks(5), 0);
    expect(next).toHaveLength(1);
    expect(next[0].prompt).toBe("");
    expect(next[0].id).toBe("vid-0");
  });

  it("deletes a block that has siblings", () => {
    expect(removeBlock(blocks(1, 2, 3), 1).map((b) => b.prompt)).toEqual(["shot 0", "shot 2"]);
  });

  it("duplicates next to the original, without its render", () => {
    const src = blocks(5);
    src[0].status = "done";
    src[0].videoUrl = "blob:x";
    const next = duplicateBlock(src, 0);
    expect(next).toHaveLength(2);
    expect(next[1].prompt).toBe("shot 0");
    expect(next[1].id).not.toBe(next[0].id);
    expect(next[1].videoUrl).toBeUndefined();
    expect(next[1].status).toBe("idle");
  });
});
