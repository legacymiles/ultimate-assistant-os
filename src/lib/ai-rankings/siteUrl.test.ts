import { describe, expect, it } from "vitest";
import {
  guessCandidates,
  guessSiteUrl,
  guessSource,
  looksLikeDomain,
  looksLikeRepo,
  nameSlug,
} from "./siteUrl";

describe("looksLikeDomain", () => {
  it("accepts bare and schemed hosts", () => {
    expect(looksLikeDomain("krea.ai")).toBe(true);
    expect(looksLikeDomain("https://www.krea.ai/home")).toBe(true);
  });

  it("rejects prose that merely contains a dot", () => {
    expect(looksLikeDomain("Claude 3.5")).toBe(false);
    expect(looksLikeDomain("v1.2")).toBe(false); // numeric last label
    expect(looksLikeDomain("ComfyUI")).toBe(false);
  });
});

describe("looksLikeRepo", () => {
  it("spots owner/repo and nothing else", () => {
    expect(looksLikeRepo("comfyanonymous/ComfyUI")).toBe(true);
    expect(looksLikeRepo("krea.ai/app")).toBe(false);
    expect(looksLikeRepo("ComfyUI")).toBe(false);
  });
});

describe("nameSlug", () => {
  it("reduces a product name to one domain label", () => {
    expect(nameSlug("Stable Diffusion")).toBe("stablediffusion");
    expect(nameSlug("Runway (Gen-3)")).toBe("runway");
    expect(nameSlug("11 Labs!")).toBe("11labs");
  });
});

describe("guessCandidates", () => {
  it("keeps a typed domain as-is, with a scheme", () => {
    expect(guessCandidates("krea.ai")).toEqual(["https://krea.ai"]);
  });

  it("sends owner/repo to GitHub", () => {
    expect(guessCandidates("comfyanonymous/ComfyUI")).toEqual([
      "https://github.com/comfyanonymous/ComfyUI",
    ]);
  });

  it("offers .com first, then the suffixes AI tools use", () => {
    expect(guessCandidates("Krea")).toEqual([
      "https://krea.com",
      "https://krea.ai",
      "https://krea.io",
      "https://krea.app",
      "https://krea.dev",
    ]);
  });

  it("offers nothing for a name with no letters or digits", () => {
    expect(guessCandidates("  ")).toEqual([]);
    expect(guessCandidates("✨")).toEqual([]);
    expect(guessSiteUrl("✨")).toBe("");
  });
});

describe("guessSource", () => {
  it("calls a typed domain or repo typed, and everything else a guess", () => {
    expect(guessSource("krea.ai")).toBe("typed");
    expect(guessSource("comfyanonymous/ComfyUI")).toBe("typed");
    expect(guessSource("Krea")).toBe("guess");
  });
});
