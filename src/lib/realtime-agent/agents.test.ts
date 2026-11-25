import { describe, expect, it } from "vitest";
import { AGENTS, HEALTH_LABEL, agentById, isTalkable, needsConfirm, type AgentHealth } from "./agents";

describe("AGENTS", () => {
  it("holds the three agents the app switches between", () => {
    expect(AGENTS.map((a) => a.id)).toEqual(["3d", "local-face", "pod-face"]);
  });

  it("marks exactly one agent as costing money", () => {
    expect(AGENTS.filter((a) => a.billed).map((a) => a.id)).toEqual(["pod-face"]);
  });

  it("says what every agent needs, so none is silently broken", () => {
    for (const a of AGENTS) {
      expect(a.needs.length).toBeGreaterThan(0);
      expect(a.tag.length).toBeGreaterThan(0);
    }
  });
});

describe("agentById", () => {
  it("finds a known agent", () => {
    expect(agentById("pod-face")?.name).toBe("RunPod agent");
  });

  it("answers undefined for anything else, including a stored id from an older version", () => {
    expect(agentById("nope")).toBeUndefined();
    expect(agentById("")).toBeUndefined();
  });
});

describe("needsConfirm", () => {
  it("gates the billed agent", () => {
    expect(needsConfirm("pod-face")).toBe(true);
  });

  it("lets the free agents through", () => {
    expect(needsConfirm("3d")).toBe(false);
    expect(needsConfirm("local-face")).toBe(false);
  });

  it("does not gate an unknown id — it cannot spend money, so it must not look like it can", () => {
    expect(needsConfirm("made-up")).toBe(false);
  });
});

describe("isTalkable", () => {
  it("allows a ready or billing agent", () => {
    expect(isTalkable("ready")).toBe(true);
    expect(isTalkable("billing")).toBe(true);
  });

  it("blocks the rest", () => {
    expect(isTalkable("offline")).toBe(false);
    expect(isTalkable("starting")).toBe(false);
    expect(isTalkable("unset")).toBe(false);
  });
});

describe("HEALTH_LABEL", () => {
  it("labels every health state", () => {
    const states: AgentHealth[] = ["ready", "offline", "starting", "billing", "unset"];
    for (const s of states) expect(HEALTH_LABEL[s]).toBeTruthy();
  });

  it("says out loud when money is being spent", () => {
    expect(HEALTH_LABEL.billing.toLowerCase()).toContain("billing");
  });
});
