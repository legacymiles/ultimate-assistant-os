import { describe, expect, it } from "vitest";
import { understand } from "@/lib/app-builder/engine";
import type { Feature } from "@/lib/app-builder/types";
import {
  approve,
  canApprove,
  checkFlows,
  draftFlows,
  flowsBrief,
  flowsLine,
  HOME_ID,
  noteScreen,
  replaceScreen,
  routeOf,
  screenName,
  type FlowPlan,
} from "./flows";

function feature(id: string, title: string, detail: string): Feature {
  return { id, title, why: "The point of the site", detail, kind: "core", impact: 3, effort: "M", status: "accepted", source: "agent" };
}

const U = understand("A booking site for a mobile dog groomer with online payments and client accounts", {
  audience: "Dog owners",
});

const FEATURES = [
  feature("f1", "Book a slot", "Browse open times, pick one and pay a deposit."),
  feature("f2", "My bookings", "A list of everything coming up, with history."),
  feature("f3", "Contact", "Send a question and get an answer by email."),
];

const PLAN = draftFlows(U, FEATURES, "interactive-web-studio");

describe("a plan written from the accepted features", () => {
  it("has a home and one screen per feature, each with its own route", () => {
    expect(PLAN.screens[0].id).toBe(HOME_ID);
    expect(PLAN.screens[0].route).toBe("/");
    expect(PLAN.screens).toHaveLength(FEATURES.length + 1);
    expect(new Set(PLAN.screens.map((s) => s.route)).size).toBe(PLAN.screens.length);
  });

  it("is a graph: home links to every screen, and every screen links back", () => {
    expect(PLAN.screens[0].links.map((l) => l.to).sort()).toEqual(PLAN.screens.slice(1).map((s) => s.id).sort());
    for (const s of PLAN.screens.slice(1)) expect(s.links.some((l) => l.to === HOME_ID)).toBe(true);
  });

  it("gives a screen the states it really has, not a fixed set", () => {
    const book = PLAN.screens.find((s) => s.id === "book-a-slot")!;
    const list = PLAN.screens.find((s) => s.id === "my-bookings")!;
    expect(book.states).toContain("success"); // you can finish booking
    expect(list.states).toContain("empty"); // a list can be empty
    expect(PLAN.screens[0].states).toContain("ready");
  });

  it("gives home the states its own words ask for, so it never complains about itself", () => {
    expect(checkFlows(PLAN).filter((p) => p.where === "Home")).toEqual([]);
    const plain = draftFlows({ ...U, oneLiner: "Hand-thrown pots, one of a kind" }, FEATURES, "taste-skill");
    expect(plain.screens[0].states).toEqual(["ready"]);
    expect(checkFlows(plain).filter((p) => p.where === "Home")).toEqual([]);
  });

  it("names a screen as a destination, never a dangling phrase", () => {
    expect(screenName("Share links with friends")).toBe("Share links");
    expect(screenName("First win in under a minute")).toBe("First win");
    expect(screenName("Book a slot")).toBe("Book a slot");
    expect(screenName("Sign in and manage your account")).toBe("Sign in");
    expect(screenName("Pricing")).toBe("Pricing");
    // Never ends on a word that leaves the sentence open.
    for (const s of PLAN.screens) expect(s.name).not.toMatch(/\b(in|with|to|for|a|an|the|and|or|of|your|my)$/i);
  });

  it("walks a journey through screens that exist", () => {
    expect(PLAN.journeys.length).toBeGreaterThan(0);
    for (const j of PLAN.journeys) {
      expect(j.steps[0]).toBe(HOME_ID);
      for (const step of j.steps) expect(PLAN.screens.some((s) => s.id === step)).toBe(true);
    }
  });

  it("needs no model, and says so", () => {
    expect(PLAN.engine).toBe("offline");
    expect(draftFlows(U, [], "taste-skill").screens).toHaveLength(1);
  });

  it("makes a route out of any name, once", () => {
    expect(routeOf("My bookings")).toBe("/my-bookings");
    expect(routeOf("Anything", true)).toBe("/");
  });
});

describe("a pile of screenshots cannot be approved", () => {
  it("passes a connected plan", () => {
    expect(checkFlows(PLAN).filter((p) => p.fatal)).toEqual([]);
    expect(canApprove(PLAN)).toBe(true);
  });

  it("fails a link that points nowhere", () => {
    const broken: FlowPlan = {
      ...PLAN,
      screens: PLAN.screens.map((s) => (s.id === HOME_ID ? { ...s, links: [{ label: "Prices", to: "prices" }] } : s)),
    };
    const fatal = checkFlows(broken).filter((p) => p.fatal);
    expect(fatal.some((p) => /doesn't exist/.test(p.text))).toBe(true);
    expect(canApprove(broken)).toBe(false);
  });

  it("fails a screen nothing can reach", () => {
    const orphan: FlowPlan = {
      ...PLAN,
      screens: [
        ...PLAN.screens.map((s) => (s.id === HOME_ID ? s : { ...s, links: [] })),
        { id: "secret", name: "Secret", purpose: "Nobody can get here", route: "/secret", content: [], links: [], states: ["ready"] },
      ],
    };
    expect(checkFlows(orphan).some((p) => p.fatal && /can't be reached/.test(p.text))).toBe(true);
  });

  it("fails two screens sharing one route, and a screen with no ready state", () => {
    const clash: FlowPlan = { ...PLAN, screens: PLAN.screens.map((s) => ({ ...s, route: "/" })) };
    expect(checkFlows(clash).some((p) => p.fatal && /Shares the route/.test(p.text))).toBe(true);
    const blind: FlowPlan = { ...PLAN, screens: PLAN.screens.map((s) => ({ ...s, states: [] })) };
    expect(checkFlows(blind).some((p) => p.fatal && /no ready state/.test(p.text))).toBe(true);
  });

  it("says a missing empty state is worth fixing, without blocking the plan", () => {
    const thin: FlowPlan = {
      ...PLAN,
      screens: PLAN.screens.map((s) => (s.name === "My bookings" ? { ...s, states: ["ready" as const] } : s)),
    };
    const problems = checkFlows(thin);
    expect(problems.some((p) => !p.fatal && /nothing yet state/i.test(p.text))).toBe(true);
    expect(canApprove(thin)).toBe(true);
  });
});

describe("revising one screen", () => {
  it("keeps the others, and un-approves the plan", () => {
    const approved = approve(PLAN, "2026-11-13T10:00:00.000Z");
    expect(approved.approvedAt).toBe("2026-11-13T10:00:00.000Z");
    const noted = noteScreen(approved, "book-a-slot", "Put the price next to the Book button");
    expect(noted.approvedAt).toBeUndefined();
    expect(noted.screens.find((s) => s.id === "book-a-slot")!.note).toContain("price");
    expect(noted.screens.filter((s) => s.note)).toHaveLength(1);
  });

  it("replaces a screen in place and clears its note", () => {
    const noted = noteScreen(PLAN, "contact", "Add a phone number");
    const screen = { ...noted.screens.find((s) => s.id === "contact")!, content: ["Call us", "Or send a note"] };
    const next = replaceScreen(noted, screen);
    expect(next.screens.find((s) => s.id === "contact")!.content).toEqual(["Call us", "Or send a note"]);
    expect(next.screens.find((s) => s.id === "contact")!.note).toBeUndefined();
    expect(next.screens).toHaveLength(noted.screens.length);
  });
});

describe("what the build is told", () => {
  const brief = flowsBrief(PLAN);

  it("writes every route with where it goes and what states to build", () => {
    expect(brief).toContain("<pages_and_flows>");
    for (const s of PLAN.screens) expect(brief).toContain(`${s.route} — ${s.name}`);
    expect(brief).toMatch(/Goes to: .*→ \//);
    expect(brief).toMatch(/States to build: loading, empty, error/);
  });

  it("names the one design system every screen is drawn in", () => {
    expect(brief).toContain("interactive-web-studio");
  });

  it("says in as many words that a screenshot is not the deliverable", () => {
    expect(brief).toMatch(/not pictures/i);
    expect(brief).toMatch(/actual navigation, the actual state and the actual behaviour/);
    expect(brief).toMatch(/cannot be walked in the browser is not done/);
  });

  it("carries the owner's note on a screen into the brief", () => {
    expect(flowsBrief(noteScreen(PLAN, "book-a-slot", "Deposit must be optional"))).toContain("The owner asked: Deposit must be optional");
  });

  it("fits the queue in one line, and is empty when there is no plan", () => {
    expect(flowsLine(PLAN)).toContain("/my-bookings");
    expect(flowsLine(PLAN).length).toBeLessThan(400);
    expect(flowsLine({ ...PLAN, screens: [] })).toBe("");
    expect(flowsBrief({ ...PLAN, screens: [] })).toBe("");
  });
});
