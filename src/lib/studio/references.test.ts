import { describe, expect, it } from "vitest";
import { pick } from "./render";
import { REFERENCE_PATTERN, referenceToken, referencesIn, searchReferences, type ReferenceMention } from "./references";

const refs = (n: number): ReferenceMention[] =>
  Array.from({ length: n }, (_, i) => ({
    n: i + 1,
    token: referenceToken(i + 1),
    label: `Subject ${i + 1}`,
    kind: "image" as const,
    thumb: `thumb-${i + 1}`,
    name: `photo-${i + 1}.jpg`,
  }));

describe("naming an upload in the prompt", () => {
  it("reads both the token the owner types and the phrase a skill writes", () => {
    expect(referencesIn("@Subject2 walks away from Subject 5")).toEqual([2, 5]);
    expect(referencesIn("subject-3 is holding it")).toEqual([3]);
  });

  it("keeps the order written and drops repeats", () => {
    expect(referencesIn("@Subject3 then @Subject1 then @Subject3")).toEqual([3, 1]);
  });

  it("ignores things that only look like one", () => {
    expect(referencesIn("the subject of the photo")).toEqual([]);
    expect(referencesIn("subjects 4 and 5")).toEqual([]);
  });

  it("matches what the render pipeline actually attaches", () => {
    // The whole point of the token: what the owner types is what the job gets.
    const uploads = ["a", "b", "c", "d", "e"];
    const job = { title: "t", prompt: "@Subject2 hands it to @Subject4", useReferences: true };
    expect(pick(job, uploads).map((r) => r.label)).toEqual(["Subject 2", "Subject 4"]);
  });

  it("falls back to the first four when the prompt names none", () => {
    const uploads = ["a", "b", "c", "d", "e"];
    expect(pick({ title: "t", prompt: "a wide shot", useReferences: true }, uploads)).toHaveLength(4);
  });

  it("attaches nothing when the job opts out", () => {
    expect(pick({ title: "t", prompt: "@Subject1", useReferences: false }, ["a"])).toEqual([]);
  });
});

describe("the @ menu", () => {
  it("offers everything for an empty query", () => {
    expect(searchReferences("", refs(3))).toHaveLength(3);
  });

  it("finds one by its number, its token or its file name", () => {
    const all = refs(12);
    expect(searchReferences("2", all).map((r) => r.n)).toEqual([2]);
    expect(searchReferences("subject1", all).map((r) => r.n)).toEqual([1, 10, 11, 12]);
    expect(searchReferences("photo-7", all).map((r) => r.n)).toEqual([7]);
  });

  it("returns nothing rather than everything when there is no match", () => {
    expect(searchReferences("zzz", refs(3))).toEqual([]);
  });
});

describe("the pattern itself", () => {
  it("is global, so repeated use does not skip matches", () => {
    expect(REFERENCE_PATTERN.flags).toContain("g");
    // A global regex carries lastIndex; referencesIn must not be affected by it.
    referencesIn("@Subject1");
    expect(referencesIn("@Subject1")).toEqual([1]);
  });
});

// The gallery's browser half (IndexedDB, poster capture) needs a DOM and this
// suite runs in node, so only its pure helpers are covered here. The store
// round-trip and the missing-bytes fallback were checked in the browser.
describe("gallery labels", () => {
  it("names a download after the title, safely", async () => {
    const { fileNameFor, prettyBytes } = await import("./gallery");
    expect(fileNameFor({ title: "Shot 1 — the hook", medium: "video" } as never)).toBe("Shot-1-the-hook.mp4");
    expect(fileNameFor({ title: "Flat lay / hero", medium: "image" } as never)).toBe("Flat-lay-hero.png");
    expect(fileNameFor({ title: "***", medium: "image" } as never)).toBe("studio.png");
    expect(prettyBytes(900)).toBe("900 B");
    expect(prettyBytes(2048)).toBe("2 KB");
    expect(prettyBytes(2411724)).toBe("2.3 MB");
  });
});

describe("app plugins", () => {
  it("resolves every allowed slug against the hub catalog", async () => {
    const { PLUGIN_SLUGS, studioPlugins } = await import("./plugins");
    const list = studioPlugins();
    expect(list.map((p) => p.slug)).toEqual([...PLUGIN_SLUGS]);
    for (const p of list) {
      expect(p.title).toBeTruthy();
      expect(p.href).toMatch(/^\//);
      // The catalog overviews are paragraphs; a card gets one sentence.
      expect(p.blurb.length).toBeLessThan(260);
      expect(p.blurb).not.toContain("\n");
    }
  });

  it("keeps them in the hub rather than moving them", async () => {
    const { PROJECTS } = await import("@/lib/catalog");
    const { PLUGIN_SLUGS } = await import("./plugins");
    for (const slug of PLUGIN_SLUGS) {
      expect(PROJECTS.some((p) => p.slug === slug)).toBe(true);
    }
  });
});
