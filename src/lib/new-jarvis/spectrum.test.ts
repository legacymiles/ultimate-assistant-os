import { describe, expect, it } from "vitest";
import {
  BAND_COUNT,
  bandEdges,
  bandsFrom,
  idleEnvelope,
  isVoice,
  loudness,
  peakOf,
  rmsOf,
  smoothBands,
  smoothTo,
  speechEnvelope,
} from "./spectrum";

/** A frequency snapshot with energy only in the bins between `from` and `to`. */
const binsWith = (size: number, from: number, to: number, value = 255) => {
  const bins = new Uint8Array(size);
  for (let i = from; i < to && i < size; i += 1) bins[i] = value;
  return bins;
};

/** A time-domain snapshot of a sine at the given amplitude. */
const wave = (size: number, amplitude: number) => {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) out[i] = Math.round(128 + Math.sin((i / size) * Math.PI * 8) * 127 * amplitude);
  return out;
};

describe("bandEdges", () => {
  it("is log-spaced, so low bands are narrow and high bands are wide", () => {
    // The whole reason this exists: with linear buckets almost all vocal
    // energy lands in the first two bars and the rest never moves.
    const edges = bandEdges(128, 8);
    const widths = [...edges].slice(1).map((e, i) => e - edges[i]);
    expect(widths[0]).toBeLessThan(widths[widths.length - 1]);
  });

  it("gives every band its own bin whenever there are bins to spare", () => {
    // A log scale repeats its edges at the bottom, and a zero-width band would
    // read as permanently silent. 128 bins is what fftSize 256 actually gives.
    for (const bins of [64, 128, 1024]) {
      const edges = bandEdges(bins, BAND_COUNT);
      for (let i = 1; i <= BAND_COUNT; i += 1) expect(edges[i]).toBeGreaterThan(edges[i - 1]);
    }
  });

  it("degrades honestly when there are fewer bins than bands", () => {
    // Neighbouring bands then share a bin, which is the truth at that
    // resolution — and every band must still read a real bin rather than
    // dividing by a zero width.
    const edges = bandEdges(8, BAND_COUNT);
    for (let i = 1; i <= BAND_COUNT; i += 1) expect(edges[i]).toBeGreaterThanOrEqual(edges[i - 1]);

    const bands = bandsFrom(binsWith(8, 1, 8), BAND_COUNT);
    expect(bands).toHaveLength(BAND_COUNT);
    for (const v of bands) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it("skips bin 0, which is DC offset and not a sound", () => {
    expect(bandEdges(128, 8)[0]).toBeGreaterThanOrEqual(1);
  });

  it("returns the same array for the same shape, rather than recomputing every frame", () => {
    expect(bandEdges(128, 8)).toBe(bandEdges(128, 8));
  });
});

describe("bandsFrom", () => {
  it("puts low-frequency energy in low bands and high in high", () => {
    const low = bandsFrom(binsWith(128, 1, 8), 8);
    const high = bandsFrom(binsWith(128, 100, 128), 8);
    expect(low[0]).toBeGreaterThan(low[7]);
    expect(high[7]).toBeGreaterThan(high[0]);
  });

  it("reads silence as zero", () => {
    expect([...bandsFrom(new Uint8Array(128), 8)]).toEqual(new Array(8).fill(0));
  });

  it("never exceeds 1, even with the high-end tilt applied to a full-scale signal", () => {
    for (const v of bandsFrom(binsWith(128, 1, 128, 255), BAND_COUNT)) {
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("tilts the top end up, so the upper bands are not permanently dead", () => {
    // Equal energy everywhere should NOT read as a downward slope; speech
    // falls away steeply with frequency and the display has to compensate.
    const flat = bandsFrom(binsWith(128, 1, 128, 60), BAND_COUNT);
    expect(flat[BAND_COUNT - 1]).toBeGreaterThan(flat[0]);
  });

  it("reuses the output buffer rather than allocating one per frame", () => {
    const out = new Float32Array(BAND_COUNT);
    expect(bandsFrom(binsWith(128, 1, 20), BAND_COUNT, out)).toBe(out);
  });

  it("allocates a fresh buffer when the one it is given is too small", () => {
    const tooSmall = new Float32Array(2);
    expect(bandsFrom(binsWith(128, 1, 20), BAND_COUNT, tooSmall)).not.toBe(tooSmall);
  });

  it("survives an empty analyser rather than dividing by nothing", () => {
    expect([...bandsFrom(new Uint8Array(0), 4)]).toEqual([0, 0, 0, 0]);
  });
});

describe("smoothTo", () => {
  it("rises faster than it falls, which is what makes a meter read as alive", () => {
    const up = smoothTo(0, 1);
    const down = 1 - smoothTo(1, 0);
    expect(up).toBeGreaterThan(down);
  });

  it("catches a consonant — a one-frame spike still registers", () => {
    // With a slow attack the few milliseconds of a hard consonant never show,
    // and that is precisely what makes speech look like speech.
    expect(smoothTo(0, 1)).toBeGreaterThan(0.4);
  });

  it("converges rather than oscillating", () => {
    let v = 0;
    for (let i = 0; i < 60; i += 1) v = smoothTo(v, 0.5);
    expect(v).toBeCloseTo(0.5, 2);
  });

  it("holds still when it is already there", () => {
    expect(smoothTo(0.4, 0.4)).toBeCloseTo(0.4, 6);
  });

  it("smooths a whole band array in place", () => {
    const current = new Float32Array([0, 0, 0]);
    const target = new Float32Array([1, 1, 1]);
    expect(smoothBands(current, target)).toBe(current);
    expect(current[0]).toBeGreaterThan(0);
  });

  it("does not read past the end of a shorter array", () => {
    const current = new Float32Array([0, 0, 0]);
    expect(() => smoothBands(current, new Float32Array([1]))).not.toThrow();
    expect(current[1]).toBe(0);
  });
});

describe("peakOf and rmsOf", () => {
  it("both rise with amplitude", () => {
    expect(peakOf(wave(128, 0.8))).toBeGreaterThan(peakOf(wave(128, 0.1)));
    expect(rmsOf(wave(128, 0.8))).toBeGreaterThan(rmsOf(wave(128, 0.1)));
  });

  it("read a flat 128 as silence, because 128 is the zero line not a value", () => {
    const silent = new Uint8Array(128).fill(128);
    expect(peakOf(silent)).toBe(0);
    expect(rmsOf(silent)).toBe(0);
  });

  it("rms is steadier than peak on the same signal", () => {
    const w = wave(256, 0.7);
    expect(rmsOf(w)).toBeLessThan(peakOf(w));
  });

  it("survives an empty snapshot", () => {
    expect(rmsOf(new Uint8Array(0))).toBe(0);
    expect(peakOf(new Uint8Array(0))).toBe(0);
  });
});

describe("loudness", () => {
  it("is the mean of the bands", () => {
    expect(loudness(new Float32Array([0, 0.5, 1]))).toBeCloseTo(0.5, 5);
  });

  it("is zero for no bands rather than NaN", () => {
    expect(loudness(new Float32Array(0))).toBe(0);
  });
});

describe("speechEnvelope", () => {
  it("is deterministic in t, so it can be tested and two reactors agree", () => {
    // No Math.random anywhere: a shimmer that cannot be reproduced cannot be
    // asserted, and two instances would disagree on the same page.
    expect([...speechEnvelope(1.234)]).toEqual([...speechEnvelope(1.234)]);
  });

  it("stays in range across a long run", () => {
    for (let t = 0; t < 40; t += 0.37) {
      for (const v of speechEnvelope(t)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("actually moves, rather than sitting at a constant", () => {
    const a = loudness(speechEnvelope(0.1));
    const b = loudness(speechEnvelope(0.6));
    expect(Math.abs(a - b)).toBeGreaterThan(0.01);
  });

  it("is loudest in the lower-middle, the way a voice is", () => {
    // Averaged over time so one syllable's flutter cannot decide it.
    const total = new Float32Array(BAND_COUNT);
    for (let t = 0; t < 30; t += 0.11) {
      const bands = speechEnvelope(t);
      for (let i = 0; i < BAND_COUNT; i += 1) total[i] += bands[i];
    }
    const mid = total[Math.floor(BAND_COUNT * 0.35)];
    expect(mid).toBeGreaterThan(total[0]);
    expect(mid).toBeGreaterThan(total[BAND_COUNT - 1]);
  });
});

describe("idleEnvelope", () => {
  it("is small enough to read as 'hearing nothing' but not flat", () => {
    // Flat reads as broken; anything larger reads as a voice that is not there.
    for (let t = 0; t < 20; t += 0.3) {
      const level = loudness(idleEnvelope(t));
      expect(level).toBeGreaterThan(0);
      expect(level).toBeLessThan(0.06);
    }
  });

  it("is below the voice floor, so an idle room never reads as speech", () => {
    for (let t = 0; t < 20; t += 0.3) expect(isVoice(loudness(idleEnvelope(t)))).toBe(false);
  });
});

describe("isVoice", () => {
  it("separates a room from a voice", () => {
    expect(isVoice(0.01)).toBe(false);
    expect(isVoice(0.3)).toBe(true);
  });
});
