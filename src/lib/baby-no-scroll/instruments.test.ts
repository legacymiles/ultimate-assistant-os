import { describe, expect, it } from "vitest";
import { SCALE } from "./audio";
import {
  BONGO_FREQ,
  INSTRUMENTS,
  densityGain,
  isInstrumentId,
  karplus,
  ksPeriod,
  noteHue,
  scaleFreq,
} from "./instruments";

/** Pitch class in semitones above C, from a frequency. */
const pitchClass = (f: number) => {
  const semis = Math.round(12 * Math.log2(f / 261.63));
  return ((semis % 12) + 12) % 12;
};
const C_PENTATONIC = new Set([0, 2, 4, 7, 9]);

describe("scaleFreq", () => {
  it("starts on middle C and climbs the pentatonic", () => {
    expect(scaleFreq(0)).toBeCloseTo(SCALE[0], 2);
    expect(scaleFreq(4)).toBeCloseTo(SCALE[4], 2);
    expect(scaleFreq(5)).toBeCloseTo(SCALE[0] * 2, 2);
    expect(scaleFreq(-5)).toBeCloseTo(SCALE[0] / 2, 2);
  });

  it("never leaves C major pentatonic, in any octave", () => {
    for (let i = -12; i <= 16; i++) expect(C_PENTATONIC.has(pitchClass(scaleFreq(i)))).toBe(true);
  });

  it("only ever rises as the step rises", () => {
    for (let i = -12; i < 16; i++) expect(scaleFreq(i + 1)).toBeGreaterThan(scaleFreq(i));
  });

  it("keeps the bongos in key", () => {
    for (const f of BONGO_FREQ) expect(C_PENTATONIC.has(pitchClass(f))).toBe(true);
  });
});

describe("densityGain", () => {
  it("leaves a chord alone and trims a crowd, but never to silence", () => {
    expect(densityGain(1)).toBe(1);
    expect(densityGain(3)).toBe(1);
    expect(densityGain(8)).toBeLessThan(1);
    expect(densityGain(8)).toBeLessThan(densityGain(5));
    expect(densityGain(500)).toBeGreaterThan(0.3);
  });
});

describe("ksPeriod", () => {
  it("corrects the rounded delay back onto the exact pitch", () => {
    for (const f of [130.81, 261.63, 523.25, 1046.5]) {
      const { n, rate } = ksPeriod(48000, f);
      expect(48000 / (n + 0.5) * rate).toBeCloseTo(f, 6);
      // The correction is small: playback is never more than a sample's worth off.
      expect(rate).toBeLessThanOrEqual(1);
      expect(rate).toBeGreaterThan(1 - 1 / n);
    }
  });
});

describe("karplus", () => {
  // A fixed noise source so the test is the same every run.
  const seeded = () => {
    let s = 12345;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  };

  it("rings and then dies away", () => {
    const sr = 22050;
    const out = karplus(sr, 261.63, 1.5, seeded());
    expect(out.length).toBe(Math.floor(sr * 1.5));
    const energy = (a: number, b: number) => {
      let e = 0;
      for (let i = a; i < b; i++) e += out[i] * out[i];
      return e / (b - a);
    };
    const start = energy(0, sr / 10);
    const end = energy(out.length - sr / 10, out.length);
    expect(start).toBeGreaterThan(0.01);
    expect(end).toBeLessThan(start / 100);
    for (const v of out) expect(Math.abs(v)).toBeLessThanOrEqual(1.0001);
  });
});

describe("instrument ids", () => {
  it("has six instruments and recognises only them", () => {
    expect(INSTRUMENTS).toHaveLength(6);
    for (const id of INSTRUMENTS) expect(isInstrumentId(id)).toBe(true);
    expect(isInstrumentId("kazoo")).toBe(false);
    expect(isInstrumentId(null)).toBe(false);
  });

  it("colours a keyboard as a rainbow with distinct ends", () => {
    expect(noteHue(0, 8)).not.toBe(noteHue(7, 8));
    expect(noteHue(0, 1)).toBe(noteHue(0, 1));
  });
});
