import { describe, expect, it } from "vitest";
import {
  handleFrom,
  heuristicBrain,
  heuristicIdeas,
  localDay,
  mergePosts,
  newPersona,
  normalizeIdeas,
  personaContext,
  pickPosts,
  platformOfUrl,
  profileUrl,
  topTerms,
} from "./logic";
import type { Post } from "./types";

const post = (o: Partial<Post>): Post => ({
  id: Math.random().toString(36),
  platform: "tiktok",
  url: "",
  caption: "",
  addedAt: "2026-09-01T00:00:00Z",
  source: "sync",
  ...o,
});

describe("handles and links", () => {
  it("pulls the handle out of profile links and @names", () => {
    expect(handleFrom("https://www.tiktok.com/@lil.rhymes?lang=en")).toBe("lil.rhymes");
    expect(handleFrom("https://instagram.com/baby_steps/")).toBe("baby_steps");
    expect(handleFrom("@explainly")).toBe("explainly");
  });
  it("builds profile urls", () => {
    expect(profileUrl("tiktok", "@x")).toBe("https://www.tiktok.com/@x");
    expect(profileUrl("instagram", "x")).toBe("https://www.instagram.com/x/");
  });
  it("classifies post links", () => {
    expect(platformOfUrl("https://vm.tiktok.com/abc")).toBe("tiktok");
    expect(platformOfUrl("https://fb.watch/x")).toBe("facebook");
    expect(platformOfUrl("https://youtu.be/x")).toBe("youtube");
    expect(platformOfUrl("not a url")).toBe("other");
  });
});

describe("mergePosts", () => {
  it("keeps analysis on re-sync and refreshes stats", () => {
    const old = post({ externalId: "1", title: "Verse 1", stats: { views: 10 } });
    const fresh = post({ externalId: "1", caption: "new cap", stats: { views: 500 } });
    const merged = mergePosts([old], [fresh, post({ externalId: "2", postedAt: "2026-09-10T00:00:00Z" })]);
    expect(merged).toHaveLength(2);
    const one = merged.find((p) => p.externalId === "1")!;
    expect(one.title).toBe("Verse 1");
    expect(one.stats?.views).toBe(500);
    expect(merged[0].externalId).toBe("2"); // newest first
  });
});

describe("pickPosts", () => {
  it("mixes best performers with recent posts without duplicates", () => {
    const posts = Array.from({ length: 10 }, (_, i) =>
      post({ id: String(i), postedAt: `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00Z`, stats: { views: i === 0 ? 1e6 : 1 } }),
    );
    const picked = pickPosts(posts, 4);
    expect(picked).toHaveLength(4);
    expect(picked[0].id).toBe("0");
    expect(new Set(picked).size).toBe(4);
  });
});

describe("personaContext", () => {
  it("includes the profile and the posts", () => {
    const p = newPersona({ name: "Lil Rhymes", niche: "Rap music videos", contentTypes: ["music video"], avoid: "diss tracks" });
    p.posts = [post({ title: "Cold Nights", caption: "new drop" })];
    const ctx = personaContext(p);
    expect(ctx).toContain("NICHE: Rap music videos");
    expect(ctx).toContain("NEVER SUGGEST: diss tracks");
    expect(ctx).toContain("Cold Nights");
  });
});

describe("offline heuristics", () => {
  it("finds recurring terms and ignores filler hashtags", () => {
    expect(topTerms(["baby first steps #fyp", "baby month 6 #viral", "first food baby"])).toEqual(
      expect.arrayContaining(["baby", "first"]),
    );
    expect(topTerms(["#fyp #fyp", "#fyp"])).not.toContain("fyp");
  });
  it("gives the same ideas for the same day", () => {
    const p = newPersona({ name: "Baby", niche: "Baby growth", contentTypes: ["milestone", "month update"] });
    const a = heuristicIdeas(p, "2026-09-19").map((i) => i.title);
    const b = heuristicIdeas(p, "2026-09-19").map((i) => i.title);
    expect(a).toEqual(b);
    expect(a).toHaveLength(5);
  });
  it("writes a brain without a key", () => {
    const p = newPersona({ name: "Ex", niche: "Explainers", contentTypes: ["explainer"] });
    const brain = heuristicBrain(p);
    expect(brain.by).toBe("heuristic");
    expect(brain.pillars).toContain("explainer");
  });
});

describe("normalizeIdeas", () => {
  it("accepts {ideas:[…]} and drops untitled rows", () => {
    const ideas = normalizeIdeas({ ideas: [{ title: "A", platform: "TikTok", outline: ["x"] }, { hook: "no title" }] });
    expect(ideas).toHaveLength(1);
    expect(ideas[0].platform).toBe("tiktok");
    expect(ideas[0].status).toBe("new");
  });
});

it("localDay is the local calendar day", () => {
  expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
});
