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

import { addRule, getAutopilot, learnFromApprovals, removeRule, standingGuidance, toggleRule } from "./autopilot";
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
      engine: "ai",
    },
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
