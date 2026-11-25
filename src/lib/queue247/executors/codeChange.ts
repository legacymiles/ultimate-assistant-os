// ---------------------------------------------------------------------------
// Code change — "improve my H3 Prompt Lab", "create a new app inside Trading
// Studio". The queue does not write code itself: changing the owner's repo is
// what the Jarvis harness on the PC already does safely (its own git worktree,
// the unattended allow/block policy, review-before-land). So this executor
// files a 24/7 agent with `edits: [app]` in the existing agents store and then
// FOLLOWS it, mirroring its real progress, log and outcome onto the queue card.
//
// Nothing is faked while the PC is asleep: the card says it is waiting for a
// machine that can run Claude Code, and moves the moment one claims the work.
// ---------------------------------------------------------------------------

import type { StepResult } from "../engine";
import type { Executor, StepContext } from "./types";
import { add, newAgent, progressOf, type Agent } from "@/lib/new-jarvis/agents/agents";
import { readAgents, updateAgents } from "@/lib/new-jarvis/server/agentsStore";
import { PROJECTS } from "@/lib/catalog";

interface CodeState {
  agentId?: string;
  seenLog?: number;
  lastStatus?: string;
}

const CHECK_EVERY_MS = 3 * 60_000;

function appName(slug: string): string {
  return PROJECTS.find((p) => p.slug === slug)?.title ?? slug;
}

export function goalFor(task: { instruction: string; title: string; app: string; config: Record<string, unknown> }): string {
  const app = task.app;
  const lines = [
    task.instruction || task.title,
    app ? `App: ${appName(app)} (/apps/${app}). Read docs/apps/${app}.md first and update it in the same commit.` : "",
    typeof task.config.details === "string" ? `Details: ${task.config.details}` : "",
    "Follow the repo's AGENTS.md and CLAUDE.md, the app-pipeline skill and the build checklist. Leave the work on a branch for review.",
  ];
  return lines.filter(Boolean).join("\n").slice(0, 1900);
}

async function run(ctx: StepContext): Promise<StepResult> {
  const st = ctx.state as CodeState;
  const uid = ctx.task.user_id;

  if (!st.agentId) {
    const app = ctx.task.app;
    const steps = Array.isArray(ctx.task.config.steps) ? (ctx.task.config.steps as unknown[]).map(String).slice(0, 12) : undefined;
    const agent = newAgent({
      goal: goalFor(ctx.task),
      needs: ["shell"],
      edits: app ? [app] : [],
      folder: app ? `app:${app}` : undefined,
      from: "24/7 queue",
      steps,
      ship: "review",
      repeat: "once",
    });
    await updateAgents(uid, (doc) => add(doc, agent));
    st.agentId = agent.id;
    st.seenLog = agent.log.length;
    await ctx.log(
      `Handed to Claude Code as 24/7 agent ${agent.id}${app ? ` (edits ${appName(app)})` : ""}. It runs in its own worktree on your PC and stops for your review before anything lands.`,
      { agentId: agent.id },
      "step",
    );
    await ctx.progress(5, "Waiting for a machine with Claude Code");
    return { outcome: "wait", until: new Date(ctx.now().getTime() + CHECK_EVERY_MS).toISOString() };
  }

  const doc = await readAgents(uid);
  const agent: Agent | undefined = doc.agents.find((a) => a.id === st.agentId);
  if (!agent) {
    return { outcome: "failed", error: `24/7 agent ${st.agentId} was removed, so this change was never finished.`, retryable: false };
  }

  // Mirror every new line of the agent's own log.
  const fresh = agent.log.slice(st.seenLog ?? 0);
  for (const line of fresh) await ctx.log(`[${line.by}] ${line.text}`, { kind: line.kind });
  st.seenLog = agent.log.length;

  const p = progressOf(agent);
  const pct = p.total ? Math.round((p.done / p.total) * 90) + 5 : 5;
  ctx.steps.splice(
    0,
    ctx.steps.length,
    ...agent.steps.map((s) => ({ id: s.id, label: s.text, state: s.done ? ("done" as const) : ("pending" as const), note: s.note, at: s.at })),
  );

  if (agent.status !== st.lastStatus) {
    st.lastStatus = agent.status;
    if (agent.status === "running") await ctx.log(`${agent.lease?.by ?? "A machine"} picked it up.`, undefined, "step");
  }

  switch (agent.status) {
    case "done": {
      const t = agent.thread;
      const summary = t
        ? `Claude Code finished: ${t.outcome === "ready" ? `branch ${t.branch} is ready for your review` : `${t.outcome}${t.why ? ` — ${t.why}` : ""}`}.`
        : `Claude Code finished: ${agent.log[agent.log.length - 1]?.text ?? "done"}`;
      if (t?.outcome === "ready") await ctx.notify("A change is ready for review", summary, "/apps/jarvis#queue");
      return { outcome: "done", summary };
    }
    case "blocked":
      return { outcome: "needs_input", question: agent.blockedWhy || "Claude Code is blocked and needs you — open Jarvis › Queue › 24/7 agents." };
    case "paused":
      await ctx.progress(pct, "Paused in 24/7 agents");
      return { outcome: "wait", until: new Date(ctx.now().getTime() + CHECK_EVERY_MS * 3).toISOString(), summary: "The 24/7 agent is paused." };
    case "running":
      await ctx.progress(pct, `Claude Code working — ${p.done}/${p.total} steps`);
      return { outcome: "wait", until: new Date(ctx.now().getTime() + CHECK_EVERY_MS).toISOString() };
    default:
      await ctx.progress(pct, agent.handoff ? `Resuming: ${agent.handoff.text.slice(0, 80)}` : "Waiting for your PC (Claude Code) to wake");
      return { outcome: "wait", until: new Date(ctx.now().getTime() + CHECK_EVERY_MS).toISOString() };
  }
}

export const codeChangeExecutor: Executor = {
  id: "code-change",
  agent: "Claude Code (harness)",
  describe:
    "Changes code in one of the owner's hub apps — improve, fix, add a feature, create a new app or section. Runs Claude Code in an isolated worktree on the owner's PC and stops for review; the queue card follows it live.",
  configHelp: {
    details: "Extra detail for the change.",
    steps: "Optional ordered list of steps (strings).",
  },
  needs: [],
  defaultKind: "once",
  concurrency: 4,
  initialSteps: () => ["Hand to Claude Code", "Claude Code works in its own worktree", "Ready for your review"],
  run,
};
