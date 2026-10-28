import { describe, expect, it } from "vitest";
import { queueRequestText } from "../queueText";
import {
  BRIEF_ROOM,
  MAKER_FOLDER,
  buildBrief,
  checkBlueprint,
  coerceBlueprint,
  draftBlueprint,
  parseBlueprint,
  slugOf,
  type Blueprint,
} from "./blueprint";

describe("draftBlueprint (no AI)", () => {
  it("starts a clipping request from the clipping template", () => {
    const bp = draftBlueprint("make me the thing in this video where people make money clipping podcasts", ["video"]);
    expect(bp.name).toBe("Clip Engine");
    // "make money" → an agent that does it, living as its own agent page.
    expect(bp.kind).toBe("agent");
    expect(bp.home).toBe("agent");
    expect(draftBlueprint("turn podcast clips into shorts").home).toBe("studio");
    expect(bp.stages.every((s) => s.on)).toBe(true);
    expect(bp.money).toMatch(/clipping campaigns/);
    expect(bp.watched).toMatch(/Not watched yet/);
  });
  it("knows fitness, cooking ASMR and avatars", () => {
    expect(draftBlueprint("fitness influencer workout reels").name).toBe("Fitness Reels");
    expect(draftBlueprint("asmr cooking videos").name).toBe("ASMR Kitchen");
    expect(draftBlueprint("an avatar agent that posts daily").name).toBe("Avatar Agent");
  });
  it("falls back to a generic pipeline, as an App plugin when they say app", () => {
    const bp = draftBlueprint("an app like this for tracking my plants", ["video"]);
    expect(bp.name).toBe("My Workflow");
    expect(bp.home).toBe("plugin");
    expect(bp.inputs[0].kind).toBe("video");
  });
  it("reads recreate vs change", () => {
    expect(draftBlueprint("recreate exactly what this shows").mode).toBe("recreate");
    expect(draftBlueprint("do this but for real estate").mode).toBe("change");
  });
});

describe("coerceBlueprint", () => {
  const fb = draftBlueprint("clipping");
  it("keeps a good model answer and fixes its kinds", () => {
    const bp = coerceBlueprint(
      {
        name: "Hook Factory",
        inputs: [{ label: "Podcast link", kind: "link", role: "source" }, { label: "Weird", kind: "hologram" }],
        stages: [
          { label: "Download", engine: "yt-dlp", runsOn: "pc" },
          { label: "Pick", engine: "Claude", runsOn: "mars" },
        ],
        card: { name: "Hook Factory", blurb: "Hooks that hold", hue: 400 },
        judge: ["ten clips from one link"],
      },
      fb,
    );
    expect(bp.name).toBe("Hook Factory");
    expect(bp.inputs.map((i) => i.kind)).toEqual(["link", "text"]);
    expect(bp.stages[1].runsOn).toBe("cloud");
    expect(bp.card.hue).toBe(40);
    expect(bp.judge).toEqual(["ten clips from one link"]);
  });
  it("falls back for garbage", () => {
    expect(coerceBlueprint("nope", fb)).toBe(fb);
    expect(coerceBlueprint({ stages: [{ label: "only one" }] }, fb).stages).toEqual(fb.stages);
  });
});

describe("checkBlueprint", () => {
  it("passes a draft and catches what's missing", () => {
    const bp = draftBlueprint("clipping");
    expect(checkBlueprint(bp)).toEqual([]);
    const broken: Blueprint = { ...bp, name: "", inputs: [], stages: bp.stages.map((s) => ({ ...s, on: false })), output: "", judge: [] };
    expect(checkBlueprint(broken)).toHaveLength(5);
  });
});

describe("the brief", () => {
  it("is in the prompt-enhancer's shape and reads back exactly", () => {
    const bp = draftBlueprint("clipping podcasts for money");
    const text = buildBrief(bp, "clipping podcasts for money");
    for (const tag of ["<goal>", "<context>", "<request>", "<requirements>", "<mastery>", "<standard>", "<success_criteria>"]) {
      expect(text).toContain(tag);
    }
    expect(parseBlueprint(text)).toEqual(bp);
  });
  it("always fits a queue request with the JSON whole", () => {
    const bp = draftBlueprint("clipping");
    const huge: Blueprint = {
      ...bp,
      watched: "w".repeat(600),
      mastery: Array.from({ length: 8 }, () => "m".repeat(220)),
      stages: Array.from({ length: 10 }, (_, i) => ({ ...bp.stages[0], id: `st${i}`, detail: "d".repeat(200) })),
      inputs: Array.from({ length: 8 }, (_, i) => ({ ...bp.inputs[0], id: `in${i}`, role: "r".repeat(140) })),
    };
    const brief = buildBrief(huge, "x".repeat(2000));
    expect(brief.length).toBeLessThanOrEqual(BRIEF_ROOM + 200);
    const text = queueRequestText({ folder: MAKER_FOLDER, title: "WORKFLOW", brief });
    expect(parseBlueprint(text)?.stages).toHaveLength(10);
    expect(text).toContain("rea-to-workflow skill");
  });
});

describe("slugOf", () => {
  it("makes a stable id", () => {
    expect(slugOf("Clip Engine 2.0!")).toBe("clip-engine-2-0");
    expect(slugOf("")).toBe("my-workflow");
  });
});

describe("agents", () => {
  it("knows when the owner wants an agent", async () => {
    const { kindOf } = await import("./blueprint");
    expect(kindOf("make me an agent that makes money clipping")).toBe("agent");
    expect(kindOf("I want to earn from recreating websites")).toBe("agent");
    expect(kindOf("recreate this game but with my character")).toBe("game");
    expect(kindOf("rebuild this website for my client")).toBe("website");
    expect(kindOf("turn this into a cooking video workflow")).toBe("workflow");
  });
  it("gives a clipping agent its kit: tools it already has, real sites, approvals", () => {
    const bp = draftBlueprint("make me an agent that makes money clipping podcasts");
    expect(bp.kind).toBe("agent");
    expect(bp.home).toBe("agent");
    expect(bp.agent?.tools.some((t) => t.name === "Money Agent Studio" && t.ready)).toBe(true);
    expect(bp.agent?.resources.every((r) => r.url.startsWith("https://"))).toBe(true);
    expect(bp.agent?.approvals.length).toBeGreaterThan(0);
    expect(checkBlueprint(bp)).toEqual([]);
  });
  it("has a website-flipping agent and a game agent", () => {
    const site = draftBlueprint("an agent that makes money recreating websites for local businesses");
    expect(site.name).toBe("Site Flipper");
    expect(site.agent?.tools.map((t) => t.name)).toContain("website-redesigner");
    const game = draftBlueprint("agent that earns by recreating games like this");
    expect(game.name).toBe("Game Forge");
    expect(game.agent?.resources.map((r) => r.label)).toContain("itch.io");
  });
  it("any other money method still gets a working kit", () => {
    const bp = draftBlueprint("make money with this side hustle");
    expect(bp.kind).toBe("agent");
    expect(bp.agent?.firstMoves[0]).toMatch(/deep research/i);
  });
  it("only keeps real-looking addresses from a model", async () => {
    const { coerceAgent, safeUrl } = await import("./blueprint");
    expect(safeUrl("whop.com")).toBe("https://whop.com");
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("not a site")).toBe("");
    const kit = coerceAgent({ role: "r", goal: "g", tools: [{ name: "x", kind: "laser" }], resources: [{ label: "Bad", url: "ftp://x" }, { label: "Good", url: "https://itch.io" }] });
    expect(kit?.tools[0]).toEqual({ name: "x", does: "", kind: "skill", ready: false });
    expect(kit?.resources.map((r) => r.url)).toEqual(["", "https://itch.io"]);
  });
  it("an agent with no goal, tools or approvals can't be sent", () => {
    const bp = draftBlueprint("agent clipping");
    const bad: Blueprint = { ...bp, agent: { ...bp.agent!, goal: "", tools: [], approvals: [] } };
    expect(checkBlueprint(bad)).toHaveLength(3);
  });
  it("the brief carries the whole kit, reads back, and still fits", () => {
    const bp = draftBlueprint("an agent that makes money recreating websites for local businesses");
    const text = queueRequestText({ folder: MAKER_FOLDER, title: `${bp.name} — build it`, brief: buildBrief(bp, "make me an agent like this video") });
    expect(text.length).toBeLessThanOrEqual(3900);
    expect(text).toContain("Agent");
    expect(text).toMatch(/asks the owner first/);
    // When space runs short the kit's free text shortens; its structure never does.
    const back = parseBlueprint(text)!.agent!;
    expect(back.tools.map((t) => [t.name, t.kind, t.ready])).toEqual(bp.agent!.tools.map((t) => [t.name, t.kind, t.ready]));
    expect(back.resources.map((r) => r.url)).toEqual(bp.agent!.resources.map((r) => r.url));
    expect(back.approvals).toEqual(bp.agent!.approvals);
    expect(back.goal).toBe(bp.agent!.goal);
  });
});
