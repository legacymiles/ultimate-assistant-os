import { describe, expect, it } from "vitest";
import {
  appleTrackId,
  cleanVideoTitle,
  linkSource,
  matchScore,
  parseAppleOgTitle,
  parseSongInput,
  parseSpotifyDescription,
  parseSpotifyEmbed,
  rankMatches,
  spotifyTrackId,
} from "./identify";
import { bpmLevel, coerceDraft, heuristicDraft, reconcileBpm, snapGenre } from "./classify";
import type { Identity } from "./identify";

const WEEKND = { trackName: "Blinding Lights", artistName: "The Weeknd", kind: "song" };

describe("parsing input", () => {
  it("recognises each link source and plain names", () => {
    expect(parseSongInput("check this https://youtu.be/4NRXx6U8ABQ ok")).toMatchObject({ kind: "link", source: "youtube" });
    expect(linkSource(new URL("https://music.apple.com/us/album/x/1488408555?i=1488408568"))).toBe("apple");
    expect(linkSource(new URL("https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b"))).toBe("spotify");
    expect(parseSongInput("blinding lights weeknd")).toEqual({ kind: "name", query: "blinding lights weeknd" });
  });

  it("finds Apple track ids on album and song links", () => {
    expect(appleTrackId(new URL("https://music.apple.com/us/album/blinding-lights/1488408555?i=1488408568"))).toBe("1488408568");
    expect(appleTrackId(new URL("https://music.apple.com/us/song/blinding-lights/1488408568"))).toBe("1488408568");
    expect(appleTrackId(new URL("https://music.apple.com/us/album/after-hours/1499378108"))).toBeNull();
  });

  it("cleans YouTube titles", () => {
    expect(cleanVideoTitle("The Weeknd - Blinding Lights (Official Video)", "TheWeekndVEVO")).toEqual({
      artist: "The Weeknd",
      title: "Blinding Lights",
    });
    expect(cleanVideoTitle("Snooze [Official Audio]", "SZA - Topic")).toEqual({ title: "Snooze", artist: "SZA" });
  });

  it("reads Apple and Spotify meta", () => {
    expect(parseAppleOgTitle("Blinding Lights by The Weeknd on Apple Music")).toEqual({
      title: "Blinding Lights",
      artist: "The Weeknd",
    });
    expect(parseSpotifyDescription("The Weeknd · After Hours · Song · 2020")).toEqual({ artist: "The Weeknd", year: "2020" });
  });

  it("reads Spotify's embed page, where the track metadata actually lives", () => {
    expect(spotifyTrackId(new URL("https://open.spotify.com/intl-de/track/0VjIjW4GlUZAMYd2vXMi3b?si=x"))).toBe(
      "0VjIjW4GlUZAMYd2vXMi3b",
    );
    const html = `…"type":"track","name":"Kill Bill","title":"Kill Bill","artists":[{"name":"SZA","uri":"spotify:artist:7tYKF4w9nC0nq9CsPZTHyP"}]…`;
    expect(parseSpotifyEmbed(html)).toEqual({ title: "Kill Bill", artist: "SZA" });
    expect(parseSpotifyEmbed(`"title":"Say \\"Yes\\""`)).toEqual({ title: 'Say "Yes"', artist: "" });
  });
});

describe("catalogue matching", () => {
  it("prefers the original over a remix nobody asked for", () => {
    const want = { title: "blinding lights weeknd", artist: "" };
    const ranked = rankMatches(
      [{ trackName: "Blinding Lights (Remix)", artistName: "The Weeknd & ROSALÍA", kind: "song" }, WEEKND],
      want,
    );
    expect(ranked[0].r.trackName).toBe("Blinding Lights");
  });

  it("does not match a one-word title against a longer query", () => {
    expect(matchScore({ trackName: "Love", artistName: "Someone" }, { title: "blinding lights weeknd", artist: "" })).toBeLessThan(0.55);
  });
});

describe("filing", () => {
  const identity: Identity = { title: "Snooze", artist: "SZA", sourceGenre: "R&B/Soul", matched: true };
  const tree = { 3: { "R&B": ["Alt-R&B"] } };

  it("snaps names onto playlists the library already has", () => {
    expect(snapGenre(tree, "r&b", "alt r&b")).toEqual({ genre: "R&B", subgenre: "Alt-R&B" });
    expect(snapGenre(tree, "house", "")).toEqual({ genre: "House", subgenre: "General" });
  });

  it("coerces model output and keeps only asked-for lenses", () => {
    const draft = coerceDraft(
      {
        level: 14,
        genre: "RnB",
        subgenre: "alt-r&b",
        confidence: "known",
        profile: { bpm: "143", mood: ["yearning", "yearning"], instruments: ["guitar"] },
        descriptions: { producer: "Soft guitar loop.", dj: "not asked" },
        tags: ["Falsetto"],
      },
      { identity, tree, lenses: ["producer"] },
    );
    expect(draft.level).toBe(10);
    expect(draft.genre).toBe("R&B");
    expect(draft.profile.mood).toEqual(["yearning"]);
    expect(draft.descriptions).toEqual({ producer: "Soft guitar loop." });
    expect(draft.tags).toEqual(["falsetto"]);
  });

  it("trusts the model's BPM only when it corrects a half/double-time error", () => {
    expect(reconcileBpm(72, 144)).toBe(144);
    expect(reconcileBpm(120, 100)).toBe(120);
    expect(reconcileBpm(undefined, 90)).toBe(90);
  });

  it("files offline from the store genre and tempo", () => {
    expect(bpmLevel(60)).toBe(1);
    expect(bpmLevel(122)).toBe(7);
    const d = heuristicDraft({ identity, tree, lenses: [] });
    expect(d).toMatchObject({ level: 3, genre: "R&B", filedBy: "offline", confidence: "guess" });
  });
});
