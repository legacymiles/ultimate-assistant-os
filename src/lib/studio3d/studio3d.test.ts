import { describe, expect, it } from "vitest";
import { routeMotion, subjectKind } from "./director/motion";
import { clauses, directHeuristic, findCharacters, sceneCountFor } from "./director/heuristic";
import { fitDurations, mixamoClipsNeeded, normalizePlan, toolUsage } from "./director/normalize";
import { extractJson } from "./director/llm-json";
import { addProject, applyProgress, cancelQueued, claimNext, failProject, queueRender, setPlan, setVideo } from "./reducer";
import type { Brief, VideoProject } from "./types";

const brief: Brief = { style: "stylized-3d", lengthSec: 30, aspect: "16:9" };

describe("routeMotion", () => {
  it("sends everyday humanoid motion to Mixamo with a clip", () => {
    expect(routeMotion("the robot walks into the kitchen", "humanoid")).toMatchObject({ tool: "mixamo", clip: "Walking" });
    expect(routeMotion("she explains photosynthesis", "humanoid")).toMatchObject({ tool: "mixamo", clip: "Talking" });
    expect(routeMotion("everyone starts dancing", "humanoid")).toMatchObject({ tool: "mixamo", clip: "Hip Hop Dancing" });
  });

  it("sends stunts, falls and fights to Cascadeur even when a clip word is present", () => {
    expect(routeMotion("the ninja runs and does a backflip", "humanoid").tool).toBe("cascadeur");
    expect(routeMotion("he slips on a banana and falls", "humanoid").tool).toBe("cascadeur");
    expect(routeMotion("two knights sword fight", "humanoid").tool).toBe("cascadeur");
  });

  it("never gives Mixamo a creature or an object", () => {
    expect(routeMotion("the dog walks", "creature").tool).toBe("cascadeur");
    expect(routeMotion("the rocket launches into space", "object").tool).toBe("blender");
  });

  it("falls back to custom motion for a specific unknown performance", () => {
    expect(routeMotion("the chef carefully plates a tiny dessert tower", "humanoid").tool).toBe("cascadeur");
    expect(routeMotion("stands", "humanoid").tool).toBe("mixamo");
  });
});

describe("subjectKind", () => {
  it("tells characters, creatures and objects apart", () => {
    expect(subjectKind("a little robot")).toBe("humanoid");
    expect(subjectKind("a golden retriever dog")).toBe("creature");
    expect(subjectKind("a fox who talks")).toBe("humanoid");
    expect(subjectKind("a red rocket")).toBe("object");
  });
});

describe("heuristic director", () => {
  it("sizes scenes to the length", () => {
    expect(sceneCountFor(15)).toBe(3);
    expect(sceneCountFor(30)).toBe(4);
    expect(sceneCountFor(60)).toBe(6);
    expect(sceneCountFor(120)).toBe(8);
  });

  it("splits a prompt into story clauses", () => {
    expect(clauses("A robot wakes up in a lab, then it walks outside. Finally it dances in the city!")).toEqual([
      "A robot wakes up in a lab",
      "it walks outside",
      "it dances in the city",
    ]);
  });

  it("finds the cast", () => {
    const cast = findCharacters("A tiny robot and a dog chase a red balloon through the park");
    expect(cast.map((c) => [c.noun, c.kind])).toEqual([
      ["robot", "humanoid"],
      ["dog", "creature"],
      ["balloon", "object"],
    ]);
  });

  it("builds a complete, consistent plan that uses all three tools when the story needs them", () => {
    const plan = directHeuristic(
      "A tiny robot walks through a neon city, then does a backflip over a puddle, and a dog chases a balloon. Finally the robot dances on a rooftop.",
      { ...brief, lengthSec: 60 },
    );
    expect(plan.source).toBe("heuristic");
    expect(plan.scenes).toHaveLength(6);
    expect(plan.totalSec).toBe(60);
    const ids = new Set(plan.characters.map((c) => c.id));
    const envs = new Set(plan.environments.map((e) => e.id));
    for (const s of plan.scenes) {
      expect(envs.has(s.environmentId)).toBe(true);
      for (const a of s.actions) expect(ids.has(a.characterId)).toBe(true);
    }
    const tools = toolUsage(plan).map((u) => u.tool);
    expect(tools).toEqual(["blender", "mixamo", "cascadeur"]);
    expect(mixamoClipsNeeded(plan)).toContain("Walking");
  });

  it("invents a guide for a topic with no characters", () => {
    const plan = directHeuristic("How volcanoes erupt", brief);
    expect(plan.interpretation.genre).toBe("Explainer");
    expect(plan.characters[0].kind).toBe("humanoid");
    expect(plan.scenes).toHaveLength(4);
  });
});

describe("normalizePlan", () => {
  it("fits durations to the requested length", () => {
    expect(fitDurations([1, 1, 1], 15)).toEqual([5, 5, 5]);
    const d = fitDurations([3, 9, 2, 1], 30);
    expect(d.reduce((a, b) => a + b, 0)).toBe(30);
    expect(Math.min(...d)).toBeGreaterThanOrEqual(2);
  });

  it("repairs a sloppy model plan and enforces the routing rules", () => {
    const plan = normalizePlan(
      {
        title: "Dog Park",
        characters: [{ id: "Rex!", name: "Rex", kind: "creature" }],
        scenes: [
          { durationSec: 3, environmentId: "nowhere", camera: { move: "zoom-blast", lens: 900 }, actions: [{ characterId: "Rex!", description: "walks happily", tool: "mixamo", clip: "Walking" }] },
          { durationSec: 1, actions: [{ characterId: "ghost", description: "waves", tool: "banana" }] },
        ],
      },
      brief,
      "a dog in a park",
      "ai",
    );
    expect(plan.environments).toHaveLength(1);
    expect(plan.totalSec).toBe(30);
    const [s1, s2] = plan.scenes;
    expect(s1.environmentId).toBe(plan.environments[0].id);
    expect(s1.camera).toMatchObject({ move: "static", lens: 135 });
    // The model asked for Mixamo on a creature; the rule wins.
    expect(s1.actions[0].tool).toBe("cascadeur");
    expect(s1.actions[0].clip).toBeUndefined();
    // Unknown character and tool get resolved.
    expect(s2.actions[0].characterId).toBe(plan.characters[0].id);
    expect(["mixamo", "cascadeur", "blender"]).toContain(s2.actions[0].tool);
  });

  it("replaces an unknown Mixamo clip with one that exists", () => {
    const plan = normalizePlan(
      { characters: [{ id: "c1", name: "Ana", kind: "humanoid" }], scenes: [{ actions: [{ characterId: "c1", description: "runs to the bus", tool: "mixamo", clip: "Mega Sprint 9000" }] }] },
      brief,
      "x",
      "ai",
    );
    expect(plan.scenes[0].actions[0]).toMatchObject({ tool: "mixamo", clip: "Running" });
  });
});

describe("extractJson", () => {
  it("reads fenced and bare JSON", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":2} done')).toEqual({ a: 2 });
    expect(extractJson("no json")).toBeNull();
  });
});

describe("reducer", () => {
  const plan = directHeuristic("A robot waves hello", brief);
  const base = (): VideoProject[] => addProject([], { id: "p1", ownerId: "u", prompt: "A robot waves hello", brief, plan, now: "2026-01-01T00:00:00Z" });

  it("walks a project from storyboard to ready", () => {
    let list = base();
    expect(list[0].status).toBe("storyboard");
    expect(claimNext(list, "t").project).toBeNull(); // not queued yet
    list = queueRender(list, "p1", "t1");
    const claimed = claimNext(list, "t2");
    expect(claimed.project?.status).toBe("building");
    list = applyProgress(claimed.list, "p1", { status: "animating", note: "Mixamo clips", lines: ["a", "b"] }, "t3");
    expect(list[0]).toMatchObject({ status: "animating", note: "Mixamo clips" });
    list = applyProgress(list, "p1", { status: "ready" }, "t4");
    expect(list[0]).toMatchObject({ status: "ready", finishedAt: "t4" });
    // A late progress post cannot move a finished project.
    list = applyProgress(list, "p1", { status: "rendering" }, "t5");
    expect(list[0].status).toBe("ready");
  });

  it("does not let progress or failure touch a project that is back on the storyboard", () => {
    let list = queueRender(base(), "p1", "t1");
    list = cancelQueued(list, "p1", "t2");
    expect(list[0].status).toBe("storyboard");
    expect(applyProgress(list, "p1", { status: "rendering" }, "t3")[0].status).toBe("storyboard");
    expect(failProject(list, "p1", "boom", "t3")[0].status).toBe("storyboard");
  });

  it("refuses plan edits while rendering and re-opens a finished project", () => {
    let list = claimNext(queueRender(base(), "p1", "t1"), "t2").list;
    const edited = { ...plan, title: "Changed" };
    expect(setPlan(list, "p1", edited, "t3")[0].plan.title).not.toBe("Changed");
    list = applyProgress(list, "p1", { status: "ready" }, "t4");
    list = setPlan(list, "p1", edited, "t5");
    expect(list[0]).toMatchObject({ status: "storyboard" });
    expect(list[0].plan.title).toBe("Changed");
  });

  it("reports the video it replaces", () => {
    let r = setVideo(base(), "p1", { key: "k1", contentType: "video/mp4", bytes: 1 }, "t");
    expect(r.replaced).toBeNull();
    r = setVideo(r.list, "p1", { key: "k2", contentType: "video/mp4", bytes: 2 }, "t");
    expect(r.replaced?.key).toBe("k1");
    expect(r.list[0].video?.key).toBe("k2");
  });
});
