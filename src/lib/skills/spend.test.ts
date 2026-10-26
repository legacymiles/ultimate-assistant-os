import { describe, expect, it } from "vitest";
import {
  addJev,
  addSpend,
  bySpend,
  capState,
  cheaper,
  chooseTier,
  dollars,
  EMPTY_SPEND,
  normalizeSpend,
  retireCandidates,
  setCap,
  setPin,
  spendFor,
  spendKey,
  tokensLabel,
  weekKey,
} from "./spend";
import type { Skill } from "./types";
import type { UsageData } from "./usage";

const NOW = Date.parse("2026-10-25T23:00:00Z"); // a Sunday
const fresh = () => normalizeSpend(EMPTY_SPEND);
const skill = (slug: string, title = slug): Skill => ({ id: slug, slug, title, overview: "", body: "", source: "claude-code", origin: "Personal", createdAt: "", updatedAt: "" });

describe("keys and weeks", () => {
  it("normalises keys like usage does", () => {
    expect(spendKey("/Felix")).toBe("felix");
    expect(spendKey("@Studio:Film-3D")).toBe("studio:film-3d");
    expect(spendKey("bad key!")).toBe("");
  });
  it("uses ISO weeks that start on Monday", () => {
    expect(weekKey("2026-10-25T23:00:00Z")).toBe("2026-W43"); // Sunday
    expect(weekKey("2026-10-26T00:30:00Z")).toBe("2026-W44"); // Monday
    expect(weekKey("2027-01-01T12:00:00Z")).toBe("2026-W53");
  });
});

describe("recording", () => {
  it("adds runs, tokens, cost and this week's totals, once per id", () => {
    const d = fresh();
    expect(addSpend(d, [{ skill: "felix", source: "jarvis", cost: 0.02, promptTokens: 5000, completionTokens: 300, tier: "harder", id: "a" }], NOW)).toBe(1);
    expect(addSpend(d, [{ skill: "felix", source: "jarvis", cost: 0.02, promptTokens: 5000, completionTokens: 300, id: "a" }], NOW)).toBe(0);
    addSpend(d, [{ skill: "felix", source: "claude-code", cost: 0.5, promptTokens: 90000, completionTokens: 2000, estimated: true, saved: true }], NOW);
    const s = d.skills.felix;
    expect(s.runs).toBe(2);
    expect(s.weekTokens).toBe(97_300);
    expect(s.cost).toBeCloseTo(0.52);
    expect(s.estimated).toBe(true);
    expect(s.routed.harder).toBe(1);
    expect(s.savedRuns).toBe(1);
    expect(s.by).toEqual({ jarvis: 1, "claude-code": 1 });
  });
  it("resets the week but keeps lifetime totals", () => {
    const d = fresh();
    addSpend(d, [{ skill: "felix", source: "jarvis", cost: 1, promptTokens: 10, completionTokens: 0 }], NOW);
    addSpend(d, [{ skill: "felix", source: "jarvis", cost: 2, promptTokens: 10, completionTokens: 0 }], NOW + 2 * 86_400_000);
    expect(d.skills.felix.weekCost).toBe(2);
    expect(d.skills.felix.cost).toBe(3);
  });
  it("counts Jev decisions", () => {
    const d = fresh();
    addJev(d, { used: true, cost: 0.00001, ms: 120 });
    addJev(d, { used: false, cost: 0, ms: 300 });
    expect(d.jev).toMatchObject({ calls: 2, used: 1 });
  });
});

describe("caps, pins and routing", () => {
  it("drops an over-cap skill to the free tier until the week resets", () => {
    let d = setCap(fresh(), "/Animate", 4);
    addSpend(d, [{ skill: "animate", source: "jarvis", cost: 4.5, promptTokens: 1, completionTokens: 1 }], NOW);
    expect(capState(d, "animate", NOW)).toMatchObject({ cap: 4, over: true });
    expect(chooseTier(d, "animate", "hardest", NOW)).toEqual({ tier: "free", why: "cap" });
    // Next week the cap is fresh again.
    expect(chooseTier(d, "animate", "hardest", NOW + 2 * 86_400_000)).toEqual({ tier: "hardest", why: "jev" });
    d = setCap(d, "animate", null);
    expect(d.caps.animate).toBeUndefined();
  });
  it("lets a pin outrank the cap and Jev", () => {
    const d = setPin(setCap(fresh(), "felix", 0.01), "felix", "hardest");
    addSpend(d, [{ skill: "felix", source: "jarvis", cost: 1, promptTokens: 1, completionTokens: 1 }], NOW);
    expect(chooseTier(d, "felix", "free", NOW)).toEqual({ tier: "hardest", why: "pin" });
  });
  it("falls back to the router when Jev is unsure", () => {
    expect(chooseTier(fresh(), "grammar", null)).toEqual({ tier: null, why: "router" });
    expect(chooseTier(fresh(), "grammar", "not-a-tier")).toEqual({ tier: null, why: "router" });
  });
  it("knows which tiers are cheaper", () => {
    expect(cheaper("free", "harder")).toBe(true);
    expect(cheaper("harder", "long")).toBe(true);
    expect(cheaper("hardest", "hardest")).toBe(false);
    expect(cheaper("harder", "free")).toBe(false);
  });
});

describe("the library", () => {
  const d = fresh();
  addSpend(d, [{ skill: "felix", source: "jarvis", cost: 0.1, promptTokens: 100, completionTokens: 10 }], NOW);
  addSpend(d, [{ skill: "animate", source: "claude-code", cost: 0, promptTokens: 900_000, completionTokens: 10 }], NOW);
  addSpend(d, [{ skill: "studio:film-3d", source: "jarvis", cost: 2, promptTokens: 1, completionTokens: 1 }], NOW);
  it("matches a skill by its call names, including Studio workflows", () => {
    expect(spendFor(skill("felix"), d)?.cost).toBe(0.1);
    expect(spendFor(skill("film-3d"), d)?.cost).toBe(2);
  });
  it("sorts by dollars, then tokens", () => {
    expect(bySpend([skill("felix"), skill("animate"), skill("film-3d"), skill("idle")], d).map((s) => s.slug)).toEqual(["film-3d", "felix", "animate", "idle"]);
  });
  it("suggests never-used and stale skills to retire", () => {
    const usage: UsageData = {
      skills: {
        felix: { count: 9, first: "2026-10-01T00:00:00Z", last: "2026-10-24T00:00:00Z", by: {} },
        old: { count: 1, first: "2026-06-01T00:00:00Z", last: "2026-06-01T00:00:00Z", by: {} },
      },
    };
    const out = retireCandidates([skill("felix"), skill("old"), skill("never")], usage, 45, NOW);
    expect(out.map((c) => [c.skill.slug, c.why])).toEqual([["never", "never"], ["old", "stale"]]);
  });
  it("formats money and tokens", () => {
    expect(dollars(0.004)).toBe("<$0.01");
    expect(dollars(1.239)).toBe("$1.24");
    expect(tokensLabel(1_234_567)).toBe("1.2M");
    expect(tokensLabel(12_400)).toBe("12.4k");
  });
});
