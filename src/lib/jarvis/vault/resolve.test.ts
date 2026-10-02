import { describe, expect, it } from "vitest";
import { backlinks, buildGraph, dedupeManifest, ghostKey, orphans, owedNotes, strengthOf, tagKey, type VaultEntry } from "./resolve";

const NOW = Date.parse("2026-10-02T12:00:00.000Z");

/** A note, with a body. Hash is irrelevant to resolution so it is nominal. */
const note = (path: string, raw: string, patch: Partial<VaultEntry> = {}): VaultEntry => ({
  path,
  hash: `h-${path}`,
  mtime: NOW - 86_400_000,
  raw,
  ...patch,
});

const keys = (entries: VaultEntry[], options = {}) => buildGraph(entries, { now: NOW, ...options }).nodes.map((n) => n.key).sort();

const linksOf = (entries: VaultEntry[], path: string, options = {}) =>
  [...(buildGraph(entries, { now: NOW, ...options }).nodes.find((n) => n.key === path)?.links ?? [])].sort();

describe("dedupeManifest", () => {
  it("collapses the two spellings Windows produces, which would otherwise break the whole sweep", () => {
    // Both of these are one file. A single insert carrying both violates the
    // unique index on external_id and takes the entire batch down.
    const { entries, dropped } = dedupeManifest([
      { path: "Notes\\A.md", hash: "a" },
      { path: "Notes/A.md", hash: "a" },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("Notes/A.md");
    expect(dropped).toEqual(["Notes/A.md"]);
  });

  it("drops an empty path rather than indexing the vault root", () => {
    expect(dedupeManifest([{ path: "   ", hash: "x" }, { path: "a.md", hash: "y" }]).entries).toHaveLength(1);
  });
});

describe("resolving a link to a path", () => {
  it("prefers an exact path, with or without the extension", () => {
    const entries = [note("notes/Ideas.md", "x"), note("Ideas.md", "y"), note("from.md", "[[notes/Ideas]]")];
    expect(linksOf(entries, "from.md")).toEqual(["notes/Ideas.md"]);
  });

  it("resolves a bare name when exactly one note has it", () => {
    const entries = [note("topics/Ozone Therapy.md", "x"), note("from.md", "[[Ozone Therapy]]")];
    expect(linksOf(entries, "from.md")).toEqual(["topics/Ozone Therapy.md"]);
  });

  it("prefers the copy in the linking note's own folder when the name is not unique", () => {
    const entries = [note("a/Notes.md", "x"), note("b/Notes.md", "y"), note("b/from.md", "[[Notes]]")];
    expect(linksOf(entries, "b/from.md")).toEqual(["b/Notes.md"]);
  });

  it("records an ambiguity rather than hiding it", () => {
    const entries = [note("aa/long/Notes.md", "x"), note("b/Notes.md", "y"), note("c/from.md", "[[Notes]]")];
    const graph = buildGraph(entries, { now: NOW });
    // Shortest path wins, but the owner gets told there was a choice.
    expect(graph.nodes.find((n) => n.key === "c/from.md")?.links).toEqual(["b/Notes.md"]);
    expect(graph.ambiguous).toHaveLength(1);
    expect(graph.ambiguous[0].among.sort()).toEqual(["aa/long/Notes.md", "b/Notes.md"]);
  });

  it("breaks a length tie alphabetically, so the same vault resolves the same way every sweep", () => {
    const entries = [note("zz/N.md", "x"), note("aa/N.md", "y"), note("from.md", "[[N]]")];
    expect(linksOf(entries, "from.md")).toEqual(["aa/N.md"]);
    expect(linksOf(entries, "from.md")).toEqual(linksOf(entries, "from.md"));
  });

  it("resolves a relative markdown link against the linking note's folder", () => {
    const entries = [note("topics/Other.md", "x"), note("topics/from.md", "[see](./Other.md)")];
    expect(linksOf(entries, "topics/from.md")).toEqual(["topics/Other.md"]);
  });

  it("does not make a self-link into an edge", () => {
    const graph = buildGraph([note("A.md", "[[A]]")], { now: NOW });
    expect(graph.edges).toEqual([]);
    expect(graph.nodes.find((n) => n.key === "A.md")?.links).toEqual([]);
  });
});

describe("ghosts", () => {
  it("draws a node for a note that is linked to and never written", () => {
    expect(keys([note("from.md", "I should write [[A Note I Never Wrote]]")])).toEqual(["from.md", ghostKey("A Note I Never Wrote")]);
  });

  it("converges four references to one unwritten idea onto a single ghost", () => {
    const entries = [note("a.md", "[[Idea]]"), note("b.md", "[[idea]]"), note("c.md", "[[Idea]]"), note("d.md", "[[IDEA]]")];
    const graph = buildGraph(entries, { now: NOW });
    expect(graph.nodes.filter((n) => n.kind === "ghost")).toHaveLength(1);
    expect(backlinks(graph, ghostKey("Idea")).sort()).toEqual(["a.md", "b.md", "c.md", "d.md"]);
  });

  it("makes a ghost brighter the more often it is owed", () => {
    const once = buildGraph([note("a.md", "[[X]]")], { now: NOW });
    const thrice = buildGraph([note("a.md", "[[X]]"), note("b.md", "[[X]]"), note("c.md", "[[X]]")], { now: NOW });
    const strength = (g: ReturnType<typeof buildGraph>) => g.nodes.find((n) => n.kind === "ghost")!.strength;
    expect(strength(thrice)).toBeGreaterThan(strength(once));
  });

  it("can be turned off, and then a dangling link is simply no edge", () => {
    const graph = buildGraph([note("a.md", "[[Nowhere]]")], { now: NOW, includeGhosts: false });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toEqual([]);
  });

  it("names the notes the owner owes themselves, most-demanded first", () => {
    const entries = [
      note("a.md", "[[Owed Twice]] [[Owed Once]]"),
      note("b.md", "[[Owed Twice]]"),
      note("c.md", "[[Owed Thrice]]"),
      note("d.md", "[[Owed Thrice]]"),
      note("e.md", "[[Owed Thrice]]"),
    ];
    const owed = owedNotes(buildGraph(entries, { now: NOW }));
    expect(owed.map((o) => o.title)).toEqual(["Owed Thrice", "Owed Twice"]);
    expect(owed[0].referrers).toBe(3);
  });
});

describe("edges", () => {
  it("draws A→B and B→A as one line", () => {
    const graph = buildGraph([note("A.md", "[[B]]"), note("B.md", "[[A]]")], { now: NOW });
    expect(graph.edges).toHaveLength(1);
  });

  it("marks a pair as an embed when either side embeds the other", () => {
    const graph = buildGraph([note("A.md", "![[B]]"), note("B.md", "[[A]]")], { now: NOW });
    expect(graph.edges[0].embed).toBe(true);
  });

  it("finds the notes nothing links to and which link nowhere", () => {
    const entries = [note("A.md", "[[B]]"), note("B.md", "x"), note("Lonely.md", "no links at all")];
    expect(orphans(buildGraph(entries, { now: NOW })).map((n) => n.key)).toEqual(["Lonely.md"]);
  });

  it("derives backlinks rather than storing them, so they cannot go stale", () => {
    const graph = buildGraph([note("A.md", "[[Target]]"), note("B.md", "[[Target]]"), note("Target.md", "x")], { now: NOW });
    expect(backlinks(graph, "Target.md").sort()).toEqual(["A.md", "B.md"]);
  });
});

describe("tags as nodes", () => {
  it("is off by default, because tags multiply fast", () => {
    expect(keys([note("a.md", "#one #two #three")])).toEqual(["a.md"]);
  });

  it("draws one node per tag and links every note filed under it", () => {
    const graph = buildGraph([note("a.md", "#shared"), note("b.md", "#shared")], { now: NOW, includeTags: true });
    expect(graph.nodes.filter((n) => n.kind === "tag")).toHaveLength(1);
    expect(backlinks(graph, tagKey("shared")).sort()).toEqual(["a.md", "b.md"]);
  });
});

describe("a rename", () => {
  it("heals the edges on the next sweep, because Obsidian rewrites the link text itself", () => {
    const before = buildGraph([note("Old Name.md", "x"), note("from.md", "[[Old Name]]")], { now: NOW });
    expect(before.nodes.find((n) => n.key === "from.md")?.links).toEqual(["Old Name.md"]);

    // Obsidian renames the file AND rewrites the wikilink in `from.md`.
    const after = buildGraph([note("New Name.md", "x"), note("from.md", "[[New Name]]")], { now: NOW });
    expect(after.nodes.find((n) => n.key === "from.md")?.links).toEqual(["New Name.md"]);
    // No ghost left behind, and no extra node.
    expect(after.nodes).toHaveLength(2);
    expect(after.nodes.every((n) => n.kind === "note")).toBe(true);
  });
});

describe("a manifest with no bodies yet", () => {
  it("still draws every note, so the first paint is not an empty canvas", () => {
    // This is the real first-paint case: the manifest has arrived, the bodies
    // have not. A graph that looks empty until 2000 notes download reads as
    // broken rather than loading.
    const graph = buildGraph([{ path: "a.md", hash: "x", size: 400 }, { path: "b.md", hash: "y", size: 400 }], { now: NOW });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toEqual([]);
    expect(graph.nodes[0].title).toBe("a");
  });
});

describe("strengthOf", () => {
  it("rates a long recent note above a short old one", () => {
    const fresh = strengthOf({ raw: "x".repeat(800), mtime: NOW }, NOW);
    const stale = strengthOf({ raw: "x", mtime: NOW - 400 * 86_400_000 }, NOW);
    expect(fresh).toBeGreaterThan(stale);
    expect(fresh).toBeLessThanOrEqual(1);
  });

  it("falls back to size when there is no body, so a manifest-only node is not uniformly dim", () => {
    expect(strengthOf({ size: 800, mtime: NOW }, NOW)).toBeGreaterThan(strengthOf({ size: 0, mtime: NOW }, NOW));
  });

  it("treats a missing mtime as old rather than throwing", () => {
    expect(strengthOf({ size: 100 }, NOW)).toBeGreaterThan(0);
  });
});

describe("the mirror row id", () => {
  it("is carried onto the node when one exists, and absent when it does not", () => {
    const graph = buildGraph([note("a.md", "x", { memoryId: "row-1" }), note("b.md", "y")], { now: NOW });
    expect(graph.nodes.find((n) => n.key === "a.md")?.memoryId).toBe("row-1");
    expect(graph.nodes.find((n) => n.key === "b.md")?.memoryId).toBeUndefined();
  });
});
