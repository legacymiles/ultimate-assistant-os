import { describe, expect, it } from "vitest";
import { AGENTS, agentById } from "./agents";
import {
  cleanRewrite,
  extractResult,
  fallbackPrompt,
  generationText,
  placeholderImage,
  refGuide,
  rewriteSystem,
  userContent,
  type RefInput,
} from "./prompt";

const REFS: RefInput[] = [
  { role: "person", dataUrl: "data:image/jpeg;base64,AAA" },
  { role: "style", dataUrl: "data:image/jpeg;base64,BBB" },
];
const gta = agentById("gta-life")!;

describe("agent registry", () => {
  it("has unique ids and complete entries", () => {
    const ids = AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of AGENTS) {
      expect(a.brief.length).toBeGreaterThan(100);
      expect(a.styleBlock).not.toBe("");
      expect(a.examples.length).toBeGreaterThan(0);
      expect(a.model).toMatch(/\//);
    }
  });

  it("returns undefined for an unknown agent", () => {
    expect(agentById("nope")).toBeUndefined();
  });

  it("keeps the safety rules in the briefs", () => {
    expect(agentById("glamour")!.brief).toMatch(/no nudity/i);
    expect(gta.brief).toMatch(/never depict a named real celebrity/i);
  });
});

describe("prompt assembly", () => {
  it("numbers references in attachment order with their role", () => {
    const guide = refGuide(REFS);
    expect(guide).toContain("Image 1 is a PERSON");
    expect(guide).toContain("Image 2 is a STYLE");
    expect(refGuide([])).toBe("");
    expect(refGuide(REFS)).not.toContain("NO person reference");
  });

  it("says there is no person when every reference is a style", () => {
    expect(refGuide([REFS[1]])).toContain("NO person reference");
  });

  it("puts text first, then images in the same order", () => {
    const parts = userContent("hi", REFS);
    expect(parts[0]).toEqual({ type: "text", text: "hi" });
    expect(parts.slice(1).map((p) => (p.type === "image_url" ? p.image_url.url : ""))).toEqual(REFS.map((r) => r.dataUrl));
  });

  it("falls back to the raw prompt plus the style block", () => {
    const p = fallbackPrompt(gta, "me wrestling a bear.  ");
    expect(p.startsWith("me wrestling a bear. ")).toBe(true);
    expect(p).toContain(gta.styleBlock);
  });

  it("adds the reference guide and aspect ratio to the generation text", () => {
    const text = generationText(gta, "a prompt", REFS);
    expect(text).toContain("Image 1 is a PERSON");
    expect(text).toContain("16:9");
  });

  it("adds the soften instruction only when asked", () => {
    expect(rewriteSystem(gta)).not.toMatch(/refused/);
    expect(rewriteSystem(gta, true)).toMatch(/refused/);
  });

  it("strips labels and quotes from a rewrite", () => {
    expect(cleanRewrite('Prompt: "A bear."')).toBe("A bear.");
    expect(cleanRewrite("```\nA bear.\n```")).toBe("A bear.");
  });
});

describe("response parsing", () => {
  it("reads an image from message.images", () => {
    const r = extractResult({
      choices: [{ message: { content: "Here you go", images: [{ type: "image_url", image_url: { url: "data:image/png;base64,X" } }] } }],
    });
    expect(r).toEqual({ image: "data:image/png;base64,X", text: "Here you go" });
  });

  it("reads an image from array content", () => {
    const r = extractResult({
      choices: [{ message: { content: [{ type: "image_url", image_url: { url: "data:image/png;base64,Y" } }] } }],
    });
    expect(r.image).toBe("data:image/png;base64,Y");
  });

  it("returns the text when the model refused", () => {
    const r = extractResult({ choices: [{ message: { content: "I can't create that image." } }] });
    expect(r).toEqual({ image: null, text: "I can't create that image." });
  });

  it("survives garbage", () => {
    expect(extractResult(null)).toEqual({ image: null, text: "" });
  });
});

describe("placeholder", () => {
  it("is an SVG data URL", () => {
    expect(placeholderImage(gta, "me & a <bear>")).toMatch(/^data:image\/svg\+xml/);
    expect(decodeURIComponent(placeholderImage(gta, "me & a <bear>"))).toContain("&lt;bear&gt;");
  });
});
