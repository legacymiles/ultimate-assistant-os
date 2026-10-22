import { describe, expect, it } from "vitest";
import {
  addOwnRule,
  checklistPrompt,
  checklistSkill,
  coerceLearned,
  coerceProfile,
  emptyProfile,
  matchingRule,
  mergeLearned,
  parseRule,
  removeRule,
  toggleRule,
} from "./checklist";

const NOW = Date.parse("2026-10-18T20:00:00Z");

describe("starter checklist", () => {
  it("comes with the basics the owner keeps repeating", () => {
    const p = emptyProfile(NOW);
    const text = p.rules.map((r) => r.then.toLowerCase()).join("\n");
    expect(text).toContain("no duplicates");
    expect(text).toContain("newest first");
    expect(text).toContain("sign-in");
    expect(text).toContain("plain english");
    expect(p.rules.every((r) => r.on)).toBe(true);
  });

  it("leads every build with 'make it mobile friendly'", () => {
    const p = emptyProfile(NOW);
    const prompt = checklistPrompt(p);
    expect(prompt.startsWith("Phones:")).toBe(true);
    expect(prompt.split("\n")[1]).toMatch(/\[U1\] Make it mobile friendly/);
    const u1 = p.rules.find((r) => r.code === "U1")!;
    expect(u1.when).toBe("Always");
    expect(u1.then).toMatch(/swipe sideways/);
    expect(u1.check).toMatch(/390 px/);
  });

  it("an owner's older copy of the phone rule picks up the new wording", () => {
    const old = emptyProfile(NOW);
    const stale = {
      ...old,
      rules: old.rules.map((r) => (r.id === "s-mobile" ? { ...r, then: "Works on a phone: fits the screen, big enough to tap, nothing hidden off the edge.", on: false, said: 3 } : r)),
    };
    const u1 = coerceProfile(JSON.parse(JSON.stringify(stale)), NOW).rules.find((r) => r.id === "s-mobile")!;
    expect(u1.then).toMatch(/^Make it mobile friendly/);
    expect(u1.on).toBe(false); // the owner's on/off stays theirs
    expect(u1.said).toBe(3);
  });
});

describe("parseRule", () => {
  it("splits if/then sentences", () => {
    expect(parseRule("if it has multiple users then it probably will require login")).toEqual({
      when: "If it has multiple users",
      then: "It probably will require login",
    });
    expect(parseRule("When a list is long -> add search")).toEqual({ when: "When a list is long", then: "Add search" });
  });
  it("treats anything else as always", () => {
    expect(parseRule("no duplicates.")).toEqual({ when: "Always", then: "No duplicates" });
  });
});

describe("adding and learning", () => {
  it("counts a repeat instead of adding it twice", () => {
    const p = emptyProfile(NOW);
    const before = p.rules.length;
    const next = addOwnRule(p, "Newest first, at the top", NOW);
    expect(next.rules.length).toBe(before);
    expect(next.rules.find((r) => r.id === "s-newest")?.said).toBe(1);
  });

  it("adds a learned rule switched on and marked new, and counts repeats", () => {
    let p = emptyProfile(NOW);
    p = mergeLearned(p, [{ when: "If it shows photos", then: "Show a photo preview when tapped", evidence: ["Oct 18: asked for previews"] }], NOW, 10);
    const r = p.rules[0];
    expect(r.source).toBe("learned");
    expect(r.on).toBe(true);
    expect(r.fresh).toBe(true);
    p = mergeLearned(p, [{ then: "Show a photo preview when tapped", evidence: ["Oct 19: again"] }], NOW + 1, 12);
    expect(p.rules.filter((x) => x.then === r.then)).toHaveLength(1);
    expect(p.rules.find((x) => x.id === r.id)?.said).toBe(2);
  });

  it("never learns back a removed rule", () => {
    let p = emptyProfile(NOW);
    p = removeRule(p, "s-search");
    p = mergeLearned(p, [{ then: "Add search or filters.", evidence: ["Oct 18: x"] }], NOW, 1);
    expect(p.rules.some((r) => r.id === "s-search" || /search or filters/i.test(r.then))).toBe(false);
    // …and starters don't come back on reload either
    expect(coerceProfile(p, NOW).rules.some((r) => r.id === "s-search")).toBe(false);
  });

  it("drops learned rules that have no evidence", () => {
    expect(coerceLearned({ rules: [{ then: "Use dark mode everywhere" }] })).toEqual([]);
    expect(coerceLearned({ rules: [{ then: "Use dark mode everywhere", evidence: ["Oct 1: asked"] }] })).toHaveLength(1);
  });

  it("matches the same rule however it's worded", () => {
    const p = emptyProfile(NOW);
    expect(matchingRule(p.rules, "No duplicates - the same item never shows twice")?.id).toBe("s-nodupes");
  });
});

describe("what Jarvis and Claude Code are given", () => {
  it("lists only rules that are on", () => {
    let p = emptyProfile(NOW);
    p = toggleRule(p, "s-search");
    const text = checklistPrompt(p);
    expect(text).not.toMatch(/search or filters/i);
    expect(text).toMatch(/no duplicates/i);
  });

  it("publishes a valid skill file", () => {
    const md = checklistSkill(emptyProfile(NOW));
    expect(md.startsWith("---\nname: website-build-checklist\ndescription: ")).toBe(true);
    expect(md).toMatch(/If more than one person will use it: Add sign-in/);
  });
});

describe("one checklist", () => {
  it("every starter has a unique code, a level and a check", async () => {
    const { STARTER_LINES } = await import("./checklist");
    const codes = STARTER_LINES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const l of STARTER_LINES) {
      expect(l.code).toMatch(/^[A-Z]\d+$/);
      expect(["Must", "Should", "Nice"]).toContain(l.level);
      expect(l.check.length).toBeGreaterThan(5);
    }
  });

  it("no two starter rules say the same thing", () => {
    const p = emptyProfile(NOW);
    for (const r of p.rules) {
      const others = p.rules.filter((o) => o.id !== r.id);
      expect(matchingRule(others, r.then)?.id, r.id).toBeUndefined();
    }
  });

  it("brings an older saved list up to date without losing the owner's switches", () => {
    const old = emptyProfile(NOW);
    const saved = {
      ...old,
      rules: old.rules
        .filter((r) => r.id === "s-plain" || r.id === "s-login")
        .map((r) => ({ ...r, then: "old wording", code: undefined, on: r.id === "s-plain" ? false : r.on, said: 4 })),
    };
    const p = coerceProfile(saved, NOW);
    const plain = p.rules.find((r) => r.id === "s-plain")!;
    expect(plain.code).toBe("R3");
    expect(plain.then).toMatch(/plain English/);
    expect(plain.on).toBe(false);
    expect(plain.said).toBe(4);
    expect(p.rules.find((r) => r.id === "s-r2")).toBeTruthy();
  });

  it("the published skill carries codes and checks", () => {
    const text = checklistSkill(emptyProfile(NOW));
    expect(text).toContain("[R2]");
    expect(text).toContain("check:");
    expect(text).toContain("Nicknames:");
  });
});
