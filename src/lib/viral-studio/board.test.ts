import { describe, expect, it } from "vitest";

import {
  addClip,
  countsByTab,
  extractLinks,
  findDuplicate,
  guessVertical,
  linkKey,
  offlinePlayback,
  removeClip,
  restoreClip,
  sanitize,
  storedKeys,
} from "./board";
import { embedUrl, playbackLimit, posterUrl } from "./playback";
import type { Board, Clip } from "./types";

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: over.id ?? `c${Math.random().toString(36).slice(2, 8)}`,
    tab: "fights",
    url: "https://www.tiktok.com/@a/video/7400000000000000001",
    platform: "tiktok",
    title: "",
    author: "",
    play: { kind: "tiktok", ref: "7400000000000000001" },
    addedAt: "2026-10-19T00:00:00Z",
    ...over,
  };
}

describe("extractLinks", () => {
  it("pulls every link out of share text, cleaned and de-duplicated", () => {
    const text = `check this https://www.tiktok.com/@x/video/123456789?is_from_webapp=1, and
https://youtu.be/dQw4w9WgXcQ  and again https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=4`;
    expect(extractLinks(text)).toEqual([
      "https://www.tiktok.com/@x/video/123456789?is_from_webapp=1",
      "https://youtu.be/dQw4w9WgXcQ",
    ]);
  });

  it("accepts a scheme-less social link", () => {
    expect(extractLinks("instagram.com/reel/Cabc123/")).toEqual(["https://instagram.com/reel/Cabc123/"]);
  });

  it("returns nothing for plain words", () => {
    expect(extractLinks("no links here")).toEqual([]);
  });
});

describe("linkKey", () => {
  it("treats tracking junk and prefixes as the same post", () => {
    expect(linkKey("https://www.instagram.com/reel/Cabc123/?igsh=zz")).toBe(linkKey("https://instagram.com/reels/Cabc123"));
    expect(linkKey("https://m.youtube.com/shorts/dQw4w9WgXcQ")).toBe("youtube:dQw4w9WgXcQ");
    expect(linkKey("https://www.tiktok.com/@a/video/123456789?lang=en")).toBe("tiktok:123456789");
  });

  it("rejects non-links", () => {
    expect(linkKey("ftp://x")).toBeNull();
    expect(linkKey("hello")).toBeNull();
  });
});

describe("board", () => {
  it("adds newest first", () => {
    const a = clip({ id: "a", play: { kind: "youtube", ref: "aaaaaaaaaaa" }, url: "https://youtu.be/aaaaaaaaaaa" });
    const b = clip({ id: "b" });
    const board = addClip(addClip({ clips: [] }, a), b);
    expect(board.clips.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("refuses the same video twice in one tab but allows it in another tab", () => {
    const first = addClip({ clips: [] }, clip({ id: "a" }));
    const again = addClip(first, clip({ id: "b", url: "https://tiktok.com/@a/video/7400000000000000001?x=1" }));
    expect(again).toBe(first);
    const other = addClip(first, clip({ id: "c", tab: "dances" }));
    expect(other.clips).toHaveLength(2);
  });

  it("matches a downloaded clip to a re-paste of the same link", () => {
    const board: Board = { clips: [clip({ id: "a", play: { kind: "file", key: "u/clips/x.mp4" } })] };
    expect(findDuplicate(board, "fights", { url: "https://tiktok.com/@a/video/7400000000000000001", play: { kind: "none" } })?.id).toBe("a");
  });

  it("delete then undo puts the clip back where it was", () => {
    const board: Board = { clips: [clip({ id: "a" }), clip({ id: "b", tab: "audio" }), clip({ id: "c", tab: "motion" })] };
    const { board: after, removed, index } = removeClip(board, "b");
    expect(after.clips.map((c) => c.id)).toEqual(["a", "c"]);
    expect(restoreClip(after, removed!, index).clips.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("removing an unknown id changes nothing", () => {
    const board: Board = { clips: [clip({ id: "a" })] };
    expect(removeClip(board, "zz").board).toBe(board);
  });

  it("counts per tab", () => {
    const board: Board = { clips: [clip({ tab: "audio" }), clip({ tab: "audio" }), clip({ tab: "motion" })] };
    expect(countsByTab(board)).toEqual({ audio: 2, fights: 0, dances: 0, motion: 1 });
  });

  it("knows which stored files a clip owns", () => {
    expect(storedKeys(clip({ play: { kind: "file", key: "k1", posterKey: "k2" } }))).toEqual(["k1", "k2"]);
    expect(storedKeys(clip())).toEqual([]);
  });

  it("sanitize drops malformed rows and duplicates instead of crashing", () => {
    const raw = { clips: [clip({ id: "a" }), { id: "x" }, clip({ id: "a" }), clip({ id: "b", tab: "nope" as never }), null] };
    expect(sanitize(raw).clips.map((c) => c.id)).toEqual(["a"]);
    expect(sanitize(null)).toEqual({ clips: [] });
  });
});

describe("playback", () => {
  it("falls back to an embed when the server can't be reached", () => {
    expect(offlinePlayback("https://youtube.com/shorts/dQw4w9WgXcQ")).toEqual({ kind: "youtube", ref: "dQw4w9WgXcQ" });
    expect(offlinePlayback("https://www.tiktok.com/@a/video/123456789")).toEqual({ kind: "tiktok", ref: "123456789" });
    expect(offlinePlayback("https://instagram.com/p/Cabc123")).toEqual({ kind: "instagram", ref: "Cabc123" });
    expect(offlinePlayback("https://example.com/x")).toEqual({ kind: "none" });
  });

  it("builds muted autoplay embeds, unmuted when sound is on", () => {
    const yt = embedUrl({ play: { kind: "youtube", ref: "dQw4w9WgXcQ" } }, false)!;
    expect(yt).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(yt).toContain("mute=1");
    expect(yt).toContain("playlist=dQw4w9WgXcQ");
    const tt = embedUrl({ play: { kind: "tiktok", ref: "123456789" } }, true)!;
    expect(tt).toContain("tiktok.com/player/v1/123456789");
    expect(tt).toContain("muted=0");
    expect(tt).toContain("autoplay=1");
    expect(embedUrl({ play: { kind: "file", key: "k" } }, false)).toBeNull();
  });

  it("posters are always same-origin, so the reveal can read them", () => {
    expect(posterUrl({ url: "x", play: { kind: "file", key: "k", posterKey: "u/posters/p.jpg" } })).toBe(
      "/api/viral-studio/media?key=u%2Fposters%2Fp.jpg",
    );
    expect(posterUrl({ url: "x", play: { kind: "file", key: "k" } })).toBeNull();
    expect(posterUrl({ url: "x", play: { kind: "youtube", ref: "dQw4w9WgXcQ" } })).toBe("/api/viral-studio/poster?yt=dQw4w9WgXcQ");
    expect(posterUrl({ url: "https://tiktok.com/v", play: { kind: "tiktok", ref: "1" } })).toBe(
      "/api/viral-studio/poster?u=https%3A%2F%2Ftiktok.com%2Fv",
    );
  });

  it("says when a tile can't play inline", () => {
    expect(playbackLimit({ play: { kind: "none" } })).toMatch(/original site/);
    expect(guessVertical("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(guessVertical("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe(true);
    expect(guessVertical("https://www.tiktok.com/@a/video/1234567")).toBe(true);
    expect(playbackLimit({ play: { kind: "youtube", ref: "x" } })).toBeNull();
  });
});
