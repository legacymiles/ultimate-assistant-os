import { describe, expect, it } from "vitest";
import {
  beatGrid,
  hits,
  onsetEnvelope,
  sections,
  snapToBar,
  snapToBeat,
  type Envelope,
} from "./grid";

const RATE = 22050;

/**
 * A click track: a short burst of noise on every beat, silence between.
 *
 * Synthetic on purpose. A real song would make these tests a judgement about
 * one recording; a click track has exactly one right answer, so a grid that
 * finds the wrong phase fails visibly rather than "looking about right".
 */
function clickTrack(opts: {
  bpm: number;
  seconds: number;
  /** Seconds before the first click, i.e. the phase the grid has to recover. */
  offset?: number;
  /** Extra emphasis on the first beat of each bar. */
  accentEvery?: number;
  beatsPerBar?: number;
  /** A multiplier per beat index, for building quiet and loud stretches. */
  gain?: (beat: number) => number;
}): Float32Array {
  const { bpm, seconds, offset = 0, accentEvery = 0, beatsPerBar = 4 } = opts;
  const samples = new Float32Array(Math.floor(seconds * RATE));
  const period = 60 / bpm;
  const burst = Math.floor(0.02 * RATE);
  let beat = 0;
  for (let t = offset; t < seconds; t += period, beat++) {
    const accented = accentEvery > 0 && beat % beatsPerBar === 0;
    const gain = (opts.gain?.(beat) ?? 1) * (accented ? 1 + accentEvery : 1);
    const from = Math.floor(t * RATE);
    for (let i = 0; i < burst && from + i < samples.length; i++) {
      // Decaying noise: a step change at the attack, which is what the
      // difference filter in onsetEnvelope is built to catch.
      samples[from + i] = (Math.random() * 2 - 1) * gain * (1 - i / burst);
    }
  }
  return samples;
}

/** A hand-built envelope, for the pure functions that only need a curve. */
function envelope(curve: number[], frameRate = 86): Envelope {
  return { curve, frameRate };
}

describe("onsetEnvelope", () => {
  it("normalises to a 0-1 curve at the sample rate over the hop", () => {
    const env = onsetEnvelope(clickTrack({ bpm: 120, seconds: 4 }), RATE);
    expect(env.frameRate).toBeCloseTo(RATE / 256, 5);
    expect(env.curve.length).toBeGreaterThan(300);
    expect(Math.max(...env.curve)).toBeCloseTo(1, 5);
    expect(Math.min(...env.curve)).toBeGreaterThanOrEqual(0);
  });

  it("is an onset envelope, not a loudness one: a steady tone has no flux", () => {
    // A continuous sine is loud everywhere and has an attack nowhere.
    const steady = new Float32Array(RATE * 2);
    for (let i = 0; i < steady.length; i++) steady[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / RATE);
    const env = onsetEnvelope(steady, RATE);
    // Only the very first frame rises from silence; everything after is flat.
    const after = env.curve.slice(4);
    expect(Math.max(...after)).toBeLessThan(0.2);
  });

  it("is silent for silence rather than throwing", () => {
    const env = onsetEnvelope(new Float32Array(RATE), RATE);
    expect(Math.max(...env.curve)).toBe(0);
  });
});

describe("beatGrid", () => {
  it("recovers the phase of an offset click track", () => {
    const offset = 0.31;
    const env = onsetEnvelope(clickTrack({ bpm: 120, seconds: 16, offset }), RATE);
    const grid = beatGrid(env, 120, { durationSec: 16 });

    expect(grid.bpm).toBe(120);
    expect(grid.period).toBeCloseTo(0.5, 5);
    // The first beat lands on the real click, within one envelope frame.
    expect(grid.beats[0]).toBeCloseTo(offset, 1);
    expect(grid.confidence).toBeGreaterThan(0.5);
  });

  it("lays beats across the whole track and never past the end", () => {
    const env = onsetEnvelope(clickTrack({ bpm: 90, seconds: 20 }), RATE);
    const grid = beatGrid(env, 90, { durationSec: 20 });
    // 90 BPM over 20 s is 30 beats; the exact count depends on the phase.
    expect(grid.beats.length).toBeGreaterThanOrEqual(29);
    expect(grid.beats[grid.beats.length - 1]).toBeLessThanOrEqual(20);
  });

  it("finds the bar line from the accent, not from the first beat", () => {
    // The accent is on beat 0 of each bar, but the track starts late, so a
    // grid that assumed "first beat = downbeat" would still be right by luck.
    // Offsetting by one beat makes the assumption fail and the search pass.
    const env = onsetEnvelope(
      clickTrack({ bpm: 120, seconds: 24, offset: 0.5, accentEvery: 2.5 }),
      RATE,
    );
    const grid = beatGrid(env, 120, { durationSec: 24 });
    const barTimes = grid.downbeats.map((i) => grid.beats[i]);
    expect(grid.beatsPerBar).toBe(4);
    // Every bar line sits on an accented click: 0.5 s + a whole number of bars.
    for (const t of barTimes.slice(0, 4)) {
      expect(((t - 0.5) / 2) % 1).toBeCloseTo(0, 1);
    }
  });

  it("reports low confidence when there is no pulse to lock to", () => {
    // Uniform noise: every phase is as good as every other.
    const noise = new Float32Array(RATE * 8);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;
    const grid = beatGrid(onsetEnvelope(noise, RATE), 120, { durationSec: 8 });
    expect(grid.confidence).toBeLessThan(0.3);
  });

  it("returns an empty grid rather than a fake one for a bad tempo", () => {
    const env = onsetEnvelope(clickTrack({ bpm: 120, seconds: 4 }), RATE);
    for (const bpm of [0, -5, Number.NaN]) {
      const grid = beatGrid(env, bpm);
      expect(grid.beats).toEqual([]);
      expect(grid.confidence).toBe(0);
    }
  });
});

describe("snapping", () => {
  const grid = beatGrid(envelope(new Array(860).fill(0.5)), 120, { durationSec: 10 });

  it("snaps to the nearest beat", () => {
    expect(snapToBeat(grid, 2.2)).toBeCloseTo(2, 1);
    expect(snapToBeat(grid, 2.4)).toBeCloseTo(2.5, 1);
  });

  it("snaps to the nearest bar, which is the safer default for a cut", () => {
    // 120 BPM, 4/4 → a bar every 2 s.
    expect(snapToBar(grid, 3.1)).toBeCloseTo(4, 1);
    expect(snapToBar(grid, 0.9)).toBeCloseTo(0, 1);
  });

  it("leaves a time alone when there is no grid", () => {
    const none = beatGrid(envelope([]), 0);
    expect(snapToBeat(none, 7.3)).toBe(7.3);
    expect(snapToBar(none, 7.3)).toBe(7.3);
  });
});

describe("sections", () => {
  it("splits a quiet intro from a loud body", () => {
    // 32 bars at 120 BPM: the first 8 quiet, the rest four times as loud.
    const samples = clickTrack({
      bpm: 120,
      seconds: 64,
      accentEvery: 1,
      gain: (beat) => (beat < 32 ? 0.2 : 1),
    });
    const env = onsetEnvelope(samples, RATE);
    const grid = beatGrid(env, 120, { durationSec: 64 });
    const found = sections(env, grid, { durationSec: 64, minBars: 4 });

    expect(found.length).toBeGreaterThanOrEqual(2);
    // The boundary is at the gain change, 16 s in, on a bar line.
    const boundary = found[1].startSec;
    expect(boundary).toBeGreaterThan(14);
    expect(boundary).toBeLessThan(18);
    // And the loud part really does read as louder.
    expect(found[1].energy).toBeGreaterThan(found[0].energy);
    expect(found[0].endSec).toBe(found[1].startSec);
  });

  it("covers the whole track with no gaps", () => {
    const env = onsetEnvelope(clickTrack({ bpm: 100, seconds: 48, accentEvery: 1 }), RATE);
    const grid = beatGrid(env, 100, { durationSec: 48 });
    const found = sections(env, grid, { durationSec: 48 });
    expect(found[found.length - 1].endSec).toBeCloseTo(48, 1);
    for (let i = 1; i < found.length; i++) expect(found[i].startSec).toBe(found[i - 1].endSec);
  });

  it("gives one section for a track with no usable grid", () => {
    const found = sections(envelope(new Array(400).fill(0.3)), beatGrid(envelope([]), 0), {
      durationSec: 20,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ startSec: 0, endSec: 20 });
  });

  it("never returns a section shorter than minBars", () => {
    // One very loud bar in the middle must be absorbed, not become a section.
    const env = onsetEnvelope(
      clickTrack({ bpm: 120, seconds: 64, accentEvery: 1, gain: (b) => (b >= 20 && b < 24 ? 3 : 1) }),
      RATE,
    );
    const grid = beatGrid(env, 120, { durationSec: 64 });
    const found = sections(env, grid, { durationSec: 64, minBars: 4 });
    for (const s of found) expect(s.endSec - s.startSec).toBeGreaterThan(6);
  });
});

describe("hits", () => {
  it("finds an outlier and ignores the steady beat around it", () => {
    // Every beat is an onset; only beat 40 is an outlier against its neighbours.
    const env = onsetEnvelope(
      clickTrack({ bpm: 120, seconds: 40, gain: (b) => (b === 40 ? 6 : 1) }),
      RATE,
    );
    const found = hits(env, { sigma: 3 });
    expect(found.length).toBeGreaterThan(0);
    // Beat 40 at 120 BPM is 20 s in.
    expect(found.some((h) => Math.abs(h.atSec - 20) < 0.3)).toBe(true);
    // And the ordinary beats did not all become hits.
    expect(found.length).toBeLessThan(10);
  });

  it("marks a drop: louder after than before", () => {
    const env = onsetEnvelope(
      clickTrack({ bpm: 120, seconds: 40, gain: (b) => (b < 40 ? 0.15 : 1) }),
      RATE,
    );
    const found = hits(env, { sigma: 2 });
    const drop = found.find((h) => h.drop);
    expect(drop).toBeDefined();
    expect(drop!.atSec).toBeGreaterThan(18);
    expect(drop!.atSec).toBeLessThan(22);
  });

  it("returns hits in time order even though it ranks by strength", () => {
    const env = onsetEnvelope(
      clickTrack({ bpm: 120, seconds: 60, gain: (b) => ([20, 60, 100].includes(b) ? 6 : 1) }),
      RATE,
    );
    const found = hits(env, { sigma: 2, limit: 3 });
    const times = found.map((h) => h.atSec);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("finds nothing in a track too short to have a neighbourhood", () => {
    expect(hits(envelope(new Array(20).fill(0.5)))).toEqual([]);
  });
});
