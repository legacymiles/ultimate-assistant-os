import { describe, expect, it } from "vitest";
import { dayPlan, fourCs, inferConnections, newProfile } from "./model";
import { coerceProfile, exportFiles } from "./export";
import { heuristicFocus } from "./focus";
import { isConcretePriority, voiceWarning } from "./questions";

describe("inferConnections", () => {
  it("maps intake answers onto the kit's domains and infers the calendar", () => {
    const p = newProfile("Sam");
    p.intake.q4 = "Stripe, tracked in a Google Sheet";
    p.intake.q5 = "Gmail and Slack";
    p.intake.q6 = "Notion";
    p.intake.q7 = "Invoicing. Tasks in Linear";
    const c = inferConnections(p.intake, p.connections);
    const tool = (d: string) => c.find((x) => x.domain === d)!.tool;
    expect(tool("Revenue / Financials")).toBe("Stripe, Google Sheet");
    expect(tool("Calendar")).toBe("Google Calendar");
    expect(tool("Communication")).toBe("Gmail, Slack");
    expect(tool("Knowledge / files")).toBe("Notion");
    expect(tool("Project / task tracking")).toBe("Linear");
  });

  it("reads 'none yet' answers as none, without eating tool names like Notion", () => {
    const p = newProfile("Sam");
    p.intake.q4 = "No revenue yet";
    p.intake.q6 = "Notion";
    const c = inferConnections(p.intake, p.connections);
    expect(c[0].tool).toBe("None yet");
    expect(c.find((x) => x.domain === "Knowledge / files")!.tool).toBe("Notion");
  });

  it("never overwrites a tool the person typed themselves", () => {
    const p = newProfile("Sam");
    p.connections[0].tool = "My own ledger";
    p.intake.q4 = "Stripe";
    expect(inferConnections(p.intake, p.connections)[0].tool).toBe("My own ledger");
  });
});

describe("fourCs", () => {
  it("is zero for a blank profile and rises with real setup", () => {
    const p = newProfile("Sam");
    expect(fourCs(p).reduce((s, l) => s + l.score, 0)).toBe(0);
    p.intake.q1 = "I run a small bakery that sells sourdough to cafés across the city.";
    p.connections[0] = { ...p.connections[0], tool: "Stripe", mechanism: "mcp", lastChecked: new Date().toISOString().slice(0, 10) };
    const [context, connections] = fourCs(p);
    expect(context.score).toBe(8);
    expect(connections.score).toBe(4); // one of seven domains, fully wired and fresh
  });

  it("credits a routine more once it has actually run", () => {
    const p = newProfile("Sam");
    p.routines = [{ id: "a", name: "Brief", schedule: "daily", lastRun: "" }];
    const unproven = fourCs(p)[3].score;
    p.routines[0].lastRun = new Date().toISOString().slice(0, 10);
    expect(fourCs(p)[3].score).toBeGreaterThan(unproven);
  });
});

describe("dayPlan", () => {
  it("counts days from creation", () => {
    const p = newProfile("Sam");
    const now = Date.parse(p.createdAt) + 6.5 * 86_400_000;
    expect(dayPlan(p, now).day).toBe(7);
  });
});

describe("export + import", () => {
  it("round-trips a profile through JSON and writes the Day-1 file set", () => {
    const p = newProfile("Sam");
    p.intake.q1 = "Baker.";
    p.intake.q3 = ["Open second shop by March", "", ""];
    const paths = exportFiles(p).map((f) => f.path);
    expect(paths).toContain("CLAUDE.md");
    expect(paths).toContain("connections.md");
    expect(exportFiles(p)[0].content).toContain("Open second shop by March");

    const back = coerceProfile(JSON.parse(JSON.stringify(p)))!;
    expect(back.name).toBe("Sam");
    expect(back.intake.q3[0]).toBe("Open second shop by March");
    expect(back.id).not.toBe(p.id);
    expect(back.connections).toHaveLength(7);
  });

  it("rejects junk", () => {
    expect(coerceProfile(null)).toBeNull();
    expect(coerceProfile({ intake: {} })).toBeNull();
  });
});

describe("onboarding rules", () => {
  it("pushes back on vague priorities", () => {
    expect(isConcretePriority("grow my business")).toBe(false);
    expect(isConcretePriority("Hit 100 subscribers")).toBe(true);
    expect(isConcretePriority("Ship the app by October")).toBe(true);
  });

  it("warns when a voice sample was typed rather than pasted", () => {
    expect(voiceWarning(200, false)).not.toBeNull();
    expect(voiceWarning(200, true)).toBeNull();
    expect(voiceWarning(10, false)).toBeNull();
  });

  it("answers the focus question offline from open priorities", () => {
    const p = newProfile("Sam");
    p.intake.q3 = ["Open second shop by March", "Hire a baker by May", ""];
    p.prioritiesDone = [0];
    const f = heuristicFocus(p);
    expect(f.monday).toContain("Hire a baker");
    expect(f.ai).toBe(false);
  });
});
