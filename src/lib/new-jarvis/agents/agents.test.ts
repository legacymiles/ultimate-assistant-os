import { describe, expect, it } from "vitest";

import {
  LEASE_MS,
  MAX_STEPS,
  addSteps,
  block,
  canRun,
  claimNext,
  cleanNeeds,
  finish,
  finishStep,
  handOff,
  liveCount,
  machineCan,
  missingFor,
  newAgent,
  nextFor,
  normalizeDoc,
  note,
  pause,
  progressOf,
  prune,
  renew,
  resume,
  sortAgents,
  statusLine,
  takeable,
  type Agent,
  type AgentsDoc,
} from "./agents";

const T0 = Date.parse("2026-11-09T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function docOf(...agents: Agent[]): AgentsDoc {
  return { agents };
}

function flux(over: Partial<Agent> = {}): Agent {
  return {
    ...newAgent({
      id: "a-flux",
      goal: "Draw the five hero images for Cook Connect",
      needs: ["pinokio"],
      steps: ["Draw the hero", "Draw four tiles"],
      at: iso(T0),
    }),
    ...over,
  };
}

describe("needs", () => {
  it("keeps only needs it knows, without duplicates", () => {
    expect(cleanNeeds(["pinokio", "pinokio", "nonsense", "blender"])).toEqual(["pinokio", "blender"]);
  });

  it("ignores a non-array", () => {
    expect(cleanNeeds("pinokio")).toEqual([]);
  });

  it("treats a GPU tool as proof of a GPU", () => {
    // A runner that reports Blender plainly has a card. Making it list "gpu"
    // as well would park GPU work forever on a machine that can do it.
    expect(machineCan(["blender"]).has("gpu")).toBe(true);
    expect(canRun(flux({ needs: ["gpu"] }), ["pinokio"])).toBe(true);
  });

  it("does not invent a tool from a bare GPU", () => {
    expect(canRun(flux(), ["gpu"])).toBe(false);
    expect(missingFor(flux(), ["gpu"])).toEqual(["pinokio"]);
  });

  it("lets any runner take an agent that needs nothing", () => {
    expect(canRun(flux({ needs: [] }), [])).toBe(true);
  });
});

describe("rule 1 — capability, not location", () => {
  it("never hands a runner a step it cannot run", () => {
    const doc = docOf(flux());
    expect(nextFor(doc, ["shell"], T0)).toBeNull();
    expect(nextFor(doc, ["pinokio"], T0)?.id).toBe("a-flux");
  });

  it("says in plain English what the machine is missing", () => {
    const { agent, why } = claimNext(docOf(flux()), "vps", ["shell"], T0);
    expect(agent).toBeNull();
    expect(why).toContain("Pinokio");
    expect(why).not.toMatch(/undefined|\bnull\b|Error/);
  });

  it("takes the longest-waiting agent, so nothing starves", () => {
    const old = flux({ id: "a-old", updatedAt: iso(T0 - 60_000) });
    const fresh = flux({ id: "a-new", updatedAt: iso(T0) });
    expect(nextFor(docOf(fresh, old), ["pinokio"], T0)?.id).toBe("a-old");
  });
});

describe("rule 2 — resume, not restart", () => {
  it("hands the next runner the note the last one left", () => {
    let doc = docOf(flux());
    doc = claimNext(doc, "laptop", ["pinokio"], T0).doc;
    doc = finishStep(doc, "a-flux", "s1", "laptop", "Hero done, saved to Storage.", iso(T0 + 1000));
    doc = handOff(doc, "a-flux", "laptop", "Hero is done. Next: the four tiles, same seed 42.", iso(T0 + 2000));

    const picked = claimNext(doc, "vps", ["pinokio"], T0 + 3000);
    expect(picked.agent?.handoff?.text).toContain("seed 42");
    expect(picked.agent?.steps.find((s) => s.id === "s1")?.done).toBe(true);
  });

  it("frees the agent when a runner hands off, rather than leaving it running", () => {
    let doc = docOf(flux());
    doc = claimNext(doc, "laptop", ["pinokio"], T0).doc;
    expect(doc.agents[0].status).toBe("running");

    doc = handOff(doc, "a-flux", "laptop", "Got half way.", iso(T0 + 1000));
    expect(doc.agents[0].status).toBe("waiting");
    expect(doc.agents[0].lease).toBeUndefined();
  });

  it("says it picked it back up, not that it started", () => {
    let doc = docOf(flux());
    doc = handOff(doc, "a-flux", "laptop", "Half way.", iso(T0));
    doc = claimNext(doc, "vps", ["pinokio"], T0 + 1000).doc;
    expect(doc.agents[0].log.at(-1)?.text).toBe("Picked it back up.");
  });
});

describe("rule 3 — one runner at a time", () => {
  it("refuses a second runner while the lease holds", () => {
    const first = claimNext(docOf(flux()), "laptop", ["pinokio"], T0);
    expect(first.agent?.id).toBe("a-flux");

    const second = claimNext(first.doc, "vps", ["pinokio"], T0 + 60_000);
    expect(second.agent).toBeNull();
    expect(second.why).toContain("another machine");
  });

  it("frees the work by itself when the lease expires", () => {
    const first = claimNext(docOf(flux()), "laptop", ["pinokio"], T0);
    const later = claimNext(first.doc, "vps", ["pinokio"], T0 + LEASE_MS + 1);
    expect(later.agent?.id).toBe("a-flux");
  });

  it("lets the holder renew while a long render runs", () => {
    let doc = claimNext(docOf(flux()), "laptop", ["pinokio"], T0).doc;
    doc = renew(doc, "a-flux", "laptop", T0 + LEASE_MS - 1000);
    expect(claimNext(doc, "vps", ["pinokio"], T0 + LEASE_MS + 1).agent).toBeNull();
  });

  it("will not let another machine renew someone else's lease", () => {
    let doc = claimNext(docOf(flux()), "laptop", ["pinokio"], T0).doc;
    const before = doc.agents[0].lease?.until;
    doc = renew(doc, "a-flux", "vps", T0 + 1000);
    expect(doc.agents[0].lease?.until).toBe(before);
  });
});

describe("what a runner may take", () => {
  it("leaves a paused agent alone", () => {
    const doc = pause(docOf(flux()), "a-flux", iso(T0));
    expect(takeable(doc.agents[0], ["pinokio"], T0)).toBe(false);
    expect(claimNext(doc, "laptop", ["pinokio"], T0).why).toContain("paused");
  });

  it("picks a resumed agent back up", () => {
    let doc = pause(docOf(flux()), "a-flux", iso(T0));
    doc = resume(doc, "a-flux", iso(T0 + 1000));
    expect(takeable(doc.agents[0], ["pinokio"], T0 + 2000)).toBe(true);
  });

  it("leaves a finished agent alone", () => {
    const doc = finish(docOf(flux()), "a-flux", "laptop", "All five drawn.", iso(T0));
    expect(takeable(doc.agents[0], ["pinokio"], T0)).toBe(false);
  });

  it("does not hand out an agent with no steps left", () => {
    let doc = docOf(flux());
    doc = finishStep(doc, "a-flux", "s1", "laptop", "", iso(T0));
    doc = finishStep(doc, "a-flux", "s2", "laptop", "", iso(T0));
    expect(nextFor(doc, ["pinokio"], T0 + 1000)).toBeNull();
    expect(claimNext(doc, "vps", ["pinokio"], T0 + 1000).why).toContain("next step");
  });

  it("lets another machine try one that is blocked", () => {
    // What blocks an agent is usually a key the next machine may well have.
    const doc = block(docOf(flux()), "a-flux", "laptop", "No Pinokio on this box.", iso(T0));
    expect(takeable(doc.agents[0], ["pinokio"], T0 + 1000)).toBe(true);
  });
});

describe("steps and progress", () => {
  it("counts progress and never reads 100 before it is done", () => {
    let doc = docOf(flux());
    expect(progressOf(doc.agents[0])).toEqual({ done: 0, total: 2, pct: 0 });
    doc = finishStep(doc, "a-flux", "s1", "laptop", "Hero done.", iso(T0));
    expect(progressOf(doc.agents[0])).toEqual({ done: 1, total: 2, pct: 50 });
  });

  it("reads 100 when it is finished, whatever the steps say", () => {
    const doc = finish(docOf(flux()), "a-flux", "laptop", "Done.", iso(T0));
    expect(progressOf(doc.agents[0]).pct).toBe(100);
  });

  it("has no divide-by-zero on an agent with no steps", () => {
    expect(progressOf(flux({ steps: [] })).pct).toBe(0);
  });

  it("ticks a step only once, keeping the first finisher", () => {
    let doc = finishStep(docOf(flux()), "a-flux", "s1", "laptop", "First.", iso(T0));
    doc = finishStep(doc, "a-flux", "s1", "vps", "Second.", iso(T0 + 1000));
    expect(doc.agents[0].steps[0].by).toBe("laptop");
    expect(doc.agents[0].steps[0].note).toBe("First.");
  });

  it("takes on work discovered while running", () => {
    const doc = addSteps(docOf(flux()), "a-flux", ["Upscale them", "Post to the hub"], iso(T0));
    expect(doc.agents[0].steps.map((s) => s.text)).toContain("Upscale them");
    expect(new Set(doc.agents[0].steps.map((s) => s.id)).size).toBe(4);
  });

  it("will not grow past the step cap", () => {
    const many = Array.from({ length: MAX_STEPS + 10 }, (_, i) => `step ${i}`);
    const doc = addSteps(docOf(flux()), "a-flux", many, iso(T0));
    expect(doc.agents[0].steps.length).toBe(MAX_STEPS);
  });

  it("marks every step done when the goal is met early", () => {
    const doc = finish(docOf(flux()), "a-flux", "laptop", "Turned out one image covered it.", iso(T0));
    expect(doc.agents[0].steps.every((s) => s.done)).toBe(true);
  });
});

describe("what the owner reads", () => {
  it("names the machine it is waiting for, rather than looking busy", () => {
    expect(statusLine(flux(), T0)).toContain("Pinokio");
  });

  it("says who is working on it", () => {
    const doc = claimNext(docOf(flux()), "your laptop", ["pinokio"], T0);
    expect(statusLine(doc.agent!, T0)).toBe("your laptop is working on it now.");
  });

  it("shows the blocking reason verbatim, with no code in it (R3)", () => {
    const doc = block(docOf(flux()), "a-flux", "laptop", "Pinokio isn't running.", iso(T0));
    expect(statusLine(doc.agents[0], T0)).toBe("Pinokio isn't running.");
  });

  it("mentions how far it got when it is part way", () => {
    const doc = finishStep(docOf(flux()), "a-flux", "s1", "laptop", "", iso(T0));
    expect(statusLine(doc.agents[0], T0 + 1000)).toContain("1 of 2");
  });

  it("puts live work above finished work", () => {
    const done = finish(docOf(flux({ id: "a-done" })), "a-done", "laptop", "", iso(T0 + 9999)).agents[0];
    const live = flux({ id: "a-live", updatedAt: iso(T0) });
    expect(sortAgents([done, live]).map((a) => a.id)).toEqual(["a-live", "a-done"]);
  });

  it("counts only live agents for the tab badge", () => {
    const doc = finish(docOf(flux(), flux({ id: "a-2" })), "a-2", "laptop", "", iso(T0));
    expect(liveCount(doc)).toBe(1);
  });
});

describe("the document", () => {
  it("survives junk from the store", () => {
    expect(normalizeDoc(null)).toEqual({ agents: [] });
    expect(normalizeDoc({ agents: "nope" })).toEqual({ agents: [] });
    expect(normalizeDoc({ agents: [{ id: "a-1" }] }).agents).toEqual([]); // no goal
  });

  it("keeps one copy when the same agent arrives twice (D5)", () => {
    const a = flux();
    expect(normalizeDoc({ agents: [a, a] }).agents.length).toBe(1);
  });

  it("round-trips an agent through the store unchanged", () => {
    let doc = claimNext(docOf(flux()), "laptop", ["pinokio"], T0).doc;
    doc = handOff(doc, "a-flux", "laptop", "Half done.", iso(T0 + 1000));
    const back = normalizeDoc(JSON.parse(JSON.stringify(doc)));
    expect(back.agents[0].handoff?.text).toBe("Half done.");
    expect(back.agents[0].needs).toEqual(["pinokio"]);
  });

  it("forgets agents finished a fortnight ago, keeping live ones", () => {
    const old = finish(docOf(flux({ id: "a-old" })), "a-old", "laptop", "", iso(T0 - 30 * 864e5)).agents[0];
    const doc = prune(docOf(old, flux({ id: "a-live" })), T0);
    expect(doc.agents.map((a) => a.id)).toEqual(["a-live"]);
  });

  it("keeps a recently finished agent so 'did that get done?' has an answer", () => {
    const recent = finish(docOf(flux({ id: "a-r" })), "a-r", "laptop", "", iso(T0 - 864e5)).agents[0];
    expect(prune(docOf(recent), T0).agents.length).toBe(1);
  });

  it("caps the log instead of growing forever", () => {
    let doc = docOf(flux());
    for (let i = 0; i < 200; i += 1) doc = note(doc, "a-flux", "laptop", `line ${i}`, iso(T0 + i));
    expect(doc.agents[0].log.length).toBeLessThanOrEqual(60);
    expect(doc.agents[0].log.at(-1)?.text).toBe("line 199");
  });

  it("trims a goal rather than storing a novel (S4)", () => {
    const a = newAgent({ goal: "x".repeat(9000), at: iso(T0) });
    expect(a.goal.length).toBeLessThanOrEqual(2000);
  });

  it("leaves other agents untouched when one changes", () => {
    const doc = note(docOf(flux(), flux({ id: "a-2" })), "a-flux", "laptop", "hi", iso(T0));
    expect(doc.agents[1].log.length).toBe(1);
  });
});
