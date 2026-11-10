import { describe, expect, it } from "vitest";

import { claimNext, finishStep, handOff, newAgent, type Agent, type AgentsDoc } from "./agents";
import { briefFor, describeAgents, nothingFor } from "./describe";

const T0 = Date.parse("2026-11-09T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function flux(): Agent {
  return newAgent({
    id: "a-flux",
    goal: "Draw the five hero images for Cook Connect",
    needs: ["pinokio"],
    steps: ["Draw the hero", "Draw four tiles"],
    at: iso(T0),
  });
}

describe("the brief a runner is handed", () => {
  it("puts the handoff note ABOVE the steps", () => {
    // A runner that reads the steps before the note starts at step one, and
    // the owner watches step one happen every morning forever.
    let doc: AgentsDoc = { agents: [flux()] };
    doc = handOff(doc, "a-flux", "laptop", "Hero done. Next: four tiles, seed 42.", iso(T0));
    const text = briefFor(doc.agents[0], T0);
    expect(text.indexOf("seed 42")).toBeLessThan(text.indexOf("STEPS"));
  });

  it("tells it plainly not to start again", () => {
    let doc: AgentsDoc = { agents: [flux()] };
    doc = handOff(doc, "a-flux", "laptop", "Half way.", iso(T0));
    expect(briefFor(doc.agents[0], T0)).toContain("Do not start again");
  });

  it("names agent_handoff as the thing to call before stopping", () => {
    // Without this line a runner just stops, and the agent looks idle for
    // twenty minutes until the lease expires.
    expect(briefFor(flux(), T0)).toContain("agent_handoff");
  });

  it("shows which steps are already done, with what came of them", () => {
    const doc = finishStep({ agents: [flux()] }, "a-flux", "s1", "laptop", "Saved to Storage.", iso(T0));
    const text = briefFor(doc.agents[0], T0);
    expect(text).toContain("[x] s1");
    expect(text).toContain("Saved to Storage.");
    expect(text).toContain("[ ] s2");
  });

  it("says what the agent needs, so a runner can tell why it got this one", () => {
    expect(briefFor(flux(), T0)).toContain("Pinokio");
  });

  it("carries the blocking reason when one is being retried", () => {
    const blocked = { ...flux(), blockedWhy: "Pinokio wasn't installed on the VPS." };
    expect(briefFor(blocked, T0)).toContain("Pinokio wasn't installed");
  });

  it("has no note section at all on a brand-new agent", () => {
    expect(briefFor(flux(), T0)).not.toContain("WHERE THE LAST MACHINE GOT TO");
  });
});

describe("the list", () => {
  it("says there is nothing rather than printing an empty list", () => {
    expect(describeAgents({ agents: [] }, T0)).toBe("No 24/7 agents right now.");
  });

  it("leaves finished agents out of a runner's list", () => {
    const doc: AgentsDoc = { agents: [{ ...flux(), status: "done" }] };
    expect(describeAgents(doc, T0)).toBe("No 24/7 agents right now.");
  });

  it("shows progress and needs on each line", () => {
    const doc = finishStep({ agents: [flux()] }, "a-flux", "s1", "laptop", "", iso(T0));
    const text = describeAgents(doc, T0);
    expect(text).toContain("1/2 steps");
    expect(text).toContain("Pinokio");
    expect(text).toContain("agent_next");
  });
});

describe("when there is nothing for this machine", () => {
  it("repeats back what the machine said it had, so a wrong claim is visible", () => {
    const { why } = claimNext({ agents: [flux()] }, "vps", ["shell"], T0);
    const text = nothingFor(why, ["shell"]);
    expect(text).toContain("Pinokio");
    expect(text).toContain("shell");
  });

  it("is still a sentence when the machine reported nothing", () => {
    expect(nothingFor(undefined, [])).toContain("nothing in particular");
  });
});
