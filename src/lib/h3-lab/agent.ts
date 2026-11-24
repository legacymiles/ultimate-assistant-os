// ---------------------------------------------------------------------------
// The autonomous loop's brain stem: given the lab's state, what is the next
// useful step? Pure, so it is tested, and so every caller (the PC worker's
// idle tick, the open page, a scheduled job) makes the same decision.
//
// Priority order — finish what is in flight before starting anything new:
//   evaluate → conclude → combine → queue → design → research → idle
// Pause and stop are honoured before anything else.
// ---------------------------------------------------------------------------

import type { AgentStepKind, LabState } from "./model";
import { allStats, aiCallsLeft, experimentProgress, rendersLeft } from "./state";
import { discoveries } from "./score";
import { currentVersion, strategyFor } from "./guide";
import { parseTechnique } from "./strategy";

export interface NextStep {
  kind: AgentStepKind;
  /** Generation / experiment the step works on. */
  target: string | null;
  reason: string;
}

const RESEARCH_EVERY_MS = 24 * 3600 * 1000;

export function nextStep(state: LabState, now: string): NextStep {
  if (state.agent.mode !== "running") return { kind: "idle", target: null, reason: `Agent is ${state.agent.mode}.` };

  const thinking = state.think.some((t) => t.state === "queued" || t.state === "claimed");

  // 1. Evaluate finished renders that no judge has looked at.
  const unjudged = state.generations
    .filter((g) => g.status === "done" && !g.judgedAt && g.frameCount)
    .sort((a, b) => (a.finishedAt ?? "").localeCompare(b.finishedAt ?? ""));
  if (unjudged.length && !thinking) {
    return { kind: "evaluate", target: unjudged[0].id, reason: `${unjudged.length} finished render${unjudged.length === 1 ? "" : "s"} waiting for evaluation.` };
  }

  // 2. Conclude experiments whose renders have all finished and been judged.
  for (const e of state.experiments) {
    if (!["queued", "running", "evaluating"].includes(e.status)) continue;
    const p = experimentProgress(state, e.id);
    if (p.total > 0 && p.queued === 0 && p.judged + p.failed >= p.total) {
      return { kind: "conclude", target: e.id, reason: `Experiment ${e.code} has finished all ${p.total} renders.` };
    }
  }

  // 3. Combine: any technique that cleared the bar and is not yet in the guide or proposed.
  if (hasNewDiscovery(state)) return { kind: "combine", target: null, reason: "A technique cleared the evidence bar and is not in the guide yet." };

  // 4. Queue a drafted experiment if capacity allows.
  const active = state.experiments.filter((e) => ["queued", "running", "evaluating"].includes(e.status)).length;
  const renders = rendersLeft(state, now);
  const draft = state.experiments.filter((e) => e.status === "draft").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (draft && active < state.agent.maxConcurrentExperiments && renders > 0) {
    return { kind: "queue", target: draft.id, reason: `Capacity for ${state.agent.maxConcurrentExperiments - active} more experiment(s); ${renders} renders left today.` };
  }

  // 5. Design a new experiment when nothing is drafted and there is room.
  if (!draft && active < state.agent.maxConcurrentExperiments && renders > 0) {
    return { kind: "design", target: null, reason: "No drafted experiment and capacity is free." };
  }

  // 6. Research new repositories and techniques once a day.
  const last = state.lastResearchAt ? Date.parse(state.lastResearchAt) : 0;
  if (Date.parse(now) - last > RESEARCH_EVERY_MS && aiCallsLeft(state, now) > 0) {
    return { kind: "research", target: null, reason: "Daily research pass is due." };
  }

  return { kind: "idle", target: null, reason: renders <= 0 ? "Today's render budget is spent." : "Waiting on renders in progress." };
}

export function hasNewDiscovery(state: LabState): boolean {
  const v = currentVersion(state.guide);
  const proposed = new Set(
    state.guide.changes
      .filter((c) => c.status !== "rejected")
      .flatMap((c) => (c.patch.genreStrategy ?? []).flatMap((g) => Object.entries(g.set).map(([k, val]) => `${g.genre}|${k}=${val}`))),
  );
  const { byGenre } = allStats(state);
  for (const [genre, stats] of byGenre) {
    for (const d of discoveries(stats, state.agent.minPairs, state.agent.minLowerBound)) {
      const t = parseTechnique(d.technique);
      if (!t) continue;
      if (strategyFor(v, genre)[t.knob] === t.value) continue;
      if (proposed.has(`${genre}|${t.knob}=${t.value}`)) continue;
      return true;
    }
  }
  return false;
}
