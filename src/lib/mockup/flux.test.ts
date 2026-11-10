import { describe, expect, it } from "vitest";

import { directionsFor } from "./directions";
import { FLUX_PROMPT_MAX, FLUX_SIZE, fluxPrompt, pictureKey } from "./flux";
import { specFromSummary } from "./spec";

const site = specFromSummary({
  siteName: "Bloom Florist",
  clientName: "Ana",
  version: "v1",
  summary: "Bloom Florist — same-day flowers in Leeds\n• Order online\n• Wedding flowers\n• Subscriptions",
});

describe("Flux prompt for a mockup lane", () => {
  const lanes = directionsFor("interactive-web-studio");

  it("describes THIS page: its name, headline and sections", () => {
    const p = fluxPrompt(site, lanes[0]);
    expect(p).toContain("website homepage");
    expect(p).toContain("Bloom Florist");
    expect(p).toContain("Order online");
  });

  it("carries the lane's own colours, so three lanes paint three directions", () => {
    const prompts = lanes.map((l) => fluxPrompt(site, l));
    expect(new Set(prompts).size).toBe(3);
  });

  it("is one paragraph and inside the drawer's limit", () => {
    const p = fluxPrompt(site, lanes[1], "phone");
    expect(p).not.toMatch(/\n/);
    expect(p.length).toBeLessThanOrEqual(FLUX_PROMPT_MAX);
    expect(p).toContain("mobile website");
  });

  it("sizes pictures for the device, in multiples of 16", () => {
    for (const s of Object.values(FLUX_SIZE)) {
      expect(s.width % 16).toBe(0);
      expect(s.height % 16).toBe(0);
    }
  });

  it("keys the cache by prompt and device", () => {
    const p = fluxPrompt(site, lanes[0]);
    expect(pictureKey(p, "desktop")).toBe(pictureKey(p, "desktop"));
    expect(pictureKey(p, "desktop")).not.toBe(pictureKey(p, "phone"));
  });
});
