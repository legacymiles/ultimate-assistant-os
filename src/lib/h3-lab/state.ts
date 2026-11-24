// ---------------------------------------------------------------------------
// The lab's state transitions — pure. Routes and the agent call these, read
// the result, and save it; nothing here touches the network or the disk.
// ---------------------------------------------------------------------------

import type {
  ActivityEntry,
  AgentSettings,
  Blueprint,
  BlueprintMeta,
  ChangeRecord,
  ClipMetrics,
  Dimension,
  Experiment,
  Generation,
  GenreId,
  InspectionIssue,
  LabState,
  Production,
  ProductionScene,
  Scenario,
  Scores,
  ShotSpec,
  Strategy,
  TechniqueId,
} from "./model";
import { DIMENSIONS } from "./model";
import { approveChange, currentVersion, seedGuide, strategyFor } from "./guide";
import { compile } from "./compile";
import { wanSettings } from "./wangp";
import { combineScores, discoveries, measuredScores, overallScore, pairsOf, techniqueStats, weakestDimensions, type TechniqueStat } from "./score";
import { judgedIssues, measuredIssues, sortIssues } from "./inspect";
import { KNOBS, cleanOverrides, merge, parseTechnique, techniqueLabel } from "./strategy";
import { genreName } from "./genres";
import { SEED_CHARACTERS, SEED_ENVIRONMENTS, SEED_EXPERIMENTS, SEED_REPOS, SEED_SCENARIOS } from "./seed";
import type { JudgeOutput } from "./api";

export const MAX_ACTIVITY = 600;
export const MAX_GENERATIONS = 2000;

export const DEFAULT_AGENT: AgentSettings = {
  mode: "paused",
  promotion: "manual",
  minPairs: 3,
  minLowerBound: 0.2,
  rendersPerDay: 24,
  aiCallsPerDay: 80,
  maxConcurrentExperiments: 2,
  brain: "hub-ai",
  model: "anthropic/claude-sonnet-5",
  quality: "turbo",
  testSeconds: 5,
  priorities: ["character consistency", "fight choreography", "dialogue scenes"],
};

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}${rand}`;
}

export function initialState(now: string): LabState {
  return {
    schema: 1,
    guide: seedGuide(now),
    experiments: SEED_EXPERIMENTS.map((e) => ({ ...e })),
    scenarios: SEED_SCENARIOS.map((s) => ({ ...s, spec: { ...s.spec } })),
    generations: [],
    characters: SEED_CHARACTERS.map((c) => ({ ...c })),
    environments: SEED_ENVIRONMENTS.map((e) => ({ ...e })),
    productions: [],
    blueprints: [],
    repos: SEED_REPOS.map((r) => ({ ...r })),
    agent: { ...DEFAULT_AGENT },
    counters: { day: now.slice(0, 10), renders: 0, aiCalls: 0 },
    lastResearchAt: null,
    activity: [],
    worker: { lastSeen: null, machine: "", version: "", wangp: "unknown", wangpDetail: "", ffmpeg: false, claude: false, current: null, models: [], queueDepth: 0 },
    think: [],
  };
}

/** Fill anything an older save is missing. Pure migration. */
export function normalize(raw: Partial<LabState> | null, now: string): LabState {
  const base = initialState(now);
  if (!raw || raw.schema !== 1) return base;
  return {
    ...base,
    ...raw,
    agent: { ...DEFAULT_AGENT, ...(raw.agent ?? {}) },
    counters: raw.counters ?? base.counters,
    worker: { ...base.worker, ...(raw.worker ?? {}) },
    think: raw.think ?? [],
    lastResearchAt: raw.lastResearchAt ?? null,
  } as LabState;
}

export function log(state: LabState, actor: ActivityEntry["actor"], kind: ActivityEntry["kind"], text: string, ref?: ActivityEntry["ref"], now = new Date().toISOString()): void {
  state.activity.unshift({ id: newId("act"), at: now, actor, kind, text, ...(ref ? { ref } : {}) });
  if (state.activity.length > MAX_ACTIVITY) state.activity.length = MAX_ACTIVITY;
}

export function rollCounters(state: LabState, now: string): void {
  const day = now.slice(0, 10);
  if (state.counters.day !== day) state.counters = { day, renders: 0, aiCalls: 0 };
}

/** Today's counts — zero when the stored counters are from an earlier day. Pure: never mutates. */
export function todayCounts(state: LabState, now: string): { renders: number; aiCalls: number } {
  return state.counters.day === now.slice(0, 10) ? { renders: state.counters.renders, aiCalls: state.counters.aiCalls } : { renders: 0, aiCalls: 0 };
}

export function rendersLeft(state: LabState, now: string): number {
  return Math.max(0, state.agent.rendersPerDay - todayCounts(state, now).renders);
}

export function aiCallsLeft(state: LabState, now: string): number {
  return Math.max(0, state.agent.aiCallsPerDay - todayCounts(state, now).aiCalls);
}

// ----- compiling ------------------------------------------------------------------------

export function compileSpec(state: LabState, spec: ShotSpec, strategy: Strategy, instructions = "", previous?: { endsOn: string } | null) {
  return compile({ spec, strategy, characters: state.characters, environments: state.environments, instructions, previous });
}

function seedFor(scenarioId: string, guideVersion: number): number {
  // Same scenario + same guide version → same seed for both arms (paired test).
  let h = 2166136261;
  for (const ch of `${scenarioId}:${guideVersion}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Math.abs(h) % 2_000_000_000;
}

function makeGeneration(
  state: LabState,
  args: { scenarioId: string; spec: ShotSpec; strategy: Strategy; arm: Generation["arm"]; experimentId: string | null; pairKey: string; instructions: string; seed: number; now: string },
): Generation {
  const v = currentVersion(state.guide);
  const compiled = compileSpec(state, args.spec, args.strategy, args.instructions);
  return {
    id: newId("gen"),
    scenarioId: args.scenarioId,
    experimentId: args.experimentId,
    arm: args.arm,
    pairKey: args.pairKey,
    genre: args.spec.genre,
    prompt: compiled.prompt,
    settings: wanSettings(args.spec, compiled, { quality: state.agent.quality, seed: args.seed }),
    strategy: args.strategy,
    guideVersion: v.version,
    seed: args.seed,
    status: "queued",
    queuedAt: args.now,
    spec: args.spec,
  };
}

/** Scenario spec at the lab's test length. */
function testSpec(state: LabState, sc: Scenario): ShotSpec {
  return { ...sc.spec, durationSec: Math.max(4, Math.min(15, sc.spec.durationSec || state.agent.testSeconds)) };
}

/**
 * Queue an experiment: for each scenario, a master render and an experiment
 * render with the same seed. A master render already done for that scenario
 * at this guide version + seed + quality is reused instead of re-rendered.
 * Scenarios where the experiment changes nothing for that genre are skipped.
 */
export function queueExperiment(state: LabState, id: string, now: string): { queued: number; reused: number; skipped: string[] } {
  const exp = state.experiments.find((e) => e.id === id);
  if (!exp) return { queued: 0, reused: 0, skipped: [] };
  const v = currentVersion(state.guide);
  let queued = 0;
  let reused = 0;
  const skipped: string[] = [];
  for (const scId of exp.scenarioIds) {
    const sc = state.scenarios.find((s) => s.id === scId);
    if (!sc) continue;
    const spec = testSpec(state, sc);
    const master = strategyFor(v, spec.genre);
    const trial = merge(master, exp.overrides);
    if (KNOBS.every((k) => master[k.knob] === trial[k.knob]) && !exp.instructions.trim()) {
      skipped.push(sc.title);
      continue;
    }
    const seed = seedFor(sc.id, v.version);
    const pairKey = `${exp.id}:${sc.id}:v${v.version}:${state.agent.quality}`;
    if (state.generations.some((g) => g.pairKey === pairKey && g.status !== "failed" && g.status !== "cancelled")) continue;
    const existingMaster = state.generations.find(
      (g) => g.arm === "master" && g.scenarioId === sc.id && g.guideVersion === v.version && g.seed === seed && (g.settings as { num_inference_steps?: number }).num_inference_steps === (state.agent.quality === "hi" ? 20 : 4) && g.status !== "failed" && g.status !== "cancelled",
    );
    if (existingMaster) {
      // Re-use the same master render: clone it under this pair so stats see the pair.
      state.generations.push({ ...existingMaster, id: newId("gen"), pairKey, experimentId: null });
      reused++;
    } else {
      state.generations.push(makeGeneration(state, { scenarioId: sc.id, spec, strategy: master, arm: "master", experimentId: null, pairKey, instructions: "", seed, now }));
      queued++;
    }
    state.generations.push(makeGeneration(state, { scenarioId: sc.id, spec, strategy: trial, arm: "experiment", experimentId: exp.id, pairKey, instructions: exp.instructions, seed, now }));
    queued++;
  }
  exp.status = queued + reused > 0 ? "queued" : exp.status;
  exp.updatedAt = now;
  exp.baseVersion = v.version;
  trimGenerations(state);
  return { queued, reused, skipped };
}

/** A single manual test render (Experiment Lab's "Render this"), not part of a pair. */
export function queueSingle(state: LabState, spec: ShotSpec, overrides: Partial<Strategy> | undefined, experimentId: string | null, now: string, instructions?: string): Generation {
  const v = currentVersion(state.guide);
  const exp = experimentId ? state.experiments.find((e) => e.id === experimentId) : undefined;
  const strategy = strategyFor(v, spec.genre, { ...(exp?.overrides ?? {}), ...cleanOverrides(overrides) });
  const g = makeGeneration(state, {
    scenarioId: "",
    spec,
    strategy,
    arm: exp ? "experiment" : "master",
    experimentId: exp?.id ?? null,
    pairKey: newId("single"),
    instructions: (instructions ?? "").trim() || exp?.instructions || "",
    seed: Math.floor(Math.random() * 2_000_000_000),
    now,
  });
  state.generations.push(g);
  trimGenerations(state);
  return g;
}

function trimGenerations(state: LabState): void {
  if (state.generations.length > MAX_GENERATIONS) state.generations.splice(0, state.generations.length - MAX_GENERATIONS);
}

export function specOfGeneration(state: LabState, g: Generation): ShotSpec | null {
  if (g.spec) return g.spec;
  if (g.productionId) {
    const p = state.productions.find((x) => x.id === g.productionId);
    return p?.scenes.find((s) => s.id === g.sceneId)?.spec ?? null;
  }
  return state.scenarios.find((s) => s.id === g.scenarioId)?.spec ?? null;
}

// ----- worker results -----------------------------------------------------------------------

export function nextQueued(state: LabState): Generation | null {
  // Oldest first, but finish pairs before starting new ones.
  const queued = state.generations.filter((g) => g.status === "queued").sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  const half = queued.find((g) => state.generations.some((o) => o.pairKey === g.pairKey && o.id !== g.id && o.status === "done"));
  return half ?? queued[0] ?? null;
}

export function previousGeneration(state: LabState, g: Generation): Generation | null {
  if (!g.productionId || !g.sceneId) return null;
  const p = state.productions.find((x) => x.id === g.productionId);
  if (!p) return null;
  const idx = p.scenes.findIndex((s) => s.id === g.sceneId);
  const prev = idx > 0 ? p.scenes[idx - 1] : null;
  if (!prev) return null;
  const gens = prev.generationIds.map((id) => state.generations.find((x) => x.id === id)).filter((x): x is Generation => Boolean(x && x.status === "done"));
  return gens[gens.length - 1] ?? null;
}

export function applyResult(state: LabState, id: string, r: { ok: boolean; error?: string; renderSeconds?: number; clipKey?: string | null; localPath?: string | null; bytes?: number; metrics?: ClipMetrics; frameCount?: number }, now: string): Generation | null {
  const g = state.generations.find((x) => x.id === id);
  if (!g) return null;
  g.finishedAt = now;
  if (!r.ok) {
    g.status = "failed";
    g.error = (r.error ?? "Render failed").slice(0, 500);
    return g;
  }
  g.status = "done";
  g.renderSeconds = r.renderSeconds;
  g.clip = { key: r.clipKey ?? null, localPath: r.localPath ?? null, bytes: r.bytes ?? 0 };
  g.frameCount = r.frameCount ?? 0;
  // Keep what was measured even when the shot it came from is gone: the
  // numbers are evidence in their own right, and throwing them away with the
  // spec is how a finished render ends up with nothing to show.
  if (r.metrics) g.metrics = r.metrics;
  const spec = specOfGeneration(state, g);
  if (r.metrics && spec) {
    g.scores = measuredScores(r.metrics, spec, g.strategy.structure);
    g.overall = overallScore(g.scores, g.genre) ?? undefined;
    const prev = previousGeneration(state, g);
    g.issues = sortIssues(measuredIssues(r.metrics, spec, g.strategy.structure, prev?.metrics ?? null));
  }
  // Any clone sharing this render (a reused master) gets the same result.
  for (const o of state.generations) {
    if (o !== g && o.arm === "master" && g.arm === "master" && o.seed === g.seed && o.scenarioId === g.scenarioId && o.guideVersion === g.guideVersion && o.status !== "done" && o.prompt === g.prompt) {
      Object.assign(o, { status: g.status, finishedAt: now, renderSeconds: g.renderSeconds, clip: g.clip, frameCount: g.frameCount, metrics: g.metrics, scores: g.scores, overall: g.overall, issues: g.issues });
    }
  }
  return g;
}

export function applyJudge(state: LabState, id: string, judge: JudgeOutput | null, by: string, now: string): Generation | null {
  const g = state.generations.find((x) => x.id === id);
  if (!g || g.status !== "done") return null;
  const spec = specOfGeneration(state, g);
  const measured: Scores = {};
  for (const d of DIMENSIONS) {
    const s = g.scores?.[d];
    if (s && s.source === "measured") measured[d] = s;
  }
  const vision: Scores = {};
  if (judge) {
    for (const d of DIMENSIONS) {
      const s = judge.scores?.[d];
      if (s && Number.isFinite(s.value)) {
        vision[d] = { value: Math.max(0, Math.min(10, Number(s.value))), confidence: Math.max(0.1, Math.min(0.85, Number(s.confidence) || 0.6)), source: "vision", evidence: String(s.evidence ?? "").slice(0, 300) };
      }
    }
  }
  const owner: Partial<Record<Dimension, number>> = {};
  for (const d of DIMENSIONS) if (g.scores?.[d]?.source === "owner") owner[d] = g.scores[d]!.value;
  g.scores = combineScores(measured, vision, owner);
  g.overall = overallScore(g.scores, g.genre) ?? undefined;
  if (judge && spec && g.metrics) {
    const keep = (g.issues ?? []).filter((i) => i.source === "measured");
    g.issues = sortIssues([...keep, ...judgedIssues(judge.issues ?? [], spec, g.metrics.sampleTimes)]);
  }
  g.judgedAt = now;
  g.judgedBy = by;
  g.judgeSummary = judge?.summary?.slice(0, 600) ?? (by === "measured-only" ? "No judge available — scored from measurements only." : undefined);
  return g;
}

export function rateGeneration(state: LabState, id: string, verdict: Generation["ownerVerdict"], note: string | undefined, scores: Partial<Record<Dimension, number>> | undefined): Generation | null {
  const g = state.generations.find((x) => x.id === id);
  if (!g) return null;
  g.ownerVerdict = verdict;
  if (note !== undefined) g.ownerNote = note.slice(0, 1000);
  if (scores) {
    const next: Scores = { ...(g.scores ?? {}) };
    for (const [d, v] of Object.entries(scores)) {
      if (typeof v === "number") next[d as Dimension] = { value: Math.max(0, Math.min(10, v)), confidence: 1, source: "owner", evidence: "Owner's rating" };
    }
    g.scores = next;
    g.overall = overallScore(next, g.genre) ?? undefined;
  }
  return g;
}

// ----- experiments: progress, conclusions, proposals ---------------------------------------------

export function experimentProgress(state: LabState, id: string): { total: number; done: number; failed: number; judged: number; queued: number } {
  const gens = state.generations.filter((g) => g.pairKey.startsWith(`${id}:`));
  return {
    total: gens.length,
    done: gens.filter((g) => g.status === "done").length,
    failed: gens.filter((g) => g.status === "failed" || g.status === "cancelled").length,
    judged: gens.filter((g) => g.status === "done" && g.judgedAt).length,
    queued: gens.filter((g) => g.status === "queued" || g.status === "claimed" || g.status === "rendering").length,
  };
}

/** Refresh experiment statuses from their generations. */
export function syncExperimentStatus(state: LabState, now: string): void {
  for (const e of state.experiments) {
    if (e.status === "draft" || e.status === "concluded" || e.status === "archived") continue;
    const p = experimentProgress(state, e.id);
    if (!p.total) continue;
    const next = p.queued > 0 ? (p.done > 0 ? "running" : "queued") : p.judged < p.done ? "evaluating" : "evaluating";
    if (next !== e.status) {
      e.status = next;
      e.updatedAt = now;
    }
  }
}

export function experimentPairs(state: LabState, id: string) {
  return pairsOf(state.generations).filter((p) => p.experimentId === id);
}

/** Deterministic conclusion from the paired evidence; the agent may reword it, never change the numbers. */
export function concludeExperiment(state: LabState, id: string, now: string): Experiment | null {
  const e = state.experiments.find((x) => x.id === id);
  if (!e) return null;
  const pairs = experimentPairs(state, id).filter((p) => p.master.judgedAt && p.experiment.judgedAt);
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  for (const d of DIMENSIONS) {
    const deltas = pairs
      .map((p) => {
        const a = p.master.scores?.[d]?.value;
        const b = p.experiment.scores?.[d]?.value;
        return a !== undefined && b !== undefined ? b - a : null;
      })
      .filter((x): x is number => x !== null);
    if (deltas.length < 1) continue;
    const mean = deltas.reduce((s, v) => s + v, 0) / deltas.length;
    const line = `${d}: ${mean >= 0 ? "+" : ""}${mean.toFixed(1)} vs master over ${deltas.length} pair${deltas.length === 1 ? "" : "s"}`;
    if (mean >= 0.5) strengths.push(line);
    else if (mean <= -0.5) weaknesses.push(line);
  }
  const overall = pairs
    .map((p) => {
      const a = overallScore(p.master.scores ?? {}, p.genre);
      const b = overallScore(p.experiment.scores ?? {}, p.genre);
      return a !== null && b !== null ? b - a : null;
    })
    .filter((x): x is number => x !== null);
  const mean = overall.length ? overall.reduce((s, v) => s + v, 0) / overall.length : 0;
  e.strengths = strengths;
  e.weaknesses = weaknesses;
  e.conclusion = pairs.length
    ? `${pairs.length} paired comparison${pairs.length === 1 ? "" : "s"}: genre-weighted overall ${mean >= 0 ? "+" : ""}${mean.toFixed(2)} vs master. ${pairs.length < state.agent.minPairs ? `Fewer than ${state.agent.minPairs} pairs — not enough to promote anything on its own; techniques are judged across experiments.` : "Technique-level evidence is in Comparisons."}`
    : "No paired results finished — nothing to conclude.";
  e.status = "concluded";
  e.updatedAt = now;
  return e;
}

/** All technique stats, overall and per genre with evidence. */
export function allStats(state: LabState): { overall: TechniqueStat[]; byGenre: Map<GenreId, TechniqueStat[]> } {
  const pairs = pairsOf(state.generations).filter((p) => p.master.judgedAt && p.experiment.judgedAt);
  const byGenre = new Map<GenreId, TechniqueStat[]>();
  for (const g of new Set(pairs.map((p) => p.genre))) byGenre.set(g, techniqueStats(pairs, "overall", g));
  return { overall: techniqueStats(pairs, "overall"), byGenre };
}

/**
 * Turn cleared discoveries into ONE pending change: per genre, per knob, the
 * technique with the best lower bound — never a whole experiment. Skips
 * techniques already in the guide or already proposed.
 */
export function proposeCombination(state: LabState, now: string): ChangeRecord | null {
  const v = currentVersion(state.guide);
  const { byGenre } = allStats(state);
  const already = new Set(
    state.guide.changes
      .filter((c) => c.status !== "rejected")
      .flatMap((c) => (c.patch.genreStrategy ?? []).flatMap((g) => Object.entries(g.set).map(([k, val]) => `${g.genre}|${k}=${val}`))),
  );
  const genreStrategy: { genre: GenreId; set: Partial<Strategy> }[] = [];
  const evidence: ChangeRecord["evidence"] = [];
  const experimentIds = new Set<string>();
  for (const [genre, stats] of byGenre) {
    const found = discoveries(stats, state.agent.minPairs, state.agent.minLowerBound);
    const set: Partial<Strategy> = {};
    for (const d of found) {
      const t = parseTechnique(d.technique);
      if (!t || (set as Record<string, string>)[t.knob]) continue;
      if (strategyFor(v, genre)[t.knob] === t.value) continue;
      if (already.has(`${genre}|${t.knob}=${t.value}`)) continue;
      (set as Record<string, string>)[t.knob] = t.value;
      const gens = d.pairKeys.flatMap((k) => state.generations.filter((g) => g.pairKey === k).map((g) => g.id));
      evidence.push({
        text: `${genreName(genre)} — ${techniqueLabel(d.technique)}: overall ${d.effect >= 0 ? "+" : ""}${d.effect.toFixed(2)} (90% interval ${d.ciLo.toFixed(2)}..${d.ciHi.toFixed(2)}, n=${d.n}, ${d.confidence})`,
        technique: d.technique,
        dimension: undefined,
        delta: d.effect,
        ciLo: d.ciLo,
        ciHi: d.ciHi,
        n: d.n,
        generationIds: gens,
      });
      for (const k of d.pairKeys) experimentIds.add(k.split(":")[0]);
    }
    if (Object.keys(set).length) genreStrategy.push({ genre, set });
  }
  if (!genreStrategy.length) return null;
  const titles = genreStrategy.flatMap((g) => Object.entries(g.set).map(([k, val]) => `${genreName(g.genre)}: ${techniqueLabel(`${k}=${val}` as TechniqueId)}`));
  const change: ChangeRecord = {
    id: newId("change"),
    kind: "combination",
    title: titles.length === 1 ? `Adopt ${titles[0]}` : `Adopt ${titles.length} techniques that cleared the evidence bar`,
    why: `Each technique's 90% interval lower bound is above ${state.agent.minLowerBound} on genre-weighted overall score across at least ${state.agent.minPairs} paired renders (same scenario, same seed). Combined per knob, not as a whole experiment.`,
    problem: titles.join("; "),
    experimentIds: [...experimentIds],
    evidence,
    patch: { genreStrategy },
    status: "pending",
    proposedBy: "agent",
    createdAt: now,
  };
  state.guide.changes.push(change);
  return change;
}

/** Auto-promotion: approve a pending agent change when settings allow. */
export function maybeAutoApprove(state: LabState, change: ChangeRecord, now: string): number | null {
  if (state.agent.promotion !== "auto") return null;
  const { guide, version } = approveChange(state.guide, change.id, now, "Auto-promoted: evidence cleared the configured bar.");
  state.guide = guide;
  return version;
}

// ----- offline experiment design -------------------------------------------------------------------

const DIMENSION_KNOBS: Record<Dimension, (keyof Strategy)[]> = {
  character: ["identity", "order"],
  environment: ["environment", "order"],
  continuity: ["structure", "identity"],
  camera: ["camera"],
  action: ["action", "order"],
  movement: ["action", "camera"],
  cinematography: ["camera", "length"],
  dialogue: ["dialogue", "length"],
  genre: ["length", "structure"],
  visual: ["length"],
  adherence: ["length", "order"],
};

/** Which (genre, technique) pairs already have paired evidence. */
function testedTechniques(state: LabState): Set<string> {
  const out = new Set<string>();
  for (const p of pairsOf(state.generations)) for (const t of p.techniques) out.add(`${p.genre}|${t}`);
  for (const e of state.experiments) {
    if (e.status === "archived") continue;
    for (const [k, v] of Object.entries(e.overrides)) for (const scId of e.scenarioIds) {
      const sc = state.scenarios.find((s) => s.id === scId);
      if (sc) out.add(`${sc.spec.genre}|${k}=${v}`);
    }
  }
  return out;
}

/**
 * Design the next single-variable experiment with no AI: the weakest
 * dimension (genre-weighted) picks a knob; the first value of that knob not
 * yet tested in that genre becomes the override. One knob at a time is the
 * cleanest attribution there is.
 */
export function designOffline(state: LabState, now: string): Experiment | null {
  const v = currentVersion(state.guide);
  const tested = testedTechniques(state);
  const genres = [...new Set(state.scenarios.map((s) => s.spec.genre))];
  const candidates: { genre: GenreId; knob: keyof Strategy; value: string; dimension: Dimension; score: number }[] = [];
  for (const genre of genres) {
    const weak = weakestDimensions(state.generations, genre);
    const order: Dimension[] = weak.length ? weak.map((w) => w.dimension) : (["character", "action", "camera", "environment", "continuity"] as Dimension[]);
    order.forEach((d, rank) => {
      for (const knob of DIMENSION_KNOBS[d]) {
        const def = KNOBS.find((k) => k.knob === knob)!;
        const current = strategyFor(v, genre)[knob];
        for (const val of def.values) {
          if (val.value === current || tested.has(`${genre}|${knob}=${val.value}`)) continue;
          candidates.push({ genre, knob, value: val.value, dimension: d, score: rank });
        }
      }
    });
  }
  candidates.sort((a, b) => a.score - b.score);
  const pick = candidates[0];
  if (!pick) return null;
  const scenarioIds = state.scenarios.filter((s) => s.spec.genre === pick.genre).map((s) => s.id);
  const used = new Set(state.experiments.map((e) => e.code));
  let code = "F";
  for (let i = 0; i < 26 * 3; i++) {
    const c = i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`;
    if (!used.has(c)) {
      code = c;
      break;
    }
  }
  const def = KNOBS.find((k) => k.knob === pick.knob)!;
  const val = def.values.find((x) => x.value === pick.value)!;
  const exp: Experiment = {
    id: newId("exp"),
    code,
    name: `${genreName(pick.genre)}: ${val.label}`,
    version: 1,
    hypothesis: `In ${genreName(pick.genre).toLowerCase()} prompts, "${val.label}" (${val.does}) improves ${pick.dimension} over the master's "${def.values.find((x) => x.value === strategyFor(v, pick.genre)[pick.knob])?.label}".`,
    intendedImprovement: `Higher ${pick.dimension} score in ${genreName(pick.genre).toLowerCase()} renders, with nothing else changed.`,
    overrides: { [pick.knob]: pick.value } as Partial<Strategy>,
    instructions: "",
    targets: [pick.dimension],
    scenarioIds,
    baseVersion: v.version,
    status: "draft",
    createdBy: "agent",
    createdAt: now,
    updatedAt: now,
    strengths: [],
    weaknesses: [],
    conclusion: "",
  };
  state.experiments.push(exp);
  return exp;
}

// ----- productions & blueprints ----------------------------------------------------------------------

export function blueprintMeta(b: Blueprint): BlueprintMeta {
  return {
    id: b.id,
    sourceName: b.sourceName,
    durationSec: b.durationSec,
    shotCount: b.shots.length,
    genre: b.genre,
    style: b.style,
    createdAt: b.createdAt,
    cover: b.shots[0]?.keyframes[0] ?? null,
  };
}

/** A new production that keeps the blueprint's structure with the owner's own cast and sets. */
export function recreate(state: LabState, b: Blueprint, title: string, castMap: Record<string, string>, envMap: Record<string, string>, now: string): Production {
  const scenes: ProductionScene[] = b.shots.map((s, i) => {
    const characterIds = s.characters.map((label) => castMap[label]).filter((x): x is string => Boolean(x && state.characters.some((c) => c.id === x)));
    const envKey = Object.keys(envMap).find((label) => s.environment.toLowerCase().includes(label.toLowerCase())) ?? Object.keys(envMap)[0];
    const environmentId = envKey && state.environments.some((e) => e.id === envMap[envKey]) ? envMap[envKey] : null;
    // Replace the reference's people with the new cast in the prose.
    const swap = (text: string) => Object.entries(castMap).reduce((t, [label, id]) => {
      const name = state.characters.find((c) => c.id === id)?.name;
      return name ? t.split(label).join(name) : t;
    }, text);
    const duration = Math.max(4, Math.min(15, Math.round((s.end - s.start) * 2) / 2));
    const spec: ShotSpec = {
      genre: b.genre,
      title: `Shot ${i + 1}`,
      durationSec: duration,
      aspect: b.width >= b.height ? (Math.abs(b.width / b.height - 1) < 0.1 ? "1:1" : "16:9") : "9:16",
      framing: s.camera.angle || "medium shot",
      camera: { move: s.camera.move, amount: s.camera.amount, speed: s.camera.speed },
      action: swap([s.actions, s.positions].filter(Boolean).join(". ")),
      beats: [],
      characterIds,
      environmentId,
      dialogue: s.dialogue && characterIds[0] ? [{ speaker: characterIds[0], line: swap(s.dialogue).replace(/^["']|["']$/g, ""), delivery: s.emotion }] : [],
      mood: s.emotion,
      lighting: s.lighting,
      style: b.style,
      sound: b.sound,
      music: "",
      intentionalChanges: ["position"],
    };
    return { id: newId("scene"), order: i, spec, generationIds: [] };
  });
  const prod: Production = {
    id: newId("prod"),
    title: title || `${b.sourceName} — recreated`,
    genre: b.genre,
    logline: `Recreates the structure of "${b.sourceName}" (${b.shots.length} shots, ${b.durationSec.toFixed(0)}s) with a new cast.`,
    style: b.style,
    story: b.shots.map((s, i) => `${i + 1}. ${s.actions}`).join("\n"),
    characterIds: [...new Set(Object.values(castMap).filter(Boolean))],
    environmentIds: [...new Set(Object.values(envMap).filter(Boolean))],
    cameraLanguage: [...new Set(b.shots.map((s) => s.camera.move))].join(", "),
    continuityRules: [`Editing rhythm: ${b.editingRhythm}`],
    scenes,
    blueprintId: b.id,
    createdAt: now,
    updatedAt: now,
  };
  state.productions.push(prod);
  return prod;
}

export function compileProduction(state: LabState, id: string, now: string): Production | null {
  const p = state.productions.find((x) => x.id === id);
  if (!p) return null;
  const v = currentVersion(state.guide);
  let previous: { endsOn: string } | null = null;
  for (const sc of p.scenes.sort((a, b) => a.order - b.order)) {
    const strat = strategyFor(v, sc.spec.genre);
    const c = compileSpec(state, sc.spec, strat, p.continuityRules.join(" "), previous);
    sc.compiled = { prompt: c.prompt, guideVersion: v.version, at: now };
    previous = { endsOn: sc.spec.action.split(/[.;]/).filter(Boolean).pop() ?? "" };
  }
  p.updatedAt = now;
  return p;
}

export function renderProduction(state: LabState, id: string, sceneIds: string[] | undefined, now: string): number {
  const p = state.productions.find((x) => x.id === id);
  if (!p) return 0;
  const v = currentVersion(state.guide);
  let n = 0;
  for (const sc of p.scenes) {
    if (sceneIds && !sceneIds.includes(sc.id)) continue;
    const strat = strategyFor(v, sc.spec.genre);
    const g = makeGeneration(state, {
      scenarioId: "",
      spec: sc.spec,
      strategy: strat,
      arm: "master",
      experimentId: null,
      pairKey: newId("prod"),
      instructions: p.continuityRules.join(" "),
      seed: Math.floor(Math.random() * 2_000_000_000),
      now,
    });
    g.productionId = p.id;
    g.sceneId = sc.id;
    state.generations.push(g);
    sc.generationIds.push(g.id);
    n++;
  }
  p.updatedAt = now;
  return n;
}

export function issuesOf(state: LabState): { generation: Generation; issue: InspectionIssue }[] {
  return state.generations.flatMap((g) => (g.issues ?? []).map((issue) => ({ generation: g, issue })));
}
