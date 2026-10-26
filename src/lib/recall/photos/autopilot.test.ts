import { beforeEach, describe, expect, it, vi } from "vitest";

// Same minimal window as toolUsage.test.ts: appState needs localStorage, and
// the store announces writes with dispatchEvent.
const store = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
});

import { addRule, getAutopilot, learnFromApprovals, learnFromMisses, removeRule, standingGuidance, toggleRule } from "./autopilot";
import { photoConfidence, rawConfidence } from "./confidence";
import type { PendingPhoto } from "./types";

beforeEach(() => store.clear());

function photo(over: Partial<PendingPhoto> & { tags?: string[]; title?: string; path?: string[] }): PendingPhoto {
  return {
    id: Math.random().toString(36),
    fileId: "f",
    name: "IMG_1.jpg",
    type: "image/jpeg",
    size: 1,
    addedAt: "",
    status: "ready",
    destPath: over.path ?? ["Receipts"],
    overridden: over.overridden,
    analysis: {
      route: "info",
      title: over.title ?? "Receipt",
      caption: "",
      people: [],
      unknownPeople: 0,
      tags: over.tags ?? ["receipt"],
      engine: over.analysis?.engine ?? "ai",
      confidence: over.analysis?.confidence,
    },
    userPrompt: over.userPrompt,
    duplicateOf: over.duplicateOf,
  };
}

describe("Camera Autopilot rules", () => {
  it("says nothing when nothing has been learned, so a fresh prompt is unchanged", () => {
    expect(standingGuidance()).toBe("");
  });

  it("dedupes a rule told twice and switches it back on", () => {
    const first = addRule("Song images go to my Classifier");
    toggleRule(first.rules[0].id);
    expect(getAutopilot().rules[0].on).toBe(false);
    addRule("song images go to my classifier!");
    const after = getAutopilot();
    expect(after.rules).toHaveLength(1);
    expect(after.rules[0].on).toBe(true);
  });

  it("only sends switched-on rules to the model", () => {
    const d = addRule("Receipts go to Folders › Receipts");
    addRule("Repos go to Folders › Repos");
    toggleRule(d.rules[0].id);
    const g = standingGuidance();
    expect(g).toContain("Repos go to Folders");
    expect(g).not.toContain("Receipts go to");
  });

  it("can delete a rule", () => {
    const d = addRule("Memes stay in the camera roll");
    removeRule(d.rules[0].id);
    expect(getAutopilot().rules).toHaveLength(0);
  });
});

describe("learning from filing", () => {
  it("records each filed photo as an example the model sees", () => {
    learnFromApprovals([photo({ title: "Home Depot receipt", tags: ["receipt"], overridden: true })]);
    const g = standingGuidance();
    expect(g).toContain("Home Depot receipt [receipt] → Receipts");
    expect(g).toContain("corrected");
  });

  it("turns a repeated tag-to-place habit into a visible learned rule", () => {
    for (let i = 0; i < 3; i++) learnFromApprovals([photo({ tags: ["receipt"], path: ["Receipts"] })]);
    const rule = getAutopilot().rules.find((r) => r.source === "learned");
    expect(rule?.text).toBe('Images tagged "receipt" go to Receipts');
  });

  it("never auto-rules photos of people", () => {
    for (let i = 0; i < 4; i++) learnFromApprovals([photo({ tags: ["family"], path: ["Photos", "My Little Family"] })]);
    expect(getAutopilot().rules).toHaveLength(0);
  });

  it("learns nothing from an empty approval", () => {
    learnFromApprovals([]);
    expect(getAutopilot().examples).toHaveLength(0);
  });
});

describe("confidence that teaches itself", () => {
  const sure = () => photo({ analysis: { confidence: 0.9 } as PendingPhoto["analysis"] });

  it("starts as the model's own read", () => {
    expect(photoConfidence(sure(), "Receipts", [])?.score).toBe(90);
  });

  it("drops for a destination the owner keeps moving photos away from", () => {
    for (let i = 0; i < 8; i++) learnFromApprovals([photo({ overridden: true, analysis: { confidence: 0.9 } as PendingPhoto["analysis"] })]);
    const c = photoConfidence(sure(), "Receipts", getAutopilot().outcomes ?? []);
    expect(c!.score).toBeLessThan(60);
  });

  it("rises when the owner keeps filing it as guessed", () => {
    for (let i = 0; i < 8; i++) learnFromApprovals([photo({ analysis: { confidence: 0.55 } as PendingPhoto["analysis"] })]);
    const c = photoConfidence(photo({ analysis: { confidence: 0.55 } as PendingPhoto["analysis"] }), "Receipts", getAutopilot().outcomes ?? []);
    expect(c!.score).toBeGreaterThan(75);
  });

  it("removing a photo counts as a miss", () => {
    learnFromMisses([sure()]);
    expect(getAutopilot().outcomes?.at(-1)?.ok).toBe(false);
  });

  it("knows what the queue already doubts", () => {
    expect(rawConfidence(photo({ analysis: { engine: "heuristic" } as PendingPhoto["analysis"] }))).toBe(0.15);
    expect(rawConfidence(photo({ duplicateOf: { label: "x", identical: true }, analysis: { confidence: 1 } as PendingPhoto["analysis"] }))).toBe(0.6);
  });

  it("a place the owner chose by hand is certain, and nothing is scored while reading", () => {
    expect(photoConfidence(photo({ overridden: true }), "Receipts", [])?.score).toBe(99);
    expect(photoConfidence({ ...sure(), status: "analyzing" }, "", [])).toBeNull();
  });
});
