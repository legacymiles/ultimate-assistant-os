import { describe, expect, it } from "vitest";
import { extractChips, highlightSpans, sanitizeChips } from "./extract";
import { assemble, mergeChips, moveItem, technicalLayer, visiblePrompt } from "./assemble";
import { DELIVERABLES, deliverableById } from "./deliverables";
import { dnaRibbon, groupChips, recommend, relatedImages, searchGallery, translateIdea } from "./discover";
import { CHIP_LIBRARY, searchLibrary } from "./chipLibrary";
import { CHIP_CATEGORIES, DNA_GROUPS, groupOf } from "./taxonomy";
import { allowed, PLANS, planFor, MONETIZATION_ENABLED } from "./plan";
import { SEED } from "./seed";
import type { InspireImage } from "./types";

const EXAMPLE =
  "A futuristic cyberpunk warrior standing in a neon-lit Tokyo street, cinematic lighting, ultra-detailed 3D rendering, dramatic shadows, volumetric fog, 85mm lens.";

const texts = (p: string) => extractChips(p).map((c) => c.text.toLowerCase());

describe("Prompt DNA extraction", () => {
  it("breaks the brief's example into its visual ingredients", () => {
    const chips = extractChips(EXAMPLE);
    const t = chips.map((c) => c.text.toLowerCase());
    for (const want of ["futuristic", "cyberpunk warrior", "neon-lit tokyo street", "cinematic lighting", "ultra-detailed", "3d rendering", "dramatic shadows", "volumetric fog", "85mm lens"]) {
      expect(t).toContain(want);
    }
    const cat = (x: string) => chips.find((c) => c.text.toLowerCase() === x)?.category;
    expect(cat("cinematic lighting")).toBe("lighting");
    expect(cat("85mm lens")).toBe("camera");
    expect(cat("volumetric fog")).toBe("effects");
    expect(cat("3d rendering")).toBe("style");
    expect(cat("cyberpunk warrior")).toBe("character");
  });

  it("keeps chips in the order they appear in the prompt", () => {
    const t = texts(EXAMPLE);
    expect(t.indexOf("futuristic")).toBeLessThan(t.indexOf("85mm lens"));
  });

  it("never makes a chip out of filler", () => {
    const t = texts("a beautiful masterpiece, 8k, trending on artstation, a red fox in the snow, soft window light");
    expect(t).not.toContain("beautiful");
    expect(t).not.toContain("8k");
    expect(t).not.toContain("masterpiece");
    expect(t.some((x) => x.includes("red fox"))).toBe(true);
    expect(t).toContain("soft window light");
  });

  it("leaves no dangling prepositions or lone 'palette' chips", () => {
    for (const s of SEED) {
      for (const c of extractChips(s.prompt)) {
        expect(c.text, s.id).not.toMatch(/\s(of|on|a|an|the|with|to|in)$/i);
        expect(c.text.toLowerCase(), s.id).not.toBe("palette");
      }
    }
  });

  it("finds at least five ingredients in every starter prompt, covering three or more groups", () => {
    for (const s of SEED) {
      const chips = extractChips(s.prompt);
      expect(chips.length, s.id).toBeGreaterThanOrEqual(5);
      expect(new Set(chips.map((c) => groupOf(c.category).id)).size, s.id).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives every chip a hover explanation", () => {
    for (const c of extractChips(EXAMPLE)) expect(c.why && c.why.length > 10).toBe(true);
  });

  it("highlights chips inside the untouched original prompt", () => {
    const chips = extractChips(EXAMPLE);
    const spans = highlightSpans(EXAMPLE, chips);
    expect(spans.map((s) => s.text).join("")).toBe(EXAMPLE);
    expect(spans.filter((s) => s.chip).length).toBeGreaterThanOrEqual(8);
  });

  it("sanitizes chips from a model or a browser", () => {
    const out = sanitizeChips([
      { text: "  rim light ", category: "lighting", why: "edge" },
      { text: "rim light", category: "lighting" },
      { text: "", category: "mood" },
      { text: "85mm lens", category: "nonsense" },
      "junk",
    ]);
    expect(out).toEqual([
      { text: "rim light", category: "lighting", why: "edge" },
      { text: "85mm lens", category: "camera" },
    ]);
    expect(sanitizeChips("nope")).toEqual([]);
  });
});

describe("taxonomy and library", () => {
  it("folds all 16 builder drawers into the 10 Prompt DNA groups", () => {
    expect(CHIP_CATEGORIES).toHaveLength(16);
    expect(DNA_GROUPS).toHaveLength(10);
    const used = new Set(CHIP_CATEGORIES.map((c) => c.group));
    expect(used.size).toBe(10);
  });

  it("has a described chip in every drawer", () => {
    for (const cat of CHIP_CATEGORIES) {
      const chips = CHIP_LIBRARY.filter((c) => c.category === cat.id);
      expect(chips.length, cat.id).toBeGreaterThanOrEqual(8);
      for (const c of chips) expect(c.why, c.text).toBeTruthy();
    }
    expect(new Set(CHIP_LIBRARY.map((c) => c.id)).size).toBe(CHIP_LIBRARY.length);
  });

  it("searches across every category, best match first", () => {
    expect(searchLibrary("rim")[0].text).toBe("rim light");
    expect(searchLibrary("fog").some((c) => c.text === "volumetric fog")).toBe(true);
    expect(searchLibrary("", "camera").every((c) => c.category === "camera")).toBe(true);
  });
});

describe("Prompt Builder assembly", () => {
  const chips = [
    { text: "cyberpunk warrior", category: "character" as const },
    { text: "rim light", category: "lighting" as const },
    { text: "trench coat", category: "wardrobe" as const },
  ];

  it("leads with the subject and reads as a sentence", () => {
    expect(visiblePrompt(chips)).toBe("Cyberpunk warrior with trench coat, rim light");
    expect(visiblePrompt(chips, "in the rain")).toBe("Cyberpunk warrior with trench coat, in the rain, rim light");
    expect(visiblePrompt([])).toBe("");
  });

  it("adds a hidden technical layer per deliverable, and none for Custom", () => {
    const tee = assemble({ chips, deliverable: "tshirt" });
    expect(tee.visible).not.toMatch(/isolated/i);
    expect(tee.final).toMatch(/Technical requirements:.*isolated on a plain solid background/i);
    expect(assemble({ chips, deliverable: "custom" }).final).toBe(tee.visible);
  });

  it("gives different deliverables different rules and sizes", () => {
    const rules = new Set(DELIVERABLES.map((d) => d.rules.join("|")));
    expect(rules.size).toBe(DELIVERABLES.length);
    expect(deliverableById("logo").aspect).toBe("1:1");
    expect(deliverableById("poster").aspect).toBe("2:3");
    expect(deliverableById("nope").id).toBe("custom");
  });

  it("adds one line per reference purpose, once", () => {
    const lines = technicalLayer("custom", [
      { purpose: "style", name: "a" },
      { purpose: "style", name: "b" },
      { purpose: "color", name: "c" },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/art style/);
  });

  it("lets a hand edit replace the sentence but keeps the technical layer", () => {
    const a = assemble({ chips, deliverable: "logo", override: "a fox mark" });
    expect(a.visible).toBe("a fox mark");
    expect(a.final).toMatch(/^a fox mark\.\n\nTechnical requirements: flat vector/);
  });

  it("reorders and merges without duplicates", () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 5, 0)).toEqual([1, 2, 3]);
    expect(mergeChips(chips, [{ text: "RIM LIGHT", category: "lighting" }, { text: "fog", category: "effects" }])).toHaveLength(4);
  });
});

function img(id: string, over: Partial<InspireImage> = {}): InspireImage {
  return {
    id,
    ownerId: null,
    creator: "studio",
    title: id,
    description: "",
    prompt: "",
    model: "",
    style: "Cyberpunk",
    subject: "Person",
    category: "character",
    chips: [],
    visibility: "public",
    source: "seed",
    width: 1,
    height: 1,
    src: "",
    thumb: "",
    tint: "",
    createdAt: "2026-11-01T00:00:00Z",
    ...over,
  };
}

describe("discovery", () => {
  const gallery = [
    img("a", { title: "Neon Ronin", creator: "lumen.lab", chips: extractChips(EXAMPLE), prompt: EXAMPLE, createdAt: "2026-11-03T00:00:00Z" }),
    img("b", { title: "Koi", style: "Line Art", category: "tshirt", creator: "inkfoundry", chips: extractChips(SEED[1].prompt), prompt: SEED[1].prompt }),
    img("c", { title: "Rain", chips: extractChips("street portrait, cinematic lighting, dramatic shadows, 85mm lens"), createdAt: "2026-11-02T00:00:00Z" }),
  ];

  it("searches title, creator, prompt and chips; filters; sorts newest first", () => {
    expect(searchGallery(gallery, { q: "volumetric" }).map((i) => i.id)).toEqual(["a"]);
    expect(searchGallery(gallery, { q: "@inkfoundry" }).map((i) => i.id)).toEqual(["b"]);
    expect(searchGallery(gallery, { category: "tshirt" }).map((i) => i.id)).toEqual(["b"]);
    expect(searchGallery(gallery, {}).map((i) => i.id)).toEqual(["a", "c", "b"]);
    expect(searchGallery(gallery, { sort: "oldest" })[0].id).toBe("b");
  });

  it("finds images that share visual DNA, per facet", () => {
    expect(relatedImages(gallery[0], gallery)[0].id).toBe("c");
    expect(relatedImages(gallery[0], gallery, "lighting").map((i) => i.id)).toContain("c");
    expect(relatedImages(gallery[0], gallery).map((i) => i.id)).not.toContain("a");
  });

  it("recommends what is missing, never what is already there", () => {
    const recs = recommend([{ text: "cyberpunk warrior", category: "character" }], gallery, "poster");
    expect(recs.length).toBeGreaterThan(3);
    expect(recs.some((r) => r.text === "negative space")).toBe(true);
    expect(recs.some((r) => groupOf(r.category).id === "lighting")).toBe(true);
    expect(recs.every((r) => r.reason)).toBe(true);
    expect(recs.some((r) => r.text === "cyberpunk warrior")).toBe(false);
  });

  it("translates a plain idea into categorised blocks", () => {
    const chips = translateIdea("a cute robot for a kids t-shirt, retro vibe");
    expect(chips.some((c) => c.text.includes("robot"))).toBe(true);
    expect(chips.some((c) => c.text === "centered composition")).toBe(true);
    expect(chips.some((c) => c.text === "halftone texture")).toBe(true);
  });

  it("groups chips for the breakdown and builds the DNA ribbon", () => {
    const chips = extractChips(EXAMPLE);
    const groups = groupChips(chips);
    expect(groups.reduce((n, g) => n + g.chips.length, 0)).toBe(chips.length);
    const ribbon = dnaRibbon(chips);
    expect(ribbon.reduce((n, r) => n + r.share, 0)).toBeCloseTo(1);
    expect(dnaRibbon([])).toEqual([]);
  });
});

describe("plans", () => {
  it("is free for everyone with monetization off, unlimited for the owner", () => {
    expect(MONETIZATION_ENABLED).toBe(false);
    expect(planFor(false).id).toBe("free");
    expect(planFor(true).aiPerDay).toBeNull();
    expect(allowed(PLANS.free, 39, 1)).toBe(true);
    expect(allowed(PLANS.free, 39, 2)).toBe(false);
    expect(allowed(PLANS.owner, 10_000, 2)).toBe(true);
  });
});
