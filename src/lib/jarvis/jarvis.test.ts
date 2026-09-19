import { describe, expect, it } from "vitest";
import { coerceStore, emptyJarvis, SEED_ROUTINES } from "./store";
import { keywordScore, recency, rrf, tokens } from "./rank";
import { addMemory, graphNodes, linkCount, searchMemories } from "./memoryClient";
import type { JarvisStore } from "./types";

describe("store", () => {
  it("starts empty but with the routine library seeded", () => {
    const s = emptyJarvis();
    expect(s.memories).toEqual([]);
    expect(s.conversations).toEqual([]);
    expect(s.routines).toHaveLength(SEED_ROUTINES.length);
    expect(s.routines.map((r) => r.name)).toContain("Daily brief");
    // Ids must be real, not the seed's missing ones.
    expect(s.routines.every((r) => r.id.length > 3)).toBe(true);
  });

  it("repairs a half-written or older blob instead of throwing", () => {
    expect(coerceStore(null).memories).toEqual([]);
    expect(coerceStore({ version: 1 }).routines.length).toBe(SEED_ROUTINES.length);
    const kept = coerceStore({ memories: [{ id: "a" }], lastSync: 7 });
    expect(kept.memories).toHaveLength(1);
    expect(kept.lastSync).toBe("");
  });
});

describe("rank", () => {
  it("drops stop words and punctuation", () => {
    expect(tokens("What was the title of my LAST meeting?")).toEqual(["title", "last", "meeting"]);
  });

  it("scores a title match above a body match", () => {
    const title = { title: "Favourite animal", content: "unrelated text here" };
    const body = { title: "Notes", content: "his favourite animal came up" };
    expect(keywordScore("favourite animal", title)).toBeGreaterThan(keywordScore("favourite animal", body));
  });

  it("rewards agreement: found by both searches beats first in only one", () => {
    const merged = rrf([
      ["onlyWords", "both", "x"],
      ["y", "z", "both"],
    ]);
    expect(merged[0].id).toBe("both");
    // One row per id, no duplicates.
    expect(new Set(merged.map((m) => m.id)).size).toBe(merged.length);
  });

  it("still surfaces a memory only one search found", () => {
    const merged = rrf([
      ["onlyWords", "both"],
      ["z", "both"],
    ]);
    expect(merged.map((m) => m.id)).toContain("onlyWords");
    expect(merged.find((m) => m.id === "onlyWords")!.score).toBeGreaterThan(0);
  });

  it("with a small k, rank position dominates agreement", () => {
    const merged = rrf([["top", "mid", "x"], ["z", "w", "mid"]], 0);
    expect(merged[0].id).toBe("top"); // 1/1 beats 1/2 + 1/3
  });

  it("returns nothing for empty inputs", () => {
    expect(rrf([])).toEqual([]);
    expect(rrf([[], []])).toEqual([]);
  });

  it("decays with age but never to zero", () => {
    const now = Date.parse("2026-09-19T00:00:00Z");
    const fresh = recency("2026-09-18T00:00:00Z", now);
    const old = recency("2025-09-18T00:00:00Z", now);
    expect(fresh).toBeGreaterThan(old);
    expect(old).toBeGreaterThan(0);
    // An unparseable date is treated as middling, not as an error.
    expect(recency("", now)).toBe(0.5);
  });
});

function withMemories(): JarvisStore {
  let s = emptyJarvis();
  s = addMemory(s, {
    source: "note",
    title: "Jack's favourite animal",
    content: "Jack's favourite animal is the English Springer Spaniel.",
    capturedAt: "2026-09-10T10:00:00Z",
  });
  s = addMemory(s, {
    source: "master-folder",
    title: "Hub AI provider",
    content: "Every AI call goes through src/lib/ai/provider.ts; OpenRouter is preferred.",
    capturedAt: "2026-09-01T10:00:00Z",
  });
  return s;
}

describe("memory client", () => {
  it("finds a memory by meaning-free word overlap and cites it", () => {
    const hits = searchMemories(withMemories(), "what is jacks favourite animal");
    expect(hits[0].memory.title).toBe("Jack's favourite animal");
  });

  it("returns nothing rather than a wrong answer when nothing matches", () => {
    expect(searchMemories(withMemories(), "quarterly revenue in norway")).toEqual([]);
  });

  it("shows the newest memories when there is no query", () => {
    const hits = searchMemories(withMemories(), "", 5);
    expect(hits[0].memory.title).toBe("Jack's favourite animal");
    expect(hits).toHaveLength(2);
  });

  it("excludes muted sources from search and from the sphere", () => {
    const s = { ...withMemories(), mutedSources: ["master-folder" as const] };
    expect(searchMemories(s, "openrouter provider")).toEqual([]);
    expect(graphNodes(s)).toHaveLength(1);
  });

  it("refuses an exact duplicate of the same source", () => {
    const s = withMemories();
    const again = addMemory(s, {
      source: "note",
      title: "Jack's favourite animal",
      content: "Jack's favourite animal is the English Springer Spaniel.",
    });
    expect(again.memories).toHaveLength(s.memories.length);
  });

  it("titles an untitled memory from its first line", () => {
    const s = addMemory(emptyJarvis(), { source: "note", title: "  ", content: "Remember the milk\nand eggs" });
    expect(s.memories[0].title).toBe("Remember the milk");
  });

  it("counts only links whose other end is in the drawn sample", () => {
    const s = emptyJarvis();
    const nodes = graphNodes({
      ...s,
      memories: [
        { id: "a", source: "note", title: "A", content: "a", capturedAt: "", tags: [], origin: "", links: ["b", "zz"] },
        { id: "b", source: "note", title: "B", content: "b", capturedAt: "", tags: [], origin: "", links: [] },
      ],
    });
    expect(linkCount(nodes)).toBe(1);
  });
});
