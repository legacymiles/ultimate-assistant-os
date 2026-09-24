import { describe, expect, it } from "vitest";
import { CHUNK_SEC, OVERLAP_SEC, chunksOf, mergeLines } from "./transcribe";
import type { Line } from "./timeline";

const line = (startSec: number, text: string, endSec = startSec + 3): Line => ({ startSec, endSec, text });

describe("chunksOf", () => {
  it("covers the whole track", () => {
    const chunks = chunksOf(200);
    expect(chunks[0].startSec).toBe(0);
    expect(chunks[chunks.length - 1].endSec).toBe(200);
  });

  it("overlaps neighbours, so no line is only ever heard in half", () => {
    const chunks = chunksOf(200);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i - 1].endSec - chunks[i].startSec).toBeCloseTo(OVERLAP_SEC, 5);
    }
  });

  it("never sends more than one chunk's worth in a request", () => {
    for (const c of chunksOf(500)) expect(c.endSec - c.startSec).toBeLessThanOrEqual(CHUNK_SEC);
  });

  it("is a single chunk for a track shorter than one", () => {
    expect(chunksOf(20)).toEqual([{ startSec: 0, endSec: 20 }]);
  });

  it("adds no empty chunk when the step lands exactly on the end", () => {
    // 36 s step: 0-40 already reaches the end of a 40 s track.
    expect(chunksOf(CHUNK_SEC)).toHaveLength(1);
    for (const c of chunksOf(CHUNK_SEC * 2)) expect(c.endSec).toBeGreaterThan(c.startSec);
  });

  it("has nothing to do with no audio", () => {
    expect(chunksOf(0)).toEqual([]);
  });
});

describe("mergeLines", () => {
  it("drops the same line heard twice in an overlap", () => {
    const merged = mergeLines([
      [line(10, "I woke up thinking about you")],
      [line(10.4, "I woke up thinking about you!")],
    ]);
    expect(merged).toHaveLength(1);
    // The earlier chunk's version wins: it heard the line with more after it.
    expect(merged[0].startSec).toBe(10);
  });

  it("drops a half-heard line in favour of the fuller one", () => {
    const merged = mergeLines([
      [line(36, "Now I'm driving through the city")],
      [line(36.5, "driving through the city")],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe("Now I'm driving through the city");
  });

  it("keeps a genuine repeat of a hook a section later", () => {
    const merged = mergeLines([[line(20, "all night"), line(80, "all night")]]);
    expect(merged).toHaveLength(2);
  });

  it("keeps two different lines at the same moment in different chunks", () => {
    const merged = mergeLines([[line(38, "hold on")], [line(38.2, "let it go")]]);
    expect(merged).toHaveLength(2);
  });

  it("returns everything in time order across chunks", () => {
    const merged = mergeLines([
      [line(40, "third"), line(10, "first")],
      [line(70, "fourth")],
      [line(25, "second")],
    ]);
    expect(merged.map((l) => l.text)).toEqual(["first", "second", "third", "fourth"]);
  });

  it("ignores lines with no words in them", () => {
    expect(mergeLines([[line(1, "   "), line(2, "!!!")]])).toEqual([]);
  });

  it("has nothing to merge from nothing", () => {
    expect(mergeLines([])).toEqual([]);
    expect(mergeLines([[], []])).toEqual([]);
  });
});
