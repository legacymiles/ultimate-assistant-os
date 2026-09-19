import { describe, expect, it } from "vitest";
import {
  STYLE_LIMIT,
  charCount,
  checkStyle,
  coerceFacts,
  fitToLimit,
  forbiddenNames,
  normalizePrompt,
  offlineStyle,
  songStylePrompt,
} from "./style";
import type { Song } from "./types";

const SONG = {
  id: "s1",
  title: "Went Legit",
  artist: "G Herbo",
  album: "Survivor's Remorse",
  year: "2023",
  links: [],
  level: 7,
  genre: "Hip-Hop",
  subgenre: "Chicago drill",
  levelReason: "hard, driving",
  confidence: "known",
  tags: ["sample", "drill"],
  descriptions: { producer: "Pitched soul sample under hard drums." },
  notes: "",
  filedBy: "ai",
  addedAt: "",
  updatedAt: "",
  profile: {
    bpm: 144,
    key: "F# minor",
    energy: 75,
    mood: ["triumphant", "gritty"],
    instruments: ["808", "soul sample", "hi-hats"],
    vocals: "aggressive male rap",
    production: "buried pitched soul vocal sample looped under drill drums",
    era: "2020s",
    similarArtists: ["Lil Durk"],
  },
} as unknown as Song;

const GOOD =
  "Chicago drill, 144 BPM, F# minor, half-time feel; signature: a buried, pitched-up soul vocal sample looped under everything, band-passed and tape-warm like an old record. " +
  "Drums: sliding 808s with long glides, stuttered triplet hi-hats, sharp snare on 3, sparse kick pattern. " +
  "Minor chord loop from the sample, a descending 4-note piano motif doubling the hook melody. " +
  "VOX: aggressive male rap, loose phrasing ahead of the beat, audible breaths, rising intensity into each hook, doubled punchlines, ad-libs panned wide; dry close-mic lead, delay throws on line ends. " +
  "Intro: sample alone, filtered; drums drop in on bar 5; the 808 drops out for two bars before the second verse; beat returns harder, outro strips back to the sample. Mix: heavy sub, bright hats, vocal forward.";

const FACTS = { identity: "buried pitched soul vocal sample looped under drill drums", vocals: true, drums: true };

describe("the 1,000-character rule", () => {
  it("never lets a prompt through over the limit", () => {
    const fitted = fitToLimit(`${GOOD} ${GOOD}`);
    expect(charCount(fitted)).toBeLessThanOrEqual(STYLE_LIMIT);
    expect(fitted).toMatch(/[.!]$/);
  });

  it("leaves a prompt that fits untouched", () => {
    expect(fitToLimit(GOOD)).toBe(GOOD);
  });

  it("the profile-built draft respects the limit too", () => {
    const big = {
      ...SONG,
      tags: Array(200).fill("very-long-tag-name"),
      profile: { ...SONG.profile, production: "x ".repeat(600) },
    };
    expect(charCount(offlineStyle(big as Song).prompt)).toBeLessThanOrEqual(STYLE_LIMIT);
  });
});

describe("the quality gate", () => {
  it("passes an accurate producer prompt", () => {
    const failed = checkStyle(GOOD, SONG, FACTS).filter((c) => !c.pass);
    expect(failed.map((c) => c.id)).toEqual([]);
  });

  it("fails a generic prompt", () => {
    const bad = "Create a catchy, energetic drill song with professional vocals and modern production.";
    const failed = checkStyle(bad, SONG, FACTS)
      .filter((c) => !c.pass)
      .map((c) => c.id);
    expect(failed).toEqual(expect.arrayContaining(["filler", "space", "tempo-key", "movement", "vocal", "drums-bass"]));
  });

  it("catches the artist, title and similar artists", () => {
    const failed = checkStyle(`${GOOD} Like G Herbo on Went Legit, a Lil Durk flow.`, SONG, FACTS)
      .filter((c) => !c.pass)
      .map((c) => c.id);
    expect(failed).toContain("names");
  });

  it("skips vocal checks for an instrumental", () => {
    const ids = checkStyle(GOOD, SONG, { ...FACTS, vocals: false }).map((c) => c.id);
    expect(ids).not.toContain("vocal");
    expect(ids).not.toContain("vocal-fx");
  });

  it("requires the measured tempo and key", () => {
    const off = checkStyle(GOOD.replace("144", "140"), SONG, FACTS).find((c) => c.id === "tempo-key");
    expect(off?.pass).toBe(false);
  });

  it("splits collaborations into separate names", () => {
    expect(forbiddenNames({ ...SONG, artist: "Drake & Future feat. Young Thug" })).toEqual(
      expect.arrayContaining(["Drake", "Future", "Young Thug"]),
    );
  });
});

describe("prompt building", () => {
  it("keeps keys like F# minor intact", () => {
    expect(normalizePrompt('Style prompt: "**Dark** drill, F# minor,\nsub_bass"')).toBe(
      "Dark drill, F# minor, sub_bass",
    );
  });

  it("hands the model the recording, the measured facts and existing notes", () => {
    const p = songStylePrompt(SONG);
    expect(p).toContain('"Went Legit" by G Herbo');
    expect(p).toContain("Use 144 BPM and F# minor");
    expect(p).toContain("Pitched soul sample");
  });

  it("tells the model an own song is unreleased", () => {
    expect(songStylePrompt({ ...SONG, kind: "own" })).toContain("unreleased");
  });

  it("defaults facts to vocals and drums", () => {
    expect(coerceFacts({ identity: " x " })).toEqual({ identity: "x", vocals: true, drums: true });
    expect(coerceFacts({ vocals: false, drums: false }).vocals).toBe(false);
  });
});
