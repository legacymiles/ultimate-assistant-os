import { describe, expect, it } from "vitest";
import { REMIX_PRESETS, bpmFrom, describeRemix, matchPreset, offlineRemixStyle, presetById, remixSongName } from "./remix";
import type { SongPick } from "./mashup";

const pick: SongPick = {
  query: "toxic britney",
  track: { id: "1", title: "Toxic", artist: "Britney Spears", previewUrl: "p" },
};

describe("matchPreset", () => {
  it("reads the obvious ask", () => {
    expect(matchPreset("ny drill remix")?.id).toBe("ny-drill");
    expect(matchPreset("make it a Jersey club remix")?.id).toBe("jersey");
    expect(matchPreset("amapiano please")?.id).toBe("amapiano");
  });

  it("does not let a short alias swallow a longer one", () => {
    // "uk drill" contains "drill", and the two are different tempos.
    expect(matchPreset("uk drill remix")?.id).toBe("uk-drill");
    expect(matchPreset("drill remix")?.id).toBe("ny-drill");
  });

  it("survives punctuation and case", () => {
    expect(matchPreset("SLOWED + REVERB, please!")?.id).toBe("slowed");
    expect(matchPreset("drum & bass")?.id).toBe("dnb");
  });

  it("returns nothing for a direction it does not know", () => {
    expect(matchPreset("make it sound like a haunted carousel")).toBeUndefined();
    expect(matchPreset("")).toBeUndefined();
  });

  it("does not match a word inside another word", () => {
    expect(matchPreset("housewarming song")).toBeUndefined();
  });
});

describe("the presets themselves", () => {
  it("every one names a real tempo and a real arrangement", () => {
    for (const preset of REMIX_PRESETS) {
      expect(preset.bpm, preset.id).toBeGreaterThan(60);
      expect(preset.bpm, preset.id).toBeLessThan(200);
      // A genre tag alone is what this file exists to avoid.
      expect(preset.style.split(",").length, preset.id).toBeGreaterThan(2);
      expect(presetById(preset.id)).toBe(preset);
    }
  });

  it("has unique ids", () => {
    expect(new Set(REMIX_PRESETS.map((p) => p.id)).size).toBe(REMIX_PRESETS.length);
  });
});

describe("bpmFrom", () => {
  it("takes a BPM the user typed", () => {
    expect(bpmFrom("drill remix at 140bpm")).toBe(140);
    expect(bpmFrom("90 BPM, slower")).toBe(90);
  });

  it("ignores a number that is not a tempo", () => {
    expect(bpmFrom("2 verses")).toBeUndefined();
    expect(bpmFrom("900 bpm")).toBeUndefined();
    expect(bpmFrom("")).toBeUndefined();
  });
});

describe("describeRemix", () => {
  it("says the melody survives and the recording does not", () => {
    const lines = describeRemix({ pick, prompt: "ny drill remix", keepLyrics: true, hasScore: true }).join("\n");
    expect(lines).toContain("Toxic — Britney Spears");
    expect(lines).toContain("NY drill");
    expect(lines).toContain("140 BPM");
    expect(lines).toMatch(/Nothing of the original recording/);
  });

  it("admits when there is no score yet rather than implying one", () => {
    const lines = describeRemix({ pick, prompt: "house remix", keepLyrics: false, hasScore: false }).join("\n");
    expect(lines).toMatch(/once it has been transcribed/);
    expect(lines).toContain("New words");
  });

  it("uses an explicit BPM over the preset default", () => {
    const lines = describeRemix({ pick, prompt: "house remix at 100 bpm", keepLyrics: true, hasScore: true }).join("\n");
    expect(lines).toContain("100 BPM");
    expect(lines).not.toContain("124 BPM");
  });

  it("asks for a direction when none was given", () => {
    const lines = describeRemix({ pick, prompt: "   ", keepLyrics: true, hasScore: true }).join("\n");
    expect(lines).toMatch(/No direction given yet/);
  });
});

describe("offlineRemixStyle", () => {
  it("expands a known ask into an arrangement", () => {
    const style = offlineRemixStyle("ny drill remix");
    expect(style).toMatch(/808/);
    expect(style).toMatch(/140 BPM/);
  });

  it("falls back to the user's own words, never to invented ones", () => {
    expect(offlineRemixStyle("sounds like a haunted carousel")).toBe("sounds like a haunted carousel");
  });

  it("honours an explicit BPM", () => {
    expect(offlineRemixStyle("house remix", 118)).toMatch(/118 BPM/);
  });
});

describe("remixSongName", () => {
  it("prefers the catalogue record, then the file, then the query", () => {
    expect(remixSongName(pick)).toBe("Toxic — Britney Spears");
    expect(remixSongName({ query: "q", fileName: "mine.mp3" })).toBe("mine.mp3");
    expect(remixSongName({ query: "q" })).toBe("q");
    expect(remixSongName(undefined)).toBe("the original");
  });
});
