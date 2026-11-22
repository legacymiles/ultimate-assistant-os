import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_SETTINGS,
  accentOf,
  clampSettings,
  countsFor,
  filterVoices,
  matchesFilter,
  ttsBody,
  voiceByName,
} from "./settings";
import { VOICES, type PhononVoice } from "./voices";

const v = (name: string, description: string, character?: true): PhononVoice =>
  character ? { name, description, character } : { name, description };

describe("accentOf", () => {
  it("reads British out of the catalog's own words", () => {
    expect(accentOf("A sparky, attentive British English adult voice.")).toBe("british");
    expect(accentOf("Warm and clear, with an RP accent.")).toBe("british");
    expect(accentOf("Crisp, with an English accent.")).toBe("british");
  });

  it("reads American", () => {
    expect(accentOf("Modern, confident and friendly voice with a standard American accent.")).toBe(
      "american",
    );
  });

  it("says 'unstated' rather than guessing", () => {
    // The commonest case: 26 of the 37 describe only a character of voice.
    expect(accentOf("Settled, even-toned and genuinely kind, with crisp consonants.")).toBe(
      "unstated",
    );
    expect(accentOf("")).toBe("unstated");
  });

  it("does not match a word that merely contains one", () => {
    expect(accentOf("A republican-red, americana-tinged delivery")).toBe("unstated");
  });
});

describe("the real catalog", () => {
  it("has the 37 English voices", () => {
    expect(VOICES).toHaveLength(37);
  });

  it("states an accent for 11 of them and no more", () => {
    const counts = countsFor(VOICES);
    expect(counts).toMatchObject({ all: 37, british: 8, american: 3, unstated: 26, characters: 12 });
    expect(counts.british + counts.american + counts.unstated).toBe(37);
  });

  it("holds the voices the pills promise", () => {
    const british = filterVoices(VOICES, "british").map((x) => x.name);
    expect(british).toContain("Maeve");
    expect(british).toContain("Imogen");
    expect(filterVoices(VOICES, "american").map((x) => x.name)).toEqual(["Zoey", "Harper", "Russell"]);
    expect(filterVoices(VOICES, "characters").map((x) => x.name)).toContain("Grub the Ogre");
  });

  it("defaults to a voice that exists", () => {
    expect(voiceByName(DEFAULT_VOICE_SETTINGS.voice)).toBeTruthy();
  });
});

describe("filterVoices", () => {
  const list = [
    v("Maeve", "A sparky British English adult voice."),
    v("Harper", "Friendly, with a standard American accent."),
    v("Hadley", "Settled, even-toned and genuinely kind."),
    v("Grub the Ogre", "A big, good-natured ogre who lives under a bridge.", true),
  ];

  it("filters by accent", () => {
    expect(filterVoices(list, "british").map((x) => x.name)).toEqual(["Maeve"]);
    expect(filterVoices(list, "unstated").map((x) => x.name)).toEqual(["Hadley", "Grub the Ogre"]);
  });

  it("filters by character, which cuts across accent", () => {
    expect(filterVoices(list, "characters").map((x) => x.name)).toEqual(["Grub the Ogre"]);
  });

  it("searches the name and the description, case-insensitively", () => {
    expect(filterVoices(list, "all", "hadley").map((x) => x.name)).toEqual(["Hadley"]);
    expect(filterVoices(list, "all", "BRIDGE").map((x) => x.name)).toEqual(["Grub the Ogre"]);
    expect(filterVoices(list, "all", "   ")).toHaveLength(4);
  });

  it("applies the filter and the search together", () => {
    expect(filterVoices(list, "british", "harper")).toHaveLength(0);
  });

  it("keeps catalog order", () => {
    expect(filterVoices(list, "all").map((x) => x.name)).toEqual(list.map((x) => x.name));
  });
});

describe("matchesFilter", () => {
  it("puts a character voice in its accent group too", () => {
    const aldric = v("Master Aldric", "A wise old British wizard, around eighty.", true);
    expect(matchesFilter(aldric, "characters")).toBe(true);
    expect(matchesFilter(aldric, "british")).toBe(true);
    expect(matchesFilter(aldric, "unstated")).toBe(false);
  });
});

describe("clampSettings", () => {
  it("fills everything from defaults when nothing is stored", () => {
    expect(clampSettings({})).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(clampSettings(null)).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it("drops a voice the catalog no longer has", () => {
    // Otherwise every line would fail, with nothing on screen to explain it.
    expect(clampSettings({ voice: "Gandalf" }).voice).toBe(DEFAULT_VOICE_SETTINGS.voice);
  });

  it("keeps a real voice, and matches it case-insensitively", () => {
    expect(clampSettings({ voice: "maeve" }).voice).toBe("Maeve");
  });

  it("clamps the dials into what the backend accepts", () => {
    expect(clampSettings({ speed: 9 }).speed).toBe(2);
    expect(clampSettings({ speed: 0 }).speed).toBe(0.5);
    expect(clampSettings({ expression: -3 }).expression).toBe(0);
    expect(clampSettings({ expression: 50 }).expression).toBe(1);
  });

  it("survives corrupt stored values", () => {
    const bad = { speed: "fast", expression: null, consistency: "yes" } as never;
    expect(clampSettings(bad)).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(clampSettings({ speed: Number.NaN }).speed).toBe(0.5);
  });
});

describe("ttsBody", () => {
  const s = { voice: "Maeve", speed: 1.25, expression: 0.4, consistency: true };

  it("names the voice and the dials /api/tts understands", () => {
    expect(ttsBody("hello", s)).toEqual({
      text: "hello",
      voiceId: "Maeve",
      speed: 1.25,
      temperature: 0.4,
    });
  });

  it("sends no seed when consistency is locked", () => {
    // Phonon's own default seed is already fixed, so silence IS "the same
    // every time" — sending one would only look like it mattered.
    expect(ttsBody("hello", s)).not.toHaveProperty("seed");
  });

  it("sends a fresh seed when consistency is off", () => {
    const body = ttsBody("hello", { ...s, consistency: false }, () => 1234);
    expect(body.seed).toBe(1234);
  });

  it("clamps on the way out, even if state was set past the ends", () => {
    const body = ttsBody("hi", { ...s, speed: 99, expression: 99 });
    expect(body).toMatchObject({ speed: 2, temperature: 1 });
  });
});
