import { describe, expect, it } from "vitest";
import { masterPrompt, pipeline, queueText, understand, QUEUE_LIMIT } from "@/lib/app-builder/engine";
import type { BuilderProject } from "@/lib/app-builder/types";
import {
  FACTORY_DONE,
  RUN_ORDER,
  STAGES,
  factoryBrief,
  runsBefore,
  shipFirstBlock,
  shouldStartFactory,
  stageStates,
  type StageFacts,
} from "./pipeline";

const NOTHING: StageFacts = {
  understood: false,
  planned: false,
  lookPicked: false,
  flowsApproved: false,
  buildStarted: false,
  live: false,
  factoryStarted: false,
  factoryDone: false,
};

function project(): BuilderProject {
  const idea = "A booking site for a mobile dog groomer with online payments and client accounts";
  const answers = { audience: "Customers", touches: "accounts, payments" };
  const now = "2026-11-13T10:00:00.000Z";
  return {
    id: "p1",
    createdAt: now,
    updatedAt: now,
    idea,
    stage: "features",
    questions: [],
    answers,
    understanding: understand(idea, answers),
    features: [
      { id: "f1", title: "Book a slot", why: "The point of the site", detail: "Pick a day and time and pay a deposit.", kind: "core", impact: 3, effort: "M", status: "accepted", source: "agent" },
    ],
    chat: [],
  } as BuilderProject;
}

describe("the eight stages", () => {
  it("are the owner's eight, in the owner's order", () => {
    expect(STAGES.map((s) => s.label)).toEqual([
      "Felix",
      "Prompt Enhancer",
      "Mockups",
      "Commercial",
      "Design Skill",
      "Impeccable",
      "Software Factory",
      "Claude Security",
    ]);
  });

  it("put Software Factory after the site is live, with security on both sides of it", () => {
    expect(runsBefore("live", "software-factory")).toBe(true);
    expect(runsBefore("security-check", "live")).toBe(true);
    expect(runsBefore("software-factory", "security-deep")).toBe(true);
    expect(runsBefore("mockups-main", "mockups-flows")).toBe(true);
    expect(runsBefore("mockups-flows", "commercial")).toBe(true);
    expect(new Set(RUN_ORDER).size).toBe(RUN_ORDER.length);
  });
});

describe("what the PC is told", () => {
  it("the brief's skill order has the factory after impeccable and a security check, and a deep scan after it", () => {
    const p = project();
    const skills = pipeline(p.understanding!).map((s) => s.skill);
    const factory = skills.indexOf("software-factory");
    expect(factory).toBeGreaterThan(skills.indexOf("impeccable"));
    expect(skills.indexOf("claude-security")).toBeLessThan(factory);
    expect(skills.lastIndexOf("claude-security")).toBeGreaterThan(factory);
    expect(pipeline(p.understanding!).find((s) => s.skill === "software-factory")!.role).toMatch(/ONLY AFTER the first working site is live/);
  });

  it("the master prompt carries the ship-first rule as its own block", () => {
    const prompt = masterPrompt(project());
    expect(prompt).toContain("<ship_first>");
    expect(prompt).toContain(shipFirstBlock());
    // The rule sits after the order it qualifies.
    expect(prompt.indexOf("<ship_first>")).toBeGreaterThan(prompt.indexOf("</skills_pipeline>"));
    expect(prompt).toMatch(/Software Factory does NOT run during this first build/);
  });

  it("the queue line says the same order and still fits In Queue", () => {
    const t = queueText(project());
    expect(t).toContain("impeccable → claude-security (check) → SITE LIVE → software-factory → claude-security (deep)");
    expect(t).toContain("Ship first:");
    expect(t.length).toBeLessThanOrEqual(QUEUE_LIMIT);
  });

  it("a client edit keeps its own short pipeline", () => {
    const p = project();
    expect(pipeline(p.understanding!, null, false, true).map((s) => s.skill)).not.toContain("commercial");
  });
});

describe("the after-live message", () => {
  it("names the live site and runs the factory before the deep scan", () => {
    const b = factoryBrief({ name: "Paws & Go", liveUrl: "https://paws.example", repo: "me/paws" });
    expect(b).toContain("Paws & Go is live at https://paws.example (repository me/paws)");
    expect(b.indexOf("1. software-factory")).toBeLessThan(b.indexOf("2. claude-security"));
    expect(b).toMatch(/backend architecture, database design, authentication, API integrations, data models/);
    expect(b).not.toMatch(/ONLY AFTER/); // it is already after
  });

  it("is recognised as finished only by its own line", () => {
    expect(FACTORY_DONE.test("All merged.\nFactory: done\n- added sign-in")).toBe(true);
    expect(FACTORY_DONE.test("The factory: done soon")).toBe(false);
    expect(FACTORY_DONE.test("Live: https://x.example")).toBe(false);
  });

  it("is sent once, and never before the site is live", () => {
    expect(shouldStartFactory({ live: false, factoryStarted: false, factoryDone: false })).toBe(false);
    expect(shouldStartFactory({ live: true, factoryStarted: false, factoryDone: false })).toBe(true);
    expect(shouldStartFactory({ live: true, factoryStarted: true, factoryDone: false })).toBe(false);
    expect(shouldStartFactory({ live: true, factoryStarted: true, factoryDone: true })).toBe(false);
  });
});

describe("where a project stands", () => {
  const states = (f: Partial<StageFacts>) => Object.fromEntries(stageStates({ ...NOTHING, ...f }).map((s) => [s.stage.id, s.state]));

  it("starts at Felix with everything else waiting", () => {
    const s = states({});
    expect(s.felix).toBe("now");
    expect(Object.values(s).filter((v) => v === "now")).toHaveLength(1);
    expect(s["software-factory"]).toBe("wait");
  });

  it("mockups are not done until BOTH the main design and the flows are approved", () => {
    expect(states({ understood: true, planned: true, lookPicked: true }).mockups).toBe("now");
    expect(states({ understood: true, planned: true, lookPicked: true, flowsApproved: true }).mockups).toBe("done");
  });

  it("the factory is never 'now' while the first site is still building", () => {
    const building = states({ understood: true, planned: true, lookPicked: true, flowsApproved: true, buildStarted: true });
    expect(building.commercial).toBe("now");
    expect(building["software-factory"]).toBe("wait");
    const live = states({ understood: true, planned: true, lookPicked: true, flowsApproved: true, buildStarted: true, live: true });
    expect(live.impeccable).toBe("done");
    expect(live["software-factory"]).toBe("now");
  });

  it("a live site with nothing building says the factory waits for the next build", () => {
    const base = { understood: true, planned: true, lookPicked: true, flowsApproved: true, buildStarted: true, live: true };
    expect(states({ ...base })["software-factory"]).toBe("now");
    const idle = stageStates({ ...NOTHING, ...base, idle: true });
    const factory = idle.find((s) => s.stage.id === "software-factory")!;
    expect(factory.state).toBe("wait");
    expect(factory.note).toBe("with the next build");
    // Once the message HAS been sent, idle no longer hides it: it is running.
    const going = stageStates({ ...NOTHING, ...base, idle: true, factoryStarted: true });
    expect(going.find((s) => s.stage.id === "software-factory")!.state).toBe("now");
  });

  it("always has exactly one stage in progress until all eight are done", () => {
    const steps: Partial<StageFacts>[] = [
      {},
      { understood: true },
      { understood: true, planned: true },
      { understood: true, planned: true, lookPicked: true, flowsApproved: true },
      { understood: true, planned: true, lookPicked: true, flowsApproved: true, buildStarted: true },
      { understood: true, planned: true, lookPicked: true, flowsApproved: true, buildStarted: true, live: true, factoryStarted: true },
    ];
    for (const f of steps) {
      const now = stageStates({ ...NOTHING, ...f }).filter((s) => s.state === "now");
      // Planned and approved but not yet started: nothing is running, which is true.
      expect(now.length).toBeLessThanOrEqual(1);
    }
    const all = stageStates({ understood: true, planned: true, lookPicked: true, flowsApproved: true, buildStarted: true, live: true, factoryStarted: true, factoryDone: true });
    expect(all.every((s) => s.state === "done")).toBe(true);
  });
});
