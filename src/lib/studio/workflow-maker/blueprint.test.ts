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
    expect(bp.home).toBe("studio");
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
