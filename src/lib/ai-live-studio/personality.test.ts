import { describe, expect, it } from "vitest";
import { VOICES } from "@/lib/voice-settings/voices";
import {
  DEFAULT_SETTINGS,
  PRESETS,
  applyPreset,
  fillersFor,
  idleMsFor,
  sanitizeSettings,
  systemPrompt,
  temperatureFor,
  withChange,
} from "./personality";

describe("presets", () => {
  it("offers the five presets the brief asked for", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["funny", "friendly", "charismatic", "chill", "host"]);
  });

  it("only ever names voices Phonon actually has", () => {
    const names = new Set(VOICES.map((v) => v.name));
    for (const p of PRESETS) expect(names.has(p.values.voice)).toBe(true);
  });

  it("applies every value of a preset and records which one", () => {
    const s = applyPreset(DEFAULT_SETTINGS, "host");
    expect(s.energy).toBe(10);
    expect(s.preset).toBe("host");
    expect(s.name).toBe(DEFAULT_SETTINGS.name);
  });
});

describe("withChange", () => {
  it("marks the preset custom when a governed field changes", () => {
    expect(withChange(DEFAULT_SETTINGS, { humor: 1 }).preset).toBe("custom");
  });

  it("keeps the preset when only the name changes", () => {
    expect(withChange(DEFAULT_SETTINGS, { name: "Sam" }).preset).toBe(DEFAULT_SETTINGS.preset);
  });
});

describe("sanitizeSettings", () => {
  it("falls back to defaults for garbage", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings("x")).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps every number into range", () => {
    const s = sanitizeSettings({ humor: 99, energy: -4, speed: 9, frequency: 0, interaction: 3.6 });
    expect([s.humor, s.energy, s.speed, s.frequency, s.interaction]).toEqual([10, 0, 1.3, 3, 4]);
  });

  it("rejects an unknown voice and a hostile handle", () => {
    const s = sanitizeSettings({ voice: "NotAVoice", tiktokHandle: "<script>", avatarId: "../../etc" });
    expect(s.voice).toBe(DEFAULT_SETTINGS.voice);
    expect(s.tiktokHandle).toBe("");
    expect(s.avatarId).toBe(DEFAULT_SETTINGS.avatarId);
  });

  it("strips the @ from a handle", () => {
    expect(sanitizeSettings({ tiktokHandle: "@my.stream" }).tiktokHandle).toBe("my.stream");
  });

  it("dedupes, lowercases and caps the blocklist", () => {
    const s = sanitizeSettings({ blocklist: ["Bad", "bad ", 4, "", "x".repeat(90)] });
    expect(s.blocklist).toEqual(["bad", "x".repeat(40)]);
  });

  it("keeps the name sayable", () => {
    expect(sanitizeSettings({ name: "<b>Alex</b>" }).name).toBe("bAlexb");
    expect(sanitizeSettings({ name: "%%%" }).name).toBe("Alex");
  });
});

describe("behaviour from sliders", () => {
  it("fills silences sooner as interaction rises", () => {
    expect(idleMsFor(0)).toBe(45_000);
    expect(idleMsFor(10)).toBe(12_000);
    expect(idleMsFor(10)).toBeLessThan(idleMsFor(5));
  });

  it("loosens sampling as humour rises, within bounds", () => {
    expect(temperatureFor({ humor: 0, energy: 0 })).toBe(0.5);
    expect(temperatureFor({ humor: 10, energy: 10 })).toBe(1);
  });

  it("writes a prompt that names the character and stays honest about being AI", () => {
    const p = systemPrompt({ ...DEFAULT_SETTINGS, name: "Sam" });
    expect(p).toContain("You are Sam");
    expect(p).toMatch(/say yes honestly/);
    expect(p).toMatch(/JSON/);
  });

  it("matches filler to energy and puts the name in", () => {
    expect(fillersFor({ name: "Sam", energy: 9 }).join(" ")).toContain("Sam");
    expect(fillersFor({ name: "Sam", energy: 9 })).not.toEqual(fillersFor({ name: "Sam", energy: 2 }));
  });
});
