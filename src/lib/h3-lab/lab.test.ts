import { describe, expect, it } from "vitest";
import { compile, cameraSentence, flatten } from "./compile";
import { lint } from "./lint";
import { framesFor, wanSettings, estimateMinutes } from "./wangp";
import { BASE_STRATEGY, cleanOverrides, merge, differingTechniques } from "./strategy";
import { approveChange, currentVersion, diffVersions, rollback, seedGuide, skillMarkdown, strategyFor } from "./guide";
import { applyJudge, applyResult, designOffline, initialState, proposeCombination, queueExperiment, queueSingle, recreate, normalize, rendersLeft } from "./state";
import { nextStep } from "./agent";
import { measuredScores, overallScore, pairsOf, techniqueStats, discoveries } from "./score";
import { measuredIssues } from "./inspect";
import { GENRES, guessGenre } from "./genres";
import type { ClipMetrics, Generation, LabState, Scores, Strategy, Blueprint } from "./model";
import { SEED_SCENARIOS } from "./seed";

const NOW = "2026-11-24T12:00:00.000Z";

function metrics(over: Partial<ClipMetrics> = {}): ClipMetrics {
  return {
    durationSec: 5.2,
    width: 832,
    height: 480,
    fps: 24,
    frames: 124,
    cuts: [],
    ssimAdjacent: 0.82,
    ssimMin: 0.74,
    ssimMinAt: 2.1,
    ssimFirstLast: 0.7,
    freezes: [],
    luma: [96, 98, 97, 99, 98, 97],
    motion: { dx: 0, dy: 0, rot: 0, zoom: 4, energy: 3 },
    measuredMove: "push-in",
    sampleTimes: [0.4, 1.3, 2.2, 3.0, 3.9, 4.8],
    ...over,
  };
}

describe("compiler", () => {
  const state = initialState(NOW);
  const sc = SEED_SCENARIOS[0];

  it("writes the base format with sound for a cast with no photos", () => {
    const c = compile({ spec: sc.spec, strategy: BASE_STRATEGY, characters: state.characters, environments: state.environments });
    expect(c.mode).toBe("base");
    expect(c.prompt).toMatch(/^integrated_multimodal_description: \[Shot 1\]/);
    expect(c.prompt).toMatch(/overall_soundscape: /);
    expect(c.prompt).toMatch(/non_diegetic_music: /);
    expect(c.prompt).toContain("(S1) MARA VOSS says in a low, steady voice: <d>[English] Why did you stop calling?</d>");
    expect(c.prompt).toContain("Impeccable subject consistency");
  });

  it("switches to the six Ref2VA sections when a character has a photo, identity first", () => {
    const chars = state.characters.map((c) => (c.id === "char-theo" ? { ...c, referenceImages: ["data:image/jpeg;base64,AAAA"] } : c));
    const envs = state.environments.map((e) => (e.id === "env-loft" ? { ...e, referenceImages: ["data:image/jpeg;base64,BBBB"] } : e));
    const c = compile({ spec: sc.spec, strategy: BASE_STRATEGY, characters: chars, environments: envs });
    expect(c.mode).toBe("ref2va");
    expect(c.references.map((r) => r.kind)).toEqual(["character", "environment"]);
    expect(c.prompt).toMatch(/^subject_definitions:\n<Subject 1> is THEO OKAFOR/);
    expect(c.prompt).toContain("<Subject 2> (appears in [Shot 1]): partially_preserved");
    expect(c.prompt).toMatch(/summary: \[reference generation\]/);
  });

  it("each knob changes the text", () => {
    const base = compile({ spec: sc.spec, strategy: BASE_STRATEGY, characters: state.characters, environments: state.environments }).prompt;
    for (const k of ["order", "camera", "length", "environment", "dialogue", "closing"] as (keyof Strategy)[]) {
      const alt = { ...BASE_STRATEGY, [k]: k === "order" ? "environment-first" : k === "camera" ? "token" : k === "length" ? "tight" : k === "environment" ? "layout-explicit" : k === "dialogue" ? "plain" : "none" } as Strategy;
      const p = compile({ spec: sc.spec, strategy: alt, characters: state.characters, environments: state.environments }).prompt;
      expect(p, k).not.toBe(base);
    }
  });

  it("writes medium amplitude/speed by leaving the modifier out (official rule)", () => {
    const spec = { ...sc.spec, camera: { move: "pan-left" as const, amount: "medium" as const, speed: "medium" as const } };
    expect(cameraSentence(spec, "official-prose", "MARA")).toBe("The camera pans left across the scene toward MARA.");
    const small = { ...sc.spec, camera: { move: "push-in" as const, amount: "small" as const, speed: "slow" as const, focus: "her eyes" } };
    expect(cameraSentence(small, "official-prose", "MARA")).toBe("The camera pushes in with small amplitude at slow speed toward her eyes.");
  });

  it("timed cuts write [Shot N] At MM:SS.mmm blocks with increasing times", () => {
    const fight = SEED_SCENARIOS.find((s) => s.id === "sc-garage-fight")!;
    const p = compile({ spec: fight.spec, strategy: { ...BASE_STRATEGY, structure: "timed-cuts" }, characters: state.characters, environments: state.environments }).prompt;
    expect(p).toContain("[Shot 2] At 00:01.667, the camera cuts to");
    expect(p).toContain("[Shot 3] At 00:03.333");
  });

  it("flattens newlines for WanGP", () => {
    expect(flatten("a\n\nb\n c")).toBe("a b c");
  });
});

describe("lint", () => {
  const state = initialState(NOW);
  it("flags dialogue that cannot fit and missing action", () => {
    const spec = { ...SEED_SCENARIOS[0].spec, action: "", durationSec: 4, dialogue: [{ speaker: "char-mara", line: "one two three four five six seven eight nine ten eleven", delivery: "" }] };
    const c = compile({ spec, strategy: BASE_STRATEGY, characters: state.characters, environments: state.environments });
    const codes = lint(spec, c).map((f) => f.code);
    expect(codes).toContain("dialogue-overrun");
    expect(codes).toContain("no-change");
  });
});

describe("wangp settings", () => {
  it("keeps frames on the 107+17k lattice", () => {
    for (const s of [4, 5, 6, 8, 10, 15]) {
      const f = framesFor(s);
      expect((f - 107) % 17).toBe(0);
      expect(f).toBeGreaterThanOrEqual(124);
      expect(f).toBeLessThanOrEqual(362);
    }
    expect(framesFor(5)).toBe(124);
  });
  it("uses the turbo LoRA only at turbo, two-phase only at hi", () => {
    const state = initialState(NOW);
    const c = compile({ spec: SEED_SCENARIOS[0].spec, strategy: BASE_STRATEGY, characters: state.characters, environments: state.environments });
    const t = wanSettings(SEED_SCENARIOS[0].spec, c, { quality: "turbo", seed: 1 });
    expect(t.model_type).toBe("minimax_h3_fl2va_pruned");
    expect(t.num_inference_steps).toBe(4);
    expect(String((t.activated_loras as string[])[0])).toContain("fl2v_turbo");
    expect(String(t.prompt)).not.toContain("\n");
    const h = wanSettings(SEED_SCENARIOS[0].spec, c, { quality: "hi", seed: 1 });
    expect(h.guidance_phases).toBe(2);
    expect(h.resolution).toBe("1664x960");
    expect(h.activated_loras).toBeUndefined();
  });
  it("never guesses a hi-quality duration it has not measured", () => {
    expect(estimateMinutes(SEED_SCENARIOS[0].spec, "hi")).toBeNull();
    expect(estimateMinutes(SEED_SCENARIOS[0].spec, "turbo")).toBeCloseTo(5.7, 1);
    expect(estimateMinutes(SEED_SCENARIOS[0].spec, "hi", [{ frames: 124, seconds: 1240, quality: "hi" }])).toBeCloseTo(20.7, 1);
  });
});

describe("guide", () => {
  it("seeds every genre and never rewrites a version", () => {
    const g = seedGuide(NOW);
    expect(currentVersion(g).sections.filter((s) => s.genre)).toHaveLength(GENRES.length);
    g.changes.push({ id: "c1", kind: "technique", title: "t", why: "w", problem: "p", experimentIds: [], evidence: [], patch: { genreStrategy: [{ genre: "fight-scene", set: { camera: "official-prose" } }] }, status: "pending", proposedBy: "agent", createdAt: NOW });
    const { guide, version } = approveChange(g, "c1", NOW);
    expect(version).toBe(2);
    expect(guide.versions[0].genreStrategy["fight-scene"].camera).toBe("plain-big");
    expect(currentVersion(guide).genreStrategy["fight-scene"].camera).toBe("official-prose");
    const diff = diffVersions(guide.versions[0], guide.versions[1]);
    expect(diff.genres).toEqual([{ genre: "fight-scene", knob: "camera", from: "plain-big", to: "official-prose" }]);
    const back = rollback(guide, 1, "test", "rb", NOW);
    expect(back.versions).toHaveLength(3);
    expect(currentVersion(back).genreStrategy["fight-scene"].camera).toBe("plain-big");
    expect(back.changes.find((c) => c.id === "rb")?.kind).toBe("rollback");
  });
  it("publishes as the one h3-prompt skill", () => {
    const md = skillMarkdown(currentVersion(seedGuide(NOW)));
    expect(md).toMatch(/^---\nname: h3-prompt\ndescription: "/);
    expect(md).toContain("## Genre modules");
    expect(md).toContain("two of that person");
  });
});

describe("strategy", () => {
  it("drops unknown knobs and values", () => {
    expect(cleanOverrides({ camera: "plain-big", order: "nonsense", bogus: 1 })).toEqual({ camera: "plain-big" });
    expect(differingTechniques(BASE_STRATEGY, merge(BASE_STRATEGY, { camera: "token" }))).toEqual(["camera=token"]);
  });
});

// ----- statistics: the two traps ---------------------------------------------------------------

function gen(pairKey: string, arm: "master" | "experiment", strategy: Strategy, overall: number, genre = "fight-scene"): Generation {
  const scores: Scores = { action: { value: overall, confidence: 1, source: "owner", evidence: "" } };
  return { id: `${pairKey}-${arm}`, scenarioId: "s", experimentId: arm === "experiment" ? "exp-x" : null, arm, pairKey, genre, prompt: "", settings: {}, strategy, guideVersion: 1, seed: 1, status: "done", queuedAt: NOW, scores, judgedAt: NOW };
}

describe("technique statistics", () => {
  const master = merge(BASE_STRATEGY, {});
  it("does not crown a technique from one lucky pair (n=1 spans zero)", () => {
    const gens = [gen("p1", "master", master, 3), gen("p1", "experiment", merge(master, { camera: "token" }), 9)];
    const stats = techniqueStats(pairsOf(gens), "overall");
    expect(stats[0].n).toBe(1);
    expect(stats[0].ciLo).toBeLessThan(0);
    expect(discoveries(stats, 1, 0)).toHaveLength(0);
  });

  it("splits credit between techniques that travelled together (decoy gets ~nothing)", () => {
    const real = merge(master, { action: "choreography-beats" });
    const both = merge(master, { action: "choreography-beats", closing: "none" });
    const gens: Generation[] = [];
    // The real technique alone: +2 each time.
    for (let i = 0; i < 6; i++) gens.push(gen(`a${i}`, "master", master, 5), gen(`a${i}`, "experiment", real, 7));
    // The decoy only ever appears alongside the real one: +2 (all of it the real one's).
    for (let i = 0; i < 4; i++) gens.push(gen(`b${i}`, "master", master, 5), gen(`b${i}`, "experiment", both, 7));
    const stats = techniqueStats(pairsOf(gens), "overall");
    const realStat = stats.find((s) => s.technique === "action=choreography-beats")!;
    const decoy = stats.find((s) => s.technique === "closing=none")!;
    expect(realStat.ciLo).toBeGreaterThan(0);
    expect(Math.abs(decoy.effect)).toBeLessThan(realStat.effect / 3);
    expect(discoveries(stats, 3, 0.2).map((d) => d.technique)).toEqual(["action=choreography-beats"]);
  });
});

describe("measurement and inspection", () => {
  const spec = SEED_SCENARIOS[0].spec;
  it("scores a clean push-in highly and explains why", () => {
    const s = measuredScores(metrics(), spec, "single-shot");
    expect(s.camera?.value).toBe(9);
    expect(s.continuity?.value).toBeGreaterThanOrEqual(9);
    expect(s.continuity?.evidence).toContain("0 scene changes");
    expect(overallScore(s, "dialogue-scene")).toBeGreaterThan(7);
  });
  it("flags an unintended cut, a freeze and a lighting jump", () => {
    const m = metrics({ cuts: [{ t: 2.5, score: 40 }], freezes: [{ start: 4.0, end: 5.2 }], luma: [96, 98, 150, 151, 150, 149] });
    const kinds = measuredIssues(m, spec, "single-shot").map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["unintended-cut", "frozen", "lighting-jump"]));
  });
  it("does not flag a change the spec says is intentional", () => {
    const m = metrics({ luma: [96, 98, 150, 151, 150, 149] });
    const kinds = measuredIssues(m, { ...spec, intentionalChanges: ["lighting"] }, "single-shot").map((i) => i.kind);
    expect(kinds).not.toContain("lighting-jump");
  });
});

describe("the loop", () => {
  it("queues paired renders with the same seed and skips no-op scenarios", () => {
    const state = initialState(NOW);
    const r = queueExperiment(state, "exp-a", NOW);
    expect(r.queued).toBeGreaterThan(0);
    const pairs = new Map<string, Generation[]>();
    for (const g of state.generations) pairs.set(g.pairKey, [...(pairs.get(g.pairKey) ?? []), g]);
    for (const [, gs] of pairs) {
      expect(gs).toHaveLength(2);
      expect(gs[0].seed).toBe(gs[1].seed);
      expect(gs[0].strategy).not.toEqual(gs[1].strategy);
    }
  });

  it("decides steps in priority order and honours pause", () => {
    const state = initialState(NOW);
    expect(nextStep(state, NOW).kind).toBe("idle");
    state.agent.mode = "running";
    expect(nextStep(state, NOW)).toMatchObject({ kind: "queue", target: "exp-a" });
    queueExperiment(state, "exp-a", NOW);
    state.experiments.find((e) => e.id === "exp-a")!.status = "queued";
    const g = state.generations[0];
    applyResult(state, g.id, { ok: true, metrics: metrics(), frameCount: 6, renderSeconds: 340 }, NOW);
    expect(nextStep(state, NOW)).toMatchObject({ kind: "evaluate", target: g.id });
    applyJudge(state, g.id, null, "measured-only", NOW);
    expect(state.generations[0].judgedAt).toBe(NOW);
  });

  it("respects the daily render budget", () => {
    const state = initialState(NOW);
    state.agent.rendersPerDay = 2;
    state.counters = { day: NOW.slice(0, 10), renders: 2, aiCalls: 0 };
    expect(rendersLeft(state, NOW)).toBe(0);
    state.agent.mode = "running";
    expect(nextStep(state, NOW).kind).not.toBe("queue");
  });

  it("designs a single-knob experiment offline", () => {
    const state = initialState(NOW);
    const e = designOffline(state, NOW)!;
    expect(Object.keys(e.overrides)).toHaveLength(1);
    expect(e.scenarioIds.length).toBeGreaterThan(0);
  });

  it("proposes per-genre techniques, never a whole experiment, and only with evidence", () => {
    const state = initialState(NOW);
    expect(proposeCombination(state, NOW)).toBeNull();
    const v = currentVersion(state.guide);
    const master = strategyFor(v, "fight-scene");
    const trial = merge(master, { identity: "repeat-every-shot" });
    for (let i = 0; i < 5; i++) state.generations.push(gen(`exp-a:sc${i}:v1:turbo`, "master", master, 5), gen(`exp-a:sc${i}:v1:turbo`, "experiment", trial, 7.5));
    const c = proposeCombination(state, NOW)!;
    expect(c.status).toBe("pending");
    expect(c.patch.genreStrategy).toEqual([{ genre: "fight-scene", set: { identity: "repeat-every-shot" } }]);
    expect(c.evidence[0].n).toBe(5);
    expect(proposeCombination(state, NOW)).toBeNull();
  });

  it("recreates a blueprint with a new cast", () => {
    const state = initialState(NOW);
    const b: Blueprint = {
      id: "bp1", sourceName: "ref.mp4", durationSec: 12, width: 1920, height: 1080, createdAt: NOW, detection: "browser-histogram", engine: "offline", genre: "dialogue-scene", style: "naturalistic", editingRhythm: "slow", sound: "room tone",
      characters: [{ label: "Person A", description: "" }], environments: [{ label: "living room", description: "" }],
      shots: [{ index: 0, start: 0, end: 6, keyframes: [], characters: ["Person A"], positions: "Person A sits on the left", actions: "Person A stands up and walks to the door", dialogue: "", emotion: "resolved", camera: { angle: "medium shot", move: "track", amount: "medium", speed: "slow" }, lighting: "lamp light", environment: "living room", props: "", transitionIn: "cut", cutStrength: 1 }],
    };
    const p = recreate(state, b, "New", { "Person A": "char-mara" }, { "living room": "env-loft" }, NOW);
    expect(p.scenes[0].spec.characterIds).toEqual(["char-mara"]);
    expect(p.scenes[0].spec.action).toContain("Mara Voss stands up");
    expect(p.scenes[0].spec.environmentId).toBe("env-loft");
  });

  it("normalize keeps a saved lab and fills new fields", () => {
    const s = initialState(NOW) as Partial<LabState>;
    delete (s as { think?: unknown }).think;
    expect(normalize(s, NOW).think).toEqual([]);
  });

  it("genre guesser routes common phrasings", () => {
    expect(guessGenre("a fight in a parking garage")).toBe("fight-scene");
    expect(guessGenre("police chase downtown")).toBe("police-pursuit");
    expect(guessGenre("two people talking")).toBe("dialogue-scene");
  });
});

describe("measured continuity on a moving camera", () => {
  it("does not call a steady fast push a morph (real clip numbers), but does flag a spike", () => {
    const spec = { ...SEED_SCENARIOS[0].spec, camera: { move: "push-in" as const, amount: "large" as const, speed: "fast" as const } };
    // Measured by the worker on a real H3 fast push: mean 0.29, min 0.154.
    const steady = metrics({ ssimAdjacent: 0.29, ssimMin: 0.154, ssimMinAt: 1.04, ssimFirstLast: 0.155, measuredMove: "push-in" });
    expect(measuredIssues(steady, spec, "single-shot").map((i) => i.kind)).not.toContain("character-morph");
    expect(measuredScores(steady, spec, "single-shot").continuity!.value).toBeGreaterThanOrEqual(7.5);
    const spiky = metrics({ ssimAdjacent: 0.85, ssimMin: 0.2, ssimMinAt: 2.5 });
    expect(measuredIssues(spiky, SEED_SCENARIOS[0].spec, "single-shot").map((i) => i.kind)).toContain("character-morph");
  });
});

describe("the master guide obeys its own rules", () => {
  it("compiles every seeded scenario without a lint error (the Experiment Lab caught a 1,736-char two-hander)", () => {
    const state = initialState(NOW);
    const v = currentVersion(state.guide);
    const over: string[] = [];
    for (const sc of state.scenarios) {
      const c = compile({ spec: sc.spec, strategy: strategyFor(v, sc.spec.genre), characters: state.characters, environments: state.environments });
      const errors = lint(sc.spec, c).filter((f) => f.level === "error");
      if (errors.length) over.push(`${sc.title}: ${errors.map((e) => e.code).join(", ")} (${c.chars} chars)`);
    }
    expect(over).toEqual([]);
  });
});

describe("a one-off render keeps its evidence", () => {
  it("scores a render that belongs to no scenario (the first real WanGP render lost its metrics this way)", () => {
    const state = initialState(NOW);
    const g = queueSingle(state, SEED_SCENARIOS[5].spec, undefined, null, NOW);
    expect(g.scenarioId).toBe("");
    applyResult(state, g.id, { ok: true, metrics: metrics(), frameCount: 6, renderSeconds: 906 }, NOW);
    const done = state.generations.find((x) => x.id === g.id)!;
    expect(done.metrics).toBeDefined();
    expect(done.scores?.continuity?.value).toBeGreaterThan(0);
    expect(done.overall).toBeGreaterThan(0);
  });
});
