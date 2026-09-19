import { describe, expect, it } from "vitest";
import {
  STYLE_LIMIT,
  charCount,
  checkStyle,
  fitToLimit,
  forbiddenNames,
  libraryRefsFor,
  normalizePrompt,
  offlineStyle,
  stylePrompt,
  type StyleBrief,
} from "./style";
import type { Song } from "./types";

const GOOD =
  "Dark club-rap, 128 BPM, F# minor; identity: a distant band-passed sung hook buried under the rapper like a half-heard radio signal. " +
  "Four-on-the-floor kick with a syncopated 808 that bounces off it, off-beat open hats, dry clap on 2 and 4. " +
  "Hypnotic 4-note pluck motif repeats; wide detuned pad with minor chords and a borrowed major lift in the hook. " +
  "VOX: rapper up front with loose off-grid phrasing, audible breaths, intensity rising into the hook, doubled end words, ad-libs; " +
  "a sung layer holds long notes underneath and answers him. Tape-saturated delay throws, filtered reverb tails. " +
  "Intro: filtered pad and buried hook alone; drums drop out for one bar of silence before the first hook, then kick and sub land together. " +
  "Verse 2 adds a shaker layer and switches the 808 rhythm; fake drop before the last chorus, which returns harder with wider harmonies and a new counter-melody.";

const BRIEF: StyleBrief = { describe: "dark fun club song", refArtists: "Regard, Zeddy Will", useTaste: true };

describe("the 1,000-character rule", () => {
  it("never lets a prompt through over the limit", () => {
    const long = `${GOOD} ${GOOD}`;
    expect(charCount(long)).toBeGreaterThan(STYLE_LIMIT);
    const fitted = fitToLimit(long);
    expect(charCount(fitted)).toBeLessThanOrEqual(STYLE_LIMIT);
    // It ends on a full clause, not mid-word.
    expect(fitted).toMatch(/[.!]$/);
  });

  it("leaves a prompt that fits untouched", () => {
    expect(fitToLimit(GOOD)).toBe(GOOD);
  });

  it("counts characters, not UTF-16 units", () => {
    expect(charCount("♪—é")).toBe(3);
  });

  it("the offline draft respects the limit too", () => {
    const { prompt } = offlineStyle({ describe: "x".repeat(50), avoid: "y ".repeat(400) });
    expect(charCount(prompt)).toBeLessThanOrEqual(STYLE_LIMIT);
  });
});

describe("the quality gate", () => {
  it("passes a real producer prompt", () => {
    const failed = checkStyle(GOOD, BRIEF, "distant band-passed sung hook buried under the rapper").filter((c) => !c.pass);
    expect(failed.map((c) => c.id)).toEqual([]);
  });

  it("fails the generic prompt the owner hates", () => {
    const bad = "Create a catchy, energetic, emotional song with professional vocals and modern production.";
    const failed = checkStyle(bad, BRIEF, "").filter((c) => !c.pass).map((c) => c.id);
    expect(failed).toEqual(expect.arrayContaining(["filler", "space", "identity", "movement", "vocal", "drums-bass"]));
  });

  it("catches reference names and review voice", () => {
    const failed = checkStyle(`${GOOD} Like Zeddy Will, this song evokes the club.`, BRIEF, "buried sung hook")
      .filter((c) => !c.pass)
      .map((c) => c.id);
    expect(failed).toEqual(expect.arrayContaining(["names", "voice"]));
  });

  it("does not flag a one-word song title used as a normal word", () => {
    const names = forbiddenNames({ describe: "", refSongs: "Breathe - EMBRZ" });
    expect(names).toContain("EMBRZ");
    expect(names).not.toContain("Breathe");
  });

  it("drops a note in brackets when reading a reference line", () => {
    const names = forbiddenNames({ describe: "", refSongs: "Went Legit - G Herbo (the barely audible sung hook)", useTaste: false });
    expect(names).toEqual(expect.arrayContaining(["G Herbo", "Went Legit"]));
  });

  it("rejects quoted lyric lines", () => {
    const failed = checkStyle(`${GOOD.slice(0, 700)} hook sings "baby come back to me tonight"`, BRIEF, "buried sung hook");
    expect(failed.find((c) => c.id === "no-lyrics")?.pass).toBe(false);
  });
});

describe("prompt building", () => {
  it("keeps keys like F# minor intact", () => {
    expect(normalizePrompt('Style prompt: "**Dark** club, F# minor,\nsub_bass"')).toBe("Dark club, F# minor, sub_bass");
  });

  it("includes the taste profile only when asked", () => {
    expect(stylePrompt({ describe: "a", useTaste: true })).toContain("barely-hear-it");
    expect(stylePrompt({ describe: "a", useTaste: false })).not.toContain("barely-hear-it");
  });

  it("finds typed references already in the library", () => {
    const song = {
      id: "1",
      title: "Ride It",
      artist: "Regard",
      genre: "House",
      subgenre: "Deep house",
      level: 7,
      tags: ["hypnotic"],
      profile: { bpm: 118, key: "A minor", energy: 70, mood: [], instruments: ["pluck"], vocals: "pitched", production: "sidechained", era: "", similarArtists: [] },
    } as unknown as Song;
    const refs = libraryRefsFor({ describe: "the energy of ride it" }, [song]);
    expect(refs).toHaveLength(1);
    expect(refs[0].bpm).toBe(118);
  });
});
