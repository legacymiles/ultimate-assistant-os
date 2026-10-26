import { describe, expect, it } from "vitest";

import { connectSiteFor, isStuck, mergeRetry, retryAfterConnect, stuckNote, uploadProblem, uploadType, withUpload } from "./stuck";
import type { Clip, ResolvedLink } from "./types";

const clip = (over: Partial<Clip> = {}): Clip => ({
  id: "c1",
  tab: "dances",
  url: "https://www.facebook.com/reel/123456789",
  platform: "facebook",
  title: "",
  author: "",
  play: { kind: "none" },
  note: "Facebook only shows this video to signed-in people. Connect Facebook once, or upload the video.",
  needsLogin: true,
  addedAt: "2026-10-25T20:00:00.000Z",
  ...over,
});

describe("stuckNote", () => {
  it("a login wall says connect or upload — short, the buttons do the rest", () => {
    expect(stuckNote("Facebook", true, "x", false, true)).toBe("Facebook only shows this video to signed-in people. Connect Facebook once, or upload the video.");
  });
  it("other failures point at upload", () => {
    expect(stuckNote("Facebook", true, "x", false, false)).toMatch(/Upload it/);
  });
  it("signed out says sign in", () => {
    expect(stuckNote("Instagram", true, "", true, false)).toMatch(/Sign in/);
  });
  it("an embed that plays needs no note unless the file failed", () => {
    expect(stuckNote("TikTok", false, "", false, false)).toBeUndefined();
    expect(stuckNote("TikTok", false, "nope", false, false)).toMatch(/player/);
  });
});

describe("which fixes a tile offers", () => {
  it("only a tile with nothing to play is stuck", () => {
    expect(isStuck(clip())).toBe(true);
    expect(isStuck(clip({ play: { kind: "file", key: "u/clips/abc123.mp4" } }))).toBe(false);
  });
  it("Connect only for Facebook and Instagram", () => {
    expect(connectSiteFor(clip())).toBe("facebook");
    expect(connectSiteFor(clip({ platform: "instagram" }))).toBe("instagram");
    expect(connectSiteFor(clip({ platform: "x" }))).toBeNull();
    expect(connectSiteFor(clip({ play: { kind: "tiktok", ref: "1" } }))).toBeNull();
  });
  it("after connecting, only that site's stuck clips are asked for again", () => {
    const all = [clip(), clip({ id: "c2", platform: "instagram" }), clip({ id: "c3", play: { kind: "file", key: "k" } })];
    expect(retryAfterConnect(all, "facebook").map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("mergeRetry", () => {
  const fresh = (over: Partial<ResolvedLink> = {}): ResolvedLink => ({
    url: "https://www.facebook.com/reel/123456789",
    platform: "facebook",
    title: "Fresh title",
    author: "poster",
    play: { kind: "file", key: "u/clips/abc123.mp4" },
    ...over,
  });
  it("a retry that still can't play changes nothing", () => {
    expect(mergeRetry(clip(), fresh({ play: { kind: "none" } }))).toBeNull();
  });
  it("swaps the video in, clears the note and the login flag", () => {
    const next = mergeRetry(clip(), fresh())!;
    expect(next.play).toEqual({ kind: "file", key: "u/clips/abc123.mp4" });
    expect(next.note).toBeUndefined();
    expect(next.needsLogin).toBeUndefined();
    expect(next.title).toBe("Fresh title");
    expect(next.id).toBe("c1");
  });
  it("keeps what the owner set", () => {
    const tags = { moods: ["Hype"], categories: [], byHand: true };
    const next = mergeRetry(clip({ title: "Mine", tags }), fresh({ tags: { moods: ["Chill"], categories: [] } }))!;
    expect(next.title).toBe("Mine");
    expect(next.tags).toBe(tags);
  });
});

describe("uploads", () => {
  it("withUpload plays the file and clears the stuck state", () => {
    const next = withUpload(clip(), "u/clips/abcdef.mov", true);
    expect(next.play).toEqual({ kind: "file", key: "u/clips/abcdef.mov" });
    expect(next.vertical).toBe(true);
    expect(next.note).toBeUndefined();
    expect(next.needsLogin).toBeUndefined();
  });
  it("accepts phone videos, even when the phone reports no type", () => {
    expect(uploadType({ type: "video/quicktime" })).toBe("video/quicktime");
    expect(uploadType({ type: "", name: "IMG_0042.MOV" })).toBe("video/quicktime");
    expect(uploadType({ type: "video/x-m4v" })).toBe("video/mp4");
    expect(uploadType({ type: "image/jpeg", name: "a.jpg" })).toBeNull();
  });
  it("says why a file can't go", () => {
    expect(uploadProblem({ type: "image/png", size: 10 })).toMatch(/video file/);
    expect(uploadProblem({ type: "video/mp4", size: 0 })).toMatch(/empty/);
    expect(uploadProblem({ type: "video/mp4", size: 600 * 1024 * 1024 })).toMatch(/over/);
    expect(uploadProblem({ type: "video/mp4", size: 5_000_000 })).toBeNull();
  });
});
