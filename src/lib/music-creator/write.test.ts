import { describe, expect, it } from "vitest";
import { offlineDraft, systemFor, userFor } from "./write";

describe("userFor", () => {
  it("sends only the fields the user actually filled in", () => {
    const prompt = userFor("lyrics", { brief: "leaving a city", genre: "dream pop", mood: "", tempo: undefined });
    expect(prompt).toContain("Brief: leaving a city");
    expect(prompt).toContain("Genre or sound: dream pop");
    expect(prompt).not.toContain("Mood");
    expect(prompt).not.toContain("Tempo");
  });

  it("never sends an empty turn", () => {
    expect(userFor("style", {}).length).toBeGreaterThan(0);
  });
});

describe("systemFor", () => {
  // The one rule that decides whether a render is usable: a production note in
  // the lyrics gets sung out loud, so the instruction must always carry it.
  it("tells every writing task that lyrics are performed literally", () => {
    for (const task of ["lyrics", "style", "hooks", "mashup", "rewrite"] as const) {
      expect(systemFor(task)).toMatch(/\[Verse\]|sung|performed/i);
    }
  });

  it("tells the vocal director that the speech model cannot sing", () => {
    expect(systemFor("vocal-direction")).toMatch(/cannot sing/i);
  });
});

describe("offlineDraft", () => {
  it("builds a style line out of the user's own words, in YuE2's field order", () => {
    const result = offlineDraft("style", {
      genre: "trip-hop",
      mood: "nocturnal",
      tempo: "88 BPM",
      vocal: "low female alto",
      language: "English",
    });
    expect(result.style).toBe("English, trip-hop, nocturnal, low female alto, 88 BPM");
  });

  it("scaffolds a lyric sheet with real section tags rather than invented words", () => {
    const result = offlineDraft("lyrics", { brief: "a drive home at 3am" }) as { lyrics: string };
    expect(result.lyrics).toContain("[Verse]");
    expect(result.lyrics).toContain("[Chorus]");
    expect(result.lyrics).toContain("a drive home at 3am");
  });

  it("leaves lyrics untouched when asked to rewrite without a model", () => {
    const original = "[Chorus]\nhold the line";
    const result = offlineDraft("rewrite", { lyrics: original, change: "make it darker" });
    expect(result.lyrics).toBe(original);
    expect(String(result.changed)).toMatch(/no AI key/i);
  });

  it("marks a hook draft as local so it cannot pass for a written one", () => {
    const result = offlineDraft("hooks", { brief: "summer ending" }) as { hooks: { label: string; why: string }[] };
    expect(result.hooks).toHaveLength(1);
    expect(result.hooks[0].label).toMatch(/local/i);
  });
});
