import { describe, expect, it } from "vitest";
import { aiRankingsDestination as d } from "./aiRankings";

const SEEN = {
  name: "comfyanonymous/ComfyUI",
  url: "github.com/comfyanonymous/ComfyUI",
  summary: "Node-based diffusion GUI",
  group: "AI",
  category: "Image",
  tags: ["image-generation", "nodes"],
  access: "free",
  openSource: true,
  hosting: "self-host",
  apiKey: "none",
  nameSource: "seen",
  confidence: 0.97,
};

describe("AI Rankings destination", () => {
  it("keeps a GitHub identifier as the record name", () => {
    expect(d.parse(SEEN)?.name).toBe("comfyanonymous/ComfyUI");
  });

  it("drops a proposal with no name at all", () => {
    expect(d.parse({ ...SEEN, name: "" })).toBeNull();
    expect(d.parse(null)).toBeNull();
  });

  it("falls back to safe values for an invalid enum rather than writing junk", () => {
    const f = d.parse({ ...SEEN, access: "cheap", hosting: "moon", apiKey: "maybe" });
    expect(f?.access).toBe("free");
    expect(f?.hosting).toBe("hosted");
    expect(f?.apiKey).toBe("none");
  });

  it("treats a missing openSource as closed, never as open", () => {
    // Writing openSource:true for a tool that never claimed it is the one
    // wrong answer that changes how the board is filtered.
    expect(d.parse({ ...SEEN, openSource: undefined })?.openSource).toBe(false);
  });

  it("flags an inferred name and leaves a seen one unflagged", () => {
    const seen = d.parse(SEEN);
    const guess = d.parse({ ...SEEN, nameSource: "inferred" });
    expect(d.preview(seen!).unverified).toBeUndefined();
    expect(d.preview(guess!).unverified).toBeTruthy();
  });

  it("shows the full destination path in the preview", () => {
    expect(d.preview(d.parse(SEEN)!).where).toBe("AI Rankings › AI › Image");
  });
});
