import { describe, expect, it } from "vitest";
import { extractUrls, parseLink, parsePaste, parseTimestamp } from "./links";
import { EMPTY, addLinks, normalize, removeVideo, restoreVideo, setMeta, toggleWatched } from "./library";
import { basicRecommendations, parseAi, queriesFor, topTerms } from "./recommend";

const ID = "dQw4w9WgXcQ";

describe("parseLink — YouTube", () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&si=abc123&feature=share`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}?si=XyZ`,
    `youtu.be/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://music.youtube.com/watch?v=${ID}&list=RD`,
  ])("%s → one key", (u) => {
    const p = parseLink(u)!;
    expect(p.platform).toBe("youtube");
    expect(p.key).toBe(`youtube:${ID}`);
    expect(p.thumb).toContain(ID);
    expect(p.embed).toContain("youtube-nocookie.com/embed/");
  });

  it("Shorts and live keep their kind and still match the same video", () => {
    expect(parseLink(`https://youtube.com/shorts/${ID}?feature=share`)).toMatchObject({ kind: "short", key: `youtube:${ID}`, url: `https://www.youtube.com/shorts/${ID}` });
    expect(parseLink(`https://www.youtube.com/live/${ID}`)).toMatchObject({ kind: "live", key: `youtube:${ID}` });
  });

  it("keeps a timestamp", () => {
    const p = parseLink(`https://youtu.be/${ID}?t=93`)!;
    expect(p.start).toBe(93);
    expect(p.url).toContain("t=93s");
    expect(p.embed).toContain("start=93");
  });

  it("a channel page still saves, as a link", () => {
    expect(parseLink("https://www.youtube.com/@mkbhd")).toMatchObject({ platform: "youtube", key: "url:https://www.youtube.com/@mkbhd" });
  });
});

describe("parseLink — social", () => {
  it("TikTok video ignores tracking", () => {
    const a = parseLink("https://www.tiktok.com/@chef/video/7301234567890123456?is_from_webapp=1&sender_device=pc")!;
    const b = parseLink("https://m.tiktok.com/@chef/video/7301234567890123456")!;
    expect(a.key).toBe("tiktok:7301234567890123456");
    expect(b.key).toBe(a.key);
    expect(a.url).toBe("https://www.tiktok.com/@chef/video/7301234567890123456");
  });
  it("TikTok short link saves by url", () => {
    expect(parseLink("https://vm.tiktok.com/ZMabc123/")).toMatchObject({ platform: "tiktok" });
  });
  it("Instagram reel and reels are the same", () => {
    expect(parseLink("https://www.instagram.com/reel/C1a2B3c4D5e/?igsh=MTIz")!.key).toBe("instagram:C1a2B3c4D5e");
    expect(parseLink("https://instagram.com/reels/C1a2B3c4D5e")!.key).toBe("instagram:C1a2B3c4D5e");
  });
  it("Facebook watch and videos match", () => {
    expect(parseLink("https://www.facebook.com/watch/?v=1234567890")!.key).toBe("facebook:1234567890");
    expect(parseLink("https://www.facebook.com/page/videos/1234567890/")!.key).toBe("facebook:1234567890");
  });
  it("X and twitter match", () => {
    expect(parseLink("https://twitter.com/nasa/status/1789012345678901234?s=20")!.key).toBe("x:1789012345678901234");
    expect(parseLink("https://x.com/nasa/status/1789012345678901234")!.key).toBe("x:1789012345678901234");
  });
  it("Vimeo gets an embed", () => {
    expect(parseLink("https://vimeo.com/76979871")).toMatchObject({ key: "vimeo:76979871", embed: "https://player.vimeo.com/video/76979871?autoplay=1" });
  });
  it("other sites save with tracking stripped", () => {
    expect(parseLink("https://example.com/watch/42?utm_source=x&id=7")).toMatchObject({ platform: "web", url: "https://example.com/watch/42?id=7" });
  });
  it("rejects things that are not web links", () => {
    expect(parseLink("hello")).toBeNull();
    expect(parseLink("javascript:alert(1)")).toBeNull();
    expect(parseLink("ftp://example.com/a")).toBeNull();
  });
});

describe("parsePaste", () => {
  it("finds every link in a sentence, once each, in order", () => {
    const text = `watch this https://youtu.be/${ID}?si=1 and https://www.youtube.com/watch?v=${ID}, also https://vimeo.com/76979871.`;
    const out = parsePaste(text);
    expect(out.map((p) => p.key)).toEqual([`youtube:${ID}`, "vimeo:76979871"]);
  });
  it("extractUrls trims trailing punctuation", () => {
    expect(extractUrls("(https://x.com/a/status/123456)!")).toEqual(["https://x.com/a/status/123456"]);
  });
});

describe("parseTimestamp", () => {
  it.each([
    ["93", 93],
    ["1m33s", 93],
    ["1h", 3600],
    ["1:33", 93],
    ["1:00:05", 3605],
    ["", undefined],
    ["abc", undefined],
  ])("%s → %s", (a, b) => expect(parseTimestamp(a)).toBe(b));
});

describe("library", () => {
  const yt = parseLink(`https://youtu.be/${ID}`)!;
  const vm = parseLink("https://vimeo.com/76979871")!;

  it("newest first, first-pasted on top", () => {
    const r = addLinks(EMPTY, [yt, vm], 1000);
    expect(r.added).toHaveLength(2);
    expect(r.library.videos.map((v) => v.key)).toEqual([yt.key, vm.key]);
  });

  it("no duplicates: pasting again moves it to the top", () => {
    const first = addLinks(EMPTY, [yt], 1000).library;
    const second = addLinks(first, [vm], 2000).library;
    const again = addLinks(second, [yt], 3000);
    expect(again.added).toEqual([]);
    expect(again.bumped).toHaveLength(1);
    expect(again.library.videos).toHaveLength(2);
    expect(again.library.videos[0].key).toBe(yt.key);
  });

  it("delete and undo", () => {
    const lib = addLinks(EMPTY, [yt, vm], 1000).library;
    const { library, removed } = removeVideo(lib, lib.videos[0].id);
    expect(library.videos).toHaveLength(1);
    expect(restoreVideo(library, removed!).videos.map((v) => v.key)).toEqual([yt.key, vm.key]);
  });

  it("meta fills in, watched toggles", () => {
    const lib = addLinks(EMPTY, [vm], 1000).library;
    const id = lib.videos[0].id;
    const m = setMeta(lib, id, { title: " Hello ", author: "Ch", thumb: "t.jpg" });
    expect(m.videos[0]).toMatchObject({ title: "Hello", author: "Ch", thumb: "t.jpg", looked: true });
    expect(toggleWatched(m, id, 5).videos[0].watchedAt).toBe(5);
    expect(toggleWatched(toggleWatched(m, id, 5), id).videos[0].watchedAt).toBeUndefined();
  });

  it("normalize survives junk", () => {
    expect(normalize(null)).toEqual(EMPTY);
    expect(normalize({ videos: [1, { id: "a" }, { id: "b", key: "k", url: "u", addedAt: 2 }, { id: "c", key: "k", url: "u" }] }).videos.map((v) => v.id)).toEqual(["b"]);
  });
});

describe("recommendations", () => {
  const taste = [
    { title: "Sourdough bread for beginners", author: "Bake Lab", platform: "youtube" },
    { title: "Perfect sourdough crumb explained", author: "Bake Lab", platform: "youtube" },
    { title: "Easy focaccia bread", author: "Joshua", platform: "tiktok" },
  ];
  it("reads taste from repeated words", () => {
    expect(topTerms(taste).slice(0, 2)).toEqual(["bread", "sourdough"]);
  });
  it("basic picks are never empty when something is saved, and are searches", () => {
    const b = basicRecommendations(taste);
    expect(b.length).toBeGreaterThan(1);
    expect(b[0]).toMatchObject({ title: "More from Bake Lab", type: "search" });
    expect(b.every((r) => r.url.startsWith("https://www.youtube.com/results?search_query="))).toBe(true);
  });
  it("queries for the YouTube API", () => {
    const q = queriesFor(taste);
    expect(q.length).toBeGreaterThan(0);
    expect(q.length).toBeLessThanOrEqual(3);
  });
  it("parses the model's JSON, ignores junk", () => {
    const r = parseAi('Sure! {"items":[{"title":"Laminated dough","query":"croissant lamination","reason":"next step after sourdough"},{"nope":1}]}');
    expect(r).toHaveLength(1);
    expect(r[0].url).toContain("croissant%20lamination");
    expect(parseAi("no json here")).toEqual([]);
  });
});
