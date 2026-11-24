import "server-only";
import type { StepResult } from "../api";
import type { Generation, LabState, RepoRow, ThinkJob } from "../model";
import { nextStep, type NextStep } from "../agent";
import {
  aiCallsLeft,
  applyJudge,
  concludeExperiment,
  designOffline,
  experimentProgress,
  log,
  maybeAutoApprove,
  newId,
  previousGeneration,
  proposeCombination,
  queueExperiment,
  rendersLeft,
  specOfGeneration,
} from "../state";
import { weakestDimensions } from "../score";
import { DIMENSION_LABEL } from "../model";
import { genreName } from "../genres";
import { askAsText, askHub, brainAvailable, judgeAsk, parseJudge, parseResearch, researchAsk, type Ask } from "./brain";
import { loadFrames, loadLab, mutateLab } from "./store";
import { searchWeb } from "@/lib/search/client";

// ---------------------------------------------------------------------------
// One agent step. Called by the PC worker's idle tick, the open page, and the
// scheduled tick — all through POST /api/h3-lab/agent/tick.
//
// Slow work (an AI call, a web search) happens OUTSIDE the write lock; the
// result is then applied inside mutateLab with the target re-checked, so a
// 20-second vision call never blocks the worker's progress reports.
// ---------------------------------------------------------------------------

const now = () => new Date().toISOString();

export async function runStep(uid: string, actor: "agent" | "owner" = "agent"): Promise<{ step: StepResult; state: LabState }> {
  const snapshot = await loadLab(uid);
  const decision = nextStep(snapshot, now());
  try {
    switch (decision.kind) {
      case "evaluate":
        return await evaluate(uid, snapshot, decision);
      case "conclude":
        return await conclude(uid, decision);
      case "combine":
        return await combine(uid);
      case "queue":
        return await queue(uid, decision);
      case "design":
        return await design(uid);
      case "research":
        return await research(uid, snapshot);
      default:
        return { step: { kind: "idle", did: decision.reason, changed: false }, state: snapshot };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const { state } = await mutateLab(uid, (s) => log(s, "system", "error", `Step "${decision.kind}" failed: ${msg}`, undefined, now()));
    void actor;
    return { step: { kind: decision.kind, did: `Failed: ${msg}`, changed: false }, state };
  }
}

// ----- evaluate -----------------------------------------------------------------------

async function evaluate(uid: string, snapshot: LabState, decision: NextStep) {
  const g = snapshot.generations.find((x) => x.id === decision.target)!;
  const spec = specOfGeneration(snapshot, g);
  const frames = await loadFrames(uid, g.id);
  const prev = previousGeneration(snapshot, g);
  const prevFrames = prev ? (await loadFrames(uid, prev.id)).slice(-2) : [];
  const brain = brainAvailable(snapshot);
  const budget = aiCallsLeft(snapshot, now());

  if (!spec || !frames.length || !brain.ok || budget <= 0) {
    const why = !spec ? "its shot spec is gone" : !frames.length ? "no frames were stored" : budget <= 0 ? "today's AI budget is spent" : brain.why;
    const { state } = await mutateLab(uid, (s) => {
      applyJudge(s, g.id, null, "measured-only", now());
      log(s, "agent", "evaluate", `Scored ${label(s, g)} from measurements only — ${why}.`, { type: "generation", id: g.id }, now());
    });
    return { step: { kind: "evaluate" as const, did: `Measured-only score for ${g.id} (${why})`, changed: true }, state };
  }

  const ask = judgeAsk(g, spec, frames, prevFrames, snapshot);
  if (snapshot.agent.brain === "claude-code") {
    const { state } = await mutateLab(uid, (s) => {
      if (s.think.some((t) => t.context.generationId === g.id && (t.state === "queued" || t.state === "claimed"))) return;
      s.think.push(thinkJob("evaluate", ask, { generationId: g.id }));
      log(s, "agent", "evaluate", `Asked Claude Code on the PC to judge ${label(s, g)} (${frames.length} frames).`, { type: "generation", id: g.id }, now());
    });
    return { step: { kind: "evaluate" as const, did: "Handed the evaluation to Claude Code on the PC", changed: true }, state };
  }

  const text = await askHub(ask, snapshot.agent.model);
  const judge = parseJudge(text);
  const { state } = await mutateLab(uid, (s) => {
    s.counters.aiCalls++;
    const target = s.generations.find((x) => x.id === g.id);
    if (!target || target.judgedAt) return;
    applyJudge(s, g.id, judge, judge ? s.agent.model : "measured-only", now());
    const issues = (target.issues ?? []).filter((i) => i.source === "vision").length;
    log(s, "agent", "evaluate", judge ? `Evaluated ${label(s, g)}: overall ${target.overall?.toFixed(1) ?? "—"}, ${issues} visual issue${issues === 1 ? "" : "s"} found by the judge.` : `The judge's answer for ${label(s, g)} could not be read; kept the measured scores.`, { type: "generation", id: g.id }, now());
  });
  return { step: { kind: "evaluate" as const, did: `Evaluated ${g.id}`, changed: true }, state };
}

function label(s: LabState, g: Generation): string {
  const sc = s.scenarios.find((x) => x.id === g.scenarioId);
  const exp = g.experimentId ? s.experiments.find((e) => e.id === g.experimentId) : null;
  return `${sc ? `"${sc.title}"` : genreName(g.genre)} (${g.arm}${exp ? ` · ${exp.code}` : ""})`;
}

// ----- conclude / combine -------------------------------------------------------------------

async function conclude(uid: string, decision: NextStep) {
  const { state, value } = await mutateLab(uid, (s) => {
    const e = concludeExperiment(s, decision.target!, now());
    if (!e) return null;
    log(s, "agent", "conclude", `Concluded experiment ${e.code} "${e.name}": ${e.conclusion}${e.strengths.length ? ` Stronger on ${e.strengths.map((x) => x.split(":")[0]).join(", ")}.` : ""}${e.weaknesses.length ? ` Weaker on ${e.weaknesses.map((x) => x.split(":")[0]).join(", ")}.` : ""}`, { type: "experiment", id: e.id }, now());
    log(s, "agent", "compare", `Compared ${experimentProgress(s, e.id).done} renders of ${e.code} pair by pair against the master guide.`, { type: "experiment", id: e.id }, now());
    return e.code;
  });
  return { step: { kind: "conclude" as const, did: value ? `Concluded experiment ${value}` : "Nothing to conclude", changed: Boolean(value) }, state };
}

async function combine(uid: string) {
  const { state, value } = await mutateLab(uid, (s) => {
    const change = proposeCombination(s, now());
    if (!change) return null;
    log(s, "agent", "propose", `Proposed a guide change: ${change.title}. ${change.evidence.length} piece${change.evidence.length === 1 ? "" : "s"} of evidence.`, { type: "change", id: change.id }, now());
    const v = maybeAutoApprove(s, change, now());
    if (v) log(s, "agent", "approve", `Auto-promoted to Master Guide v${v} (promotion is set to automatic).`, { type: "change", id: change.id }, now());
    return change.title;
  });
  return { step: { kind: "combine" as const, did: value ? `Proposed: ${value}` : "No new technique cleared the bar", changed: Boolean(value) }, state };
}

// ----- queue / design ----------------------------------------------------------------------------

async function queue(uid: string, decision: NextStep) {
  const { state, value } = await mutateLab(uid, (s) => {
    const e = s.experiments.find((x) => x.id === decision.target);
    if (!e || e.status !== "draft") return null;
    const r = queueExperiment(s, e.id, now());
    if (r.queued + r.reused === 0) {
      e.status = "archived";
      log(s, "agent", "compile-tests", `Archived ${e.code} "${e.name}": it changes nothing for its scenarios' genres under the current guide${r.skipped.length ? ` (${r.skipped.join(", ")})` : ""}.`, { type: "experiment", id: e.id }, now());
      return `Archived ${e.code}`;
    }
    log(s, "agent", "compile-tests", `Compiled ${e.code} "${e.name}" against Master Guide v${e.baseVersion} for ${e.scenarioIds.length - r.skipped.length} scenario(s).`, { type: "experiment", id: e.id }, now());
    log(s, "agent", "queue-render", `Queued ${r.queued} render${r.queued === 1 ? "" : "s"} for ${e.code}${r.reused ? ` (re-using ${r.reused} master render${r.reused === 1 ? "" : "s"})` : ""}; ${rendersLeft(s, now())} left in today's budget.`, { type: "experiment", id: e.id }, now());
    return `Queued ${e.code}`;
  });
  return { step: { kind: "queue" as const, did: value ?? "Nothing queued", changed: Boolean(value) }, state };
}

async function design(uid: string) {
  const { state, value } = await mutateLab(uid, (s) => {
    const weak = weakestDimensions(s.generations);
    if (weak.length) log(s, "agent", "weakness", `Weakest scored dimensions so far: ${weak.slice(0, 3).map((w) => `${DIMENSION_LABEL[w.dimension]} ${w.mean.toFixed(1)} (n=${w.n})`).join(", ")}.`, undefined, now());
    const e = designOffline(s, now());
    if (!e) {
      log(s, "agent", "design-experiment", "Every knob value has been tested for every scenario genre — add scenarios in new genres to keep researching.", undefined, now());
      return null;
    }
    log(s, "agent", "design-experiment", `Designed experiment ${e.code} "${e.name}": ${e.hypothesis}`, { type: "experiment", id: e.id }, now());
    return e.code;
  });
  return { step: { kind: "design" as const, did: value ? `Designed experiment ${value}` : "No untested technique left", changed: Boolean(value) }, state };
}

// ----- research ------------------------------------------------------------------------------------

const QUERIES = [
  "MiniMax H3 video github",
  "video generation character consistency open source github",
  "AI video continuity evaluation metric github",
  "shot boundary detection github",
];

async function research(uid: string, snapshot: LabState) {
  const day = Math.floor(Date.now() / 86_400_000) % QUERIES.length;
  const query = QUERIES[day];
  let results: { title: string; url: string; description: string }[] = [];
  try {
    const res = await searchWeb(`${query} site:github.com`, { app: "h3-prompt-lab", limit: 10 });
    results = (res.results ?? []).filter((r) => /github\.com\/[\w.-]+\/[\w.-]+/.test(r.url)).map((r) => ({ title: r.title, url: r.url.replace(/\/(tree|blob)\/.*$/, "").replace(/\/$/, ""), description: r.description }));
  } catch (e) {
    const { state } = await mutateLab(uid, (s) => {
      s.lastResearchAt = now();
      log(s, "agent", "research", `Research search "${query}" failed: ${e instanceof Error ? e.message : e}.`, undefined, now());
    });
    return { step: { kind: "research" as const, did: "Search failed", changed: true }, state };
  }
  const fresh = results.filter((r) => !snapshot.repos.some((k) => k.url.toLowerCase() === r.url.toLowerCase()));
  const brain = brainAvailable(snapshot);
  let found: Partial<RepoRow>[] = [];
  if (fresh.length && brain.ok && snapshot.agent.brain === "hub-ai" && aiCallsLeft(snapshot, now()) > 0) {
    found = parseResearch(await askHub(researchAsk(fresh, snapshot.repos), snapshot.agent.model));
  } else if (fresh.length && brain.ok && snapshot.agent.brain === "claude-code") {
    const { state } = await mutateLab(uid, (s) => {
      s.lastResearchAt = now();
      s.think.push(thinkJob("research", researchAsk(fresh, s.repos), {}));
      log(s, "agent", "research", `Searched "${query}": ${fresh.length} unseen GitHub repositories; asked Claude Code on the PC to review them.`, undefined, now());
    });
    return { step: { kind: "research" as const, did: "Research handed to Claude Code", changed: true }, state };
  }
  const { state } = await mutateLab(uid, (s) => {
    s.lastResearchAt = now();
    if (found.length) s.counters.aiCalls++;
    const added = addRepos(s, found);
    log(s, "agent", "research", `Searched "${query}": ${results.length} GitHub result${results.length === 1 ? "" : "s"}, ${fresh.length} not seen before${found.length || brain.ok ? `, ${added} added for review` : ` (no reasoning available to review them: ${brain.why})`}.`, added ? { type: "repo", id: "" } : undefined, now());
  });
  return { step: { kind: "research" as const, did: `Research: ${fresh.length} unseen results`, changed: true }, state };
}

export function addRepos(s: LabState, found: Partial<RepoRow>[]): number {
  let added = 0;
  for (const r of found.slice(0, 4)) {
    if (!r.url || s.repos.some((k) => k.url.toLowerCase() === r.url!.toLowerCase())) continue;
    s.repos.push({
      id: newId("repo"),
      name: String(r.name ?? r.url.replace("https://github.com/", "")),
      url: r.url,
      description: String(r.description ?? ""),
      capabilities: Array.isArray(r.capabilities) ? r.capabilities.map(String).slice(0, 8) : [],
      license: String(r.license ?? "unknown"),
      compatibility: (["good", "partial", "poor", "unknown"].includes(String(r.compatibility)) ? r.compatibility : "unknown") as RepoRow["compatibility"],
      compatibilityNote: String(r.compatibilityNote ?? ""),
      reusable: Array.isArray(r.reusable) ? r.reusable.map(String).slice(0, 8) : [],
      recommendation: (["integrate", "adapt", "learn", "skip", "review"].includes(String(r.recommendation)) ? r.recommendation : "review") as RepoRow["recommendation"],
      integration: "not-integrated",
      reviewedAt: null,
      discoveredBy: "agent",
      notes: "Found by the agent's research pass — not installed. Review before anything is integrated.",
    });
    added++;
  }
  return added;
}

// ----- think jobs (Claude Code on the PC) ---------------------------------------------------------------

function thinkJob(step: ThinkJob["step"], ask: Ask, context: Record<string, string>): ThinkJob {
  return { id: newId("think"), step, prompt: askAsText(ask), images: ask.images, state: "queued", createdAt: now(), context };
}

/** Apply a think job's answer exactly as the hub-AI path would have. */
export async function applyThink(uid: string, jobId: string, ok: boolean, result: string | undefined, error: string | undefined): Promise<LabState> {
  const { state } = await mutateLab(uid, (s) => {
    const job = s.think.find((t) => t.id === jobId);
    if (!job) return;
    job.state = ok ? "done" : "failed";
    job.result = result?.slice(0, 20_000);
    job.error = error?.slice(0, 1000);
    if (!ok) {
      log(s, "worker", "error", `Claude Code could not finish the ${job.step} job: ${error ?? "no answer"}.`, undefined, now());
      if (job.step === "evaluate" && job.context.generationId) {
        applyJudge(s, job.context.generationId, null, "measured-only", now());
      }
    } else if (job.step === "evaluate" && job.context.generationId) {
      const judge = parseJudge(result ?? "");
      const g = applyJudge(s, job.context.generationId, judge, judge ? "claude-code" : "measured-only", now());
      if (g) log(s, "agent", "evaluate", judge ? `Claude Code evaluated ${label(s, g)}: overall ${g.overall?.toFixed(1) ?? "—"}.` : `Claude Code's answer for ${label(s, g)} could not be read; kept the measured scores.`, { type: "generation", id: g.id }, now());
    } else if (job.step === "research") {
      const added = addRepos(s, parseResearch(result ?? ""));
      log(s, "agent", "research", `Claude Code reviewed the research results: ${added} repositor${added === 1 ? "y" : "ies"} added for your review.`, undefined, now());
    }
    // Keep the last 50 jobs.
    if (s.think.length > 50) s.think.splice(0, s.think.length - 50);
  });
  return state;
}
