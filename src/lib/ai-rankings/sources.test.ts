import { describe, expect, it } from "vitest";
import {
  ARENA_DISCOVER_TOP,
  SOURCES,
  categoriesWithoutFeed,
  discoveriesFrom,
  fromAaEntries,
  fromAaLlmEntries,
  nameKey,
} from "./sources";
import { modelFromInbox } from "./boardActions";
import { EMPTY_BOARD } from "./leaderboard";
import type { InboxItem, Model, PublicBoard } from "./leaderboard";

const NOW = new Date("2026-11-18T09:00:00Z").getTime();

function model(p: Partial<Model> & Pick<Model, "id" | "name">): Model {
  return {
    maker: "Lab",
    category: "image",
    url: `https://example.com/${p.id}`,
    summary: "",
    releasedAt: "2026-06-01",
    addedAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    openSource: false,
    runsLocally: false,
    access: "paid",
    features: [],
    tags: [],
    ...p,
  };
}

const board = (p: Partial<PublicBoard> = {}): PublicBoard => ({ ...EMPTY_BOARD, ...p });
const arena = (name: string, maker = "Google", slug?: string) => ({ name, maker, slug });

describe("the published source list", () => {
  it("says what every source covers, and where to check it", () => {
    expect(SOURCES.length).toBeGreaterThan(3);
    for (const s of SOURCES) {
      expect(s.name).toBeTruthy();
      expect(s.what.length, `${s.id} doesn't say what it is for`).toBeGreaterThan(10);
      expect(s.covers.length, `${s.id} doesn't say what it can see`).toBeGreaterThan(10);
      expect(s.cadence).toBeTruthy();
      if (s.url) expect(s.url).toMatch(/^https:\/\//);
    }
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length);
  });

  it("has at least one feed that finds releases every day", () => {
    expect(SOURCES.some((s) => s.kind === "releases" && s.cadence === "Every day")).toBe(true);
  });

  it("names the categories no feed covers instead of letting them look quiet", () => {
    const none = categoriesWithoutFeed();
    expect(none).toContain("Coding agents");
    expect(none).toContain("Lipsync and avatars");
    expect(none).not.toContain("Image");
  });
});

describe("discovering models from an arena", () => {
  it("suggests an entry the board has never heard of", () => {
    const found = discoveriesFrom([arena("Veo 4", "Google", "veo-4")], "text-to-video", "https://aa.ai/x", board(), NOW, new Set());
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      hfId: "aa:veo-4",
      name: "Veo 4",
      maker: "Google",
      category: "text-to-video",
      source: "aa",
      pipeline: "arena",
      // An arena says nothing about when a model shipped.
      releasedAt: "",
      url: "https://artificialanalysis.ai/models/veo-4",
    });
  });

  it("falls back to the board's own page when an entry has no slug", () => {
    const found = discoveriesFrom([arena("Veo 4")], "text-to-video", "https://aa.ai/video", board(), NOW, new Set());
    expect(found[0].url).toBe("https://aa.ai/video");
    expect(found[0].hfId).toBe("aa:veo-4");
  });

  it("skips what is already on the board, however it is spelled", () => {
    const b = board({ models: [model({ id: "v", name: "Veo 4" })] });
    expect(discoveriesFrom([arena("veo 4"), arena("VEO-4")], "image", "u", b, NOW, new Set())).toEqual([]);
  });

  it("skips what is waiting in the inbox or was dismissed before", () => {
    const waiting: InboxItem = {
      id: "aa:veo-4",
      hfId: "aa:veo-4",
      name: "Veo 4",
      maker: "Google",
      category: "text-to-video",
      url: "u",
      releasedAt: "",
      likes: 0,
      downloads: 0,
      pipeline: "arena",
      foundAt: "2026-11-17T00:00:00Z",
    };
    expect(discoveriesFrom([arena("Veo 4", "Google", "veo-4")], "text-to-video", "u", board({ inbox: [waiting] }), NOW, new Set())).toEqual([]);
    expect(
      discoveriesFrom([arena("Veo 4", "Google", "veo-4")], "text-to-video", "u", board({ dismissed: ["aa:veo-4"] }), NOW, new Set()),
    ).toEqual([]);
  });

  it("suggests a model found by two feeds in one run only once", () => {
    // The trending feed already found it, so its name is in `seen`.
    const seen = new Set([nameKey("Qwen-Image 2.1")]);
    expect(discoveriesFrom([arena("Qwen-Image 2.1")], "image", "u", board(), NOW, seen)).toEqual([]);
    // And twice from two arenas in the same run.
    const fresh = new Set<string>();
    expect(discoveriesFrom([arena("Seedance 2.5")], "text-to-video", "u", board(), NOW, fresh)).toHaveLength(1);
    expect(discoveriesFrom([arena("Seedance 2.5")], "image-to-video", "u", board(), NOW, fresh)).toEqual([]);
  });

  it("ignores a nameless entry", () => {
    expect(discoveriesFrom([arena("  ")], "image", "u", board(), NOW, new Set())).toEqual([]);
  });

  it("reads both endpoint shapes into the same thing", () => {
    expect(fromAaEntries([{ name: "A", slug: "a", model_creator: { name: "Lab" }, elo: 1 }])).toEqual([
      { name: "A", maker: "Lab", slug: "a" },
    ]);
    expect(fromAaLlmEntries([{ slug: "b", model_creator: null }])).toEqual([{ name: "b", maker: "", slug: "b" }]);
    expect(fromAaEntries([{ model_creator: null }])).toEqual([]);
  });

  it("keeps the suggested run short enough to read", () => {
    expect(ARENA_DISCOVER_TOP).toBeLessThanOrEqual(40);
  });
});

describe("what an approved arena find becomes", () => {
  const item = (p: Partial<InboxItem> = {}): InboxItem => ({
    id: "aa:veo-4",
    hfId: "aa:veo-4",
    name: "Veo 4",
    maker: "Google",
    category: "text-to-video",
    url: "https://artificialanalysis.ai/models/veo-4",
    releasedAt: "",
    likes: 0,
    downloads: 0,
    pipeline: "arena",
    source: "aa",
    foundAt: "2026-11-18T00:00:00Z",
    ...p,
  });

  it("assumes nothing: hosted, paid, and no Hugging Face id", () => {
    const m = modelFromInbox(item(), "text-to-video", "2026-11-18T00:00:00Z");
    expect(m).toMatchObject({ openSource: false, runsLocally: false, access: "paid" });
    expect(m.hfId).toBeUndefined();
  });

  it("still treats a trending repo as open weights you can run", () => {
    const m = modelFromInbox(item({ source: "hf", hfId: "hexgrad/Kokoro-82M" }), "tts", "2026-11-18T00:00:00Z");
    expect(m).toMatchObject({ openSource: true, runsLocally: true, access: "free", hfId: "hexgrad/Kokoro-82M" });
  });
});
