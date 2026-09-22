import { describe, expect, it } from "vitest";
import { heuristicPlan, routeScene, sceneBounds, sceneCountFor, tidyPlan } from "./plan";
import { briefProblem, emptyBrief, clampDuration, normaliseBrief, titleFromBrief } from "./brief";
import { METHODS, methodById, methodName, versionLetter, DIRECTOR_ID } from "./registry";
import type { ProductionPlan } from "./types";

describe("brief", () => {
  it("refuses a brief with nothing in it", () => {
    expect(briefProblem(emptyBrief())).not.toBeNull();
    expect(briefProblem({ ...emptyBrief(), prompt: "Explain compound interest in 20 seconds" })).toBeNull();
  });

  it("clamps the duration into a renderable range", () => {
    expect(clampDuration(0)).toBe(3);
    expect(clampDuration(99999)).toBe(300);
    expect(clampDuration("20")).toBe(20);
    expect(clampDuration("nonsense")).toBe(20);
  });

  it("normalises anything off the wire into a valid brief", () => {
    const brief = normaliseBrief({ prompt: "  hi  ", aspectRatio: "bogus", narration: "bogus", captions: false });
    expect(brief.prompt).toBe("hi");
    expect(brief.aspectRatio).toBe("16:9");
    expect(brief.narration).toBe("ai-voiceover");
    expect(brief.captions).toBe(false);
  });

  it("titles a project from the subject, stripping the request verb", () => {
    expect(titleFromBrief({ ...emptyBrief(), prompt: "Create a video about compound interest" })).toBe(
      "Video about compound interest",
    );
  });
});

describe("scene structure", () => {
  it("scales the scene count with the duration", () => {
    expect(sceneCountFor(6)).toBe(2);
    expect(sceneCountFor(20)).toBe(4);
    expect(sceneCountFor(120)).toBe(8);
  });

  it("produces contiguous bounds that cover the whole duration", () => {
    const bounds = sceneBounds(20, 4);
    expect(bounds[0].startSec).toBe(0);
    expect(bounds.at(-1)!.endSec).toBe(20);
    for (let i = 1; i < bounds.length; i += 1) {
      expect(bounds[i].startSec).toBe(bounds[i - 1].endSec);
    }
  });
});

describe("tidyPlan", () => {
  const base = (scenes: ProductionPlan["scenes"]): ProductionPlan => ({
    title: "T",
    logline: "L",
    durationSec: 30,
    aspectRatio: "16:9",
    scenes,
    methodId: "remotion",
    skill: "remotion-best-practices",
    source: "heuristic",
  });

  it("closes gaps and overlaps so no second is unaccounted for", () => {
    const plan = tidyPlan(
      base([
        { id: "a", index: 1, title: "A", startSec: 0, endSec: 5, description: "", methodId: "remotion" },
        { id: "b", index: 2, title: "B", startSec: 9, endSec: 14, description: "", methodId: "remotion" },
      ]),
      "remotion",
    );
    expect(plan.scenes[1].startSec).toBe(5);
    expect(plan.scenes[1].endSec).toBe(14);
    expect(plan.durationSec).toBe(14);
  });

  it("gives a zero-length scene at least a second", () => {
    const plan = tidyPlan(
      base([{ id: "a", index: 1, title: "A", startSec: 4, endSec: 4, description: "", methodId: "remotion" }]),
      "remotion",
    );
    expect(plan.scenes[0].endSec).toBeGreaterThan(plan.scenes[0].startSec);
  });

  it("replaces an unknown engine with the fallback rather than keeping it", () => {
    const plan = tidyPlan(
      base([{ id: "a", index: 1, title: "A", startSec: 0, endSec: 5, description: "", methodId: "not-a-method" }]),
      "h3",
    );
    expect(plan.scenes[0].methodId).toBe("h3");
  });

  it("renumbers scenes in time order", () => {
    const plan = tidyPlan(
      base([
        { id: "b", index: 9, title: "B", startSec: 5, endSec: 10, description: "", methodId: "remotion" },
        { id: "a", index: 2, title: "A", startSec: 0, endSec: 5, description: "", methodId: "remotion" },
      ]),
      "remotion",
    );
    expect(plan.scenes.map((s) => s.title)).toEqual(["A", "B"]);
    expect(plan.scenes.map((s) => s.index)).toEqual([1, 2]);
  });
});

describe("AI Director routing", () => {
  it("sends a chart scene to Remotion", () => {
    expect(routeScene("A bar chart of the returns grows year by year").methodId).toBe("remotion");
  });

  it("sends a photoreal establishing shot to H3", () => {
    expect(routeScene("A cinematic drone shot over a coastline at sunset").methodId).toBe("h3");
  });

  it("sends a built environment to Unreal", () => {
    expect(routeScene("A robot walks through a futuristic city").methodId).toBe("unreal");
  });

  it("sends a product turntable to Blender", () => {
    expect(routeScene("A turntable of the espresso machine").methodId).toBe("blender");
  });

  it("falls back to a legible default and says why", () => {
    const routed = routeScene("Something entirely unspecified happens");
    expect(routed.methodId).toBe("remotion");
    expect(routed.reason).toContain("no engine-specific signal");
  });

  it("only routes to engines it is allowed to use", () => {
    expect(routeScene("A cinematic drone shot at sunset", ["blender", "unreal"]).methodId).not.toBe("h3");
  });
});

describe("heuristicPlan", () => {
  it("covers the whole duration with contiguous scenes and no AI", () => {
    const brief = { ...emptyBrief(), prompt: "Explain compound interest", durationSec: 20 };
    const plan = heuristicPlan(brief, "remotion", "manual");
    expect(plan.source).toBe("heuristic");
    expect(plan.note).toBeTruthy();
    expect(plan.scenes.at(-1)!.endSec).toBe(20);
    expect(plan.scenes.every((s) => s.methodId === "remotion")).toBe(true);
  });

  it("routes per scene in director mode", () => {
    const brief = { ...emptyBrief(), prompt: "A cinematic film about a coastline at sunset", durationSec: 20 };
    const plan = heuristicPlan(brief, DIRECTOR_ID, "director");
    expect(plan.methodId).toBe(DIRECTOR_ID);
    expect(plan.skill).toBe("AI Director");
    expect(plan.scenes.every((s) => methodById(s.methodId))).toBe(true);
  });
});

describe("registry", () => {
  it("has no duplicate ids", () => {
    const ids = METHODS.map((m) => m.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every method the parts the app relies on", () => {
    for (const { meta, skill } of METHODS) {
      expect(meta.name).toBeTruthy();
      expect(meta.skill).toBeTruthy();
      expect(meta.strengths.length).toBeGreaterThan(0);
      expect(skill.optimiserSystem.length).toBeGreaterThan(200);
      expect(skill.instructions.length).toBeGreaterThan(200);
      expect(meta.hue).toHaveLength(2);
    }
  });

  it("names the director pseudo-method without registering it as an engine", () => {
    expect(methodById(DIRECTOR_ID)).toBeNull();
    expect(methodName(DIRECTOR_ID)).toBe("AI Director");
  });

  it("labels versions A, B, C in creation order", () => {
    expect([0, 1, 2].map(versionLetter)).toEqual(["A", "B", "C"]);
  });
});
