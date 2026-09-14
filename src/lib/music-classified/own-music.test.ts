import { describe, expect, it } from "vitest";
import { listenPrompt } from "./classify";
import { artistsOf, inScope, scopeKey } from "./query";
import type { Song } from "./types";
import { bytesToBase64, encodeWav, loudestWindow, resampleLinear, titleFromFile } from "./wav";

const song = (over: Partial<Song>): Song => ({
  id: over.id ?? "s",
  title: "T",
  artist: "Nova",
  links: [],
  level: 5,
  genre: "R&B",
  subgenre: "General",
  levelReason: "",
  profile: { bpm: null, key: "", energy: null, mood: [], instruments: [], vocals: "", production: "", era: "", similarArtists: [] },
  confidence: "heard",
  tags: [],
  descriptions: {},
  notes: "",
  filedBy: "ai",
  addedAt: "2026-09-13",
  updatedAt: "2026-09-13",
  ...over,
});

describe("preparing an upload", () => {
  it("names a song from its file", () => {
    expect(titleFromFile("03 - Late Night_mix v2.wav")).toBe("Late Night mix v2");
    expect(titleFromFile("Summer.mp3")).toBe("Summer");
    expect(titleFromFile(".wav")).toBe("Untitled");
  });

  it("encodes a valid 16 kHz mono WAV", () => {
    const wav = encodeWav(new Float32Array(1600), 16000);
    const v = new DataView(wav.buffer);
    expect(wav.length).toBe(44 + 3200);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(v.getUint32(24, true)).toBe(16000);
    expect(bytesToBase64(wav.subarray(0, 4))).toBe(btoa("RIFF"));
  });

  it("resamples to the right length", () => {
    expect(resampleLinear(new Float32Array(22050), 22050, 16000).length).toBe(16000);
  });

  it("finds the loudest stretch", () => {
    const rate = 100;
    const s = new Float32Array(rate * 100);
    for (let i = 60 * rate; i < 90 * rate; i++) s[i] = 0.8; // loud from 60s to 90s
    const start = loudestWindow(s, rate, 30, 1);
    expect(start).toBeGreaterThanOrEqual(58);
    expect(start).toBeLessThanOrEqual(62);
    expect(loudestWindow(new Float32Array(10), rate, 30)).toBe(0);
  });
});

describe("browsing by artist and level", () => {
  const songs = [
    song({ id: "a", artist: "Nova", level: 7 }),
    song({ id: "b", artist: "nova ", level: 2 }),
    song({ id: "c", artist: "Kilo", level: 7 }),
  ];

  it("groups artists regardless of case", () => {
    expect(artistsOf(songs)).toEqual([
      { name: "Nova", count: 2 },
      { name: "Kilo", count: 1 },
    ]);
  });

  it("scopes by artist and level together", () => {
    expect(inScope(songs, { artist: "NOVA" }).map((s) => s.id)).toEqual(["a", "b"]);
    expect(inScope(songs, { artist: "Nova", level: 7 }).map((s) => s.id)).toEqual(["a"]);
    expect(inScope(songs, { level: 7 }).map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("keeps old library blueprint keys stable", () => {
    expect(scopeKey({})).toBe("all");
    expect(scopeKey({ level: 3, genre: "R&B" })).toBe("3/R&B");
    expect(scopeKey({ artist: "Nova" })).toBe("artist:Nova");
    expect(scopeKey({ artist: "Nova", level: 7 })).toBe("artist:Nova/7");
  });
});

describe("the listening prompt", () => {
  it("carries the artist's catalogue and says when it can't hear", () => {
    const base = { title: "Glow", artist: "Nova", tree: {}, lenses: ["producer" as const] };
    const heard = listenPrompt({ ...base, heard: true, artistSongs: [{ title: "Dusk", level: 3, genre: "R&B", subgenre: "Alt-R&B" }] });
    expect(heard).toContain('"Dusk": level 3 › R&B › Alt-R&B');
    expect(heard).toContain("Listen to it");
    expect(heard).toContain('"producer"');
    const deaf = listenPrompt({ ...base, heard: false, artistSongs: [] });
    expect(deaf).toContain("measurements only");
  });
});
