import { describe, expect, it } from "vitest";
import {
  STYLE_LIMIT,
  askedConcepts,
  charCount,
  fillerIn,
  fitStyle,
  offlineProduce,
  readDraft,
  readPlan,
  runQc,
  tidyLyrics,
  type ProduceInput,
} from "./producer";

const IDEA = "Make me a dark club song with a crazy hook and singing behind the rapper. I want the production to have surprises.";
const input = (patch: Partial<ProduceInput> = {}): ProduceInput => ({
  style: IDEA,
  lyrics: "",
  lyricsMode: "write",
  useTaste: true,
  ...patch,
});

describe("fitStyle", () => {
  it("leaves a legal style alone", () => {
    expect(fitStyle("dark club, 124 BPM, elastic sub-bass")).toEqual({ style: "dark club, 124 BPM, elastic sub-bass", dropped: 0 });
  });

  it("drops whole clauses from the end, never mid-clause, to fit 1,000", () => {
    const clauses = Array.from({ length: 60 }, (_, i) => `clause number ${i} with some words`);
    const { style, dropped } = fitStyle(clauses.join(", "));
    expect(charCount(style)).toBeLessThanOrEqual(STYLE_LIMIT);
    expect(dropped).toBeGreaterThan(0);
    expect(style.startsWith("clause number 0 with some words")).toBe(true);
    expect(style).toMatch(/clause number \d+ with some words$/);
  });

  it("handles one giant clause on a word boundary", () => {
    const { style } = fitStyle("word ".repeat(400));
    expect(charCount(style)).toBeLessThanOrEqual(STYLE_LIMIT);
    expect(style.endsWith("word")).toBe(true);
  });
});

describe("filler", () => {
  it("catches generic filler and passes production language", () => {
    expect(fillerIn("professional production, amazing vocals, high quality").length).toBeGreaterThanOrEqual(3);
    expect(fillerIn("punchy four-on-the-floor drums, elastic sub-bass, hypnotic synth motif")).toEqual([]);
  });
});

describe("intent", () => {
  it("reads the concepts in a basic idea", () => {
    expect(askedConcepts(IDEA).map((c) => c.id)).toEqual(expect.arrayContaining(["club", "dark", "rap", "sung", "hook", "surprise", "buried"]));
  });

  it("fails QC when the optimiser turns a party song into a ballad", () => {
    const plan = readPlan({}, input());
    const draft = readDraft(
      { style: "tender piano ballad, 70 BPM, soft strings, breathy lead vocal", optimizedPrompt: "a sad ballad", arrangement: [] },
      input(),
    );
    const intent = runQc(input(), plan, draft).find((c) => c.id === "intent")!;
    expect(intent.pass).toBe(false);
    expect(intent.fix).toMatch(/club/);
  });
});

describe("lyrics", () => {
  it("strips production notes the engine would sing", () => {
    expect(tidyLyrics("[Verse]\nI walk in\n(beat drops)\nProduction: add reverb\nthey look")).toBe("[Verse]\nI walk in\nthey look");
  });

  it("keeps the user's lyrics byte-for-byte in keep mode", () => {
    const mine = "[Verse]\n(beat drops) my own line\n\n\n[Chorus]\nhey";
    const draft = readDraft({ lyrics: "something the model wrote" }, input({ lyrics: mine, lyricsMode: "keep" }));
    expect(draft.lyrics).toBe(mine);
  });
});

describe("offlineProduce", () => {
  it("keeps the idea, fits the limit and says it is rule-based", () => {
    const p = offlineProduce(input());
    expect(p.engine).toBe("local");
    expect(charCount(p.style)).toBeLessThanOrEqual(STYLE_LIMIT);
    expect(p.checks.find((c) => c.id === "intent")?.pass).toBe(true);
    expect(p.checks.find((c) => c.id === "limit")?.pass).toBe(true);
    expect(p.style).toMatch(/club/i);
    expect(p.style).toMatch(/rap/i);
    expect(p.warnings[0]).toMatch(/No AI key/);
  });

  it("never touches the user's own lyrics", () => {
    const p = offlineProduce(input({ lyrics: "[Chorus]\nmine", lyricsMode: "keep" }));
    expect(p.lyrics).toBe("[Chorus]\nmine");
  });
});
