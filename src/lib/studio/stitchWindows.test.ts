// The edit bay's frame arithmetic. It lives in tools/studio-bridge because the
// bridge is what runs it, but it is tested here: a wrong frame count does not
// throw, it quietly puts a stutter or a stall in a film that took an hour of
// GPU time to make, which is the slowest kind of bug there is to find.
import { describe, expect, it } from "vitest";
import * as windows from "../../../tools/studio-bridge/windows.mjs";

type Shot = {
  chained?: boolean;
  overlap?: number;
  durationSec?: number;
  read?: { frames?: number; headTrim?: number; tailFrames?: number; meanLuma?: number };
};
type Window = { from: number; frames: number; gain: number; blendAfter: number };

// The module is plain ESM with no types — it is kept dependency-free so it can
// be copied straight into any pipeline — so the shape it is used with is
// declared here instead.
const stitchWindows = windows.stitchWindows as unknown as (
  shots: Shot[],
  opts?: { slotFrames?: (shot: Shot, index: number) => number; maxGain?: number; blendFrames?: number },
) => Window[];
const exposureGains = windows.exposureGains as unknown as (shots: Shot[], maxGain?: number) => number[];

const shot = (read: Shot["read"], extra: Partial<Shot> = {}): Shot => ({ read, ...extra });

describe("stitchWindows", () => {
  it("drops a continued shot's duplicated handover head, and nothing off its front besides", () => {
    const [, b] = stitchWindows([
      shot({ frames: 158, headTrim: 0, tailFrames: 0 }),
      shot({ frames: 124, headTrim: 9, tailFrames: 0 }, { chained: true, overlap: 18 }),
    ]);
    // The 18 frames it opens on are the previous shot's, still on screen. The
    // warm-up trim must NOT also apply — there is no warm-up in frames the
    // model was handed, and cutting there would cut into the join.
    expect(b.from).toBe(18);
    expect(b.frames).toBe(124 - 18);
  });

  it("trims the warm-up off a shot that starts something", () => {
    const [a] = stitchWindows([shot({ frames: 158, headTrim: 11, tailFrames: 0 })]);
    expect(a.from).toBe(11);
    expect(a.frames).toBe(158 - 11);
  });

  it("ends an intermediate shot where it really ends, not where its file does", () => {
    const [a] = stitchWindows([
      shot({ frames: 226, headTrim: 3, tailFrames: 26 }),
      shot({ frames: 124 }),
    ]);
    expect(a.from).toBe(3);
    expect(a.frames).toBe(226 - 3 - 26);
  });

  it("lets the LAST shot keep its landing, because nothing follows it", () => {
    // The suite's Stitch Ready / Final Clip distinction. There is no seam to
    // protect at the end of a film, and cutting away mid-gesture reads as a
    // file that ran out rather than as an ending.
    const [, b] = stitchWindows([
      shot({ frames: 124 }),
      shot({ frames: 226, headTrim: 3, tailFrames: 26 }),
    ]);
    expect(b.frames).toBe(226 - 3);
  });

  it("never lets the first shot be treated as continued, whatever it claims", () => {
    const [a] = stitchWindows([
      shot({ frames: 158, headTrim: 4 }, { chained: true, overlap: 18 }),
    ]);
    expect(a.from).toBe(4);
  });

  describe("a film cut to a song", () => {
    const slot = (sec: number) => () => Math.round(sec * 24);

    it("fills the slot exactly, taking the warm-up only out of the surplus", () => {
      // 158 frames rendered for a 5 s (120 frame) slot: 38 spare, so all 11
      // frames of warm-up can go and the slot is still full.
      const [a] = stitchWindows([shot({ frames: 158, headTrim: 11, tailFrames: 26 })], {
        slotFrames: slot(5),
      });
      expect(a.from).toBe(11);
      expect(a.frames).toBe(120);
    });

    it("would rather keep a warm-up than come up short against the music", () => {
      // Only 4 frames spare, so the 11-frame warm-up trim is cut back to 4:
      // a short clip drags the whole picture off the beat and every later shot
      // inherits the drift.
      const [a] = stitchWindows([shot({ frames: 124, headTrim: 11, tailFrames: 20 })], {
        slotFrames: slot(5),
      });
      expect(a.from).toBe(4);
      expect(a.frames).toBe(120);
    });

    it("still drops duplicated film even when that leaves the slot short", () => {
      // Duplicated frames are not optional: showing them twice is worse than
      // running a few frames light.
      const [, b] = stitchWindows(
        [shot({ frames: 124 }), shot({ frames: 124, headTrim: 9 }, { chained: true, overlap: 18 })],
        { slotFrames: slot(5) },
      );
      expect(b.from).toBe(18);
      expect(b.frames).toBe(106);
    });
  });
});

describe("exposureGains", () => {
  it("gives one gain to a whole continuous run, so a seamless join stays seamless", () => {
    // Measured on a real film: two shots inside one unbroken take sat at 0.24
    // and 0.40. Corrected separately they would want +10% and −10%, opening a
    // 22% hole in the middle of a take that had no seam in it at all.
    const gains = exposureGains([
      shot({ meanLuma: 0.30 }),
      shot({ meanLuma: 0.2385 }, { chained: true }),
      shot({ meanLuma: 0.3918 }, { chained: true }),
      shot({ meanLuma: 0.2719 }),
    ]);
    expect(gains[0]).toBe(gains[1]);
    expect(gains[1]).toBe(gains[2]);
    expect(gains[3]).not.toBe(gains[0]);
  });

  it("never corrects further than a tenth — beyond that the shot is wrong, not dark", () => {
    const gains = exposureGains([shot({ meanLuma: 0.1 }), shot({ meanLuma: 0.9 })]);
    for (const g of gains) {
      expect(g).toBeGreaterThanOrEqual(0.9);
      expect(g).toBeLessThanOrEqual(1.1);
    }
  });

  it("leaves a film with nothing to match against alone", () => {
    const gains = exposureGains([shot({ meanLuma: 0.2 }), shot({ meanLuma: 0.5 }, { chained: true })]);
    expect(gains).toEqual([1, 1]);
  });
});

describe("the seam between two shots of one take", () => {
  it("hands the last frames of a shot over to the blend, keeping the length", () => {
    const w = stitchWindows(
      [shot({ frames: 158 }), shot({ frames: 124 }, { chained: true, overlap: 35 })],
      { blendFrames: 4 },
    );
    expect(w[0].blendAfter).toBe(4);
    // 4 frames leave the body and come back as their own segment, so the shot
    // still occupies exactly what it did before.
    expect(w[0].frames + w[0].blendAfter).toBe(158);
    expect(w[1].blendAfter).toBe(0);
  });

  it("does not blend across a cut — there are no shared moments to blend", () => {
    const w = stitchWindows(
      [shot({ frames: 158 }), shot({ frames: 124 })],
      { blendFrames: 4 },
    );
    expect(w[0].blendAfter).toBe(0);
  });

  it("never asks for more blend than the incoming shot's head can supply", () => {
    const w = stitchWindows(
      [shot({ frames: 158 }), shot({ frames: 124 }, { chained: true, overlap: 2 })],
      { blendFrames: 4 },
    );
    expect(w[0].blendAfter).toBe(2);
  });

  it("is off when nobody asked for it", () => {
    const w = stitchWindows([
      shot({ frames: 158 }),
      shot({ frames: 124 }, { chained: true, overlap: 35 }),
    ]);
    expect(w[0].blendAfter).toBe(0);
    expect(w[0].frames).toBe(158);
  });
});
