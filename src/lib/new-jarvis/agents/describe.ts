// ---------------------------------------------------------------------------
// What a runner is told.
//
// This is the only place an agent turns into words for a machine, and it is
// pure so it can be tested. Two things it must get right, because the whole
// feature stands on them:
//
//   1. The HANDOFF NOTE comes first, above the steps. A runner that reads the
//      goal and the steps but not the note will start again from the top, and
//      the owner will watch step one happen every morning forever.
//
//   2. It must say what to call next. A runner that finishes a step and then
//      goes quiet leaves the agent leased until it expires, which looks to
//      the owner like twenty idle minutes.
// ---------------------------------------------------------------------------

import {
  NEED_LABEL,
  leaseHeld,
  progressOf,
  sortAgents,
  statusLine,
  type Agent,
  type AgentsDoc,
} from "./agents";

/** The one-line form used in a list. */
export function agentLine(agent: Agent, now: number): string {
  const { done, total } = progressOf(agent);
  const needs = agent.needs.length ? agent.needs.map((n) => NEED_LABEL[n]).join(" + ") : "any machine";
  return `- ${agent.id} · ${agent.status} · ${done}/${total} steps · needs ${needs} — ${agent.goal}`;
}

export function describeAgents(doc: AgentsDoc, now: number): string {
  const live = sortAgents(doc.agents).filter((a) => a.status !== "done");
  if (!live.length) return "No 24/7 agents right now.";
  return [
    `${live.length} 24/7 agent${live.length === 1 ? "" : "s"}:`,
    ...live.map((a) => agentLine(a, now)),
    "",
    "Call agent_next with what this machine has to pick one up.",
  ].join("\n");
}

/**
 * The full brief handed to a runner that has just claimed an agent.
 *
 * Written as instructions rather than as a record, because the reader is
 * about to act on it.
 */
export function briefFor(agent: Agent, now: number): string {
  const { done, total } = progressOf(agent);
  const out: string[] = [
    `You have picked up 24/7 agent ${agent.id}. You hold it for the next 20 minutes.`,
    "",
    `GOAL: ${agent.goal}`,
  ];

  if (agent.needs.length) {
    out.push(`This agent needs: ${agent.needs.map((n) => NEED_LABEL[n]).join(", ")}.`);
  }

  // Above the steps, deliberately. See the note at the top of this file.
  if (agent.handoff) {
    out.push(
      "",
      `WHERE THE LAST MACHINE GOT TO (${agent.handoff.by}, ${agent.handoff.at}):`,
      agent.handoff.text,
      "",
      "Carry on from there. Do not start again from the first step.",
    );
  }

  if (agent.blockedWhy) {
    out.push("", `It was blocked: ${agent.blockedWhy}`, "If you can get past that, do; if not, say so with agent_handoff.");
  }

  if (total) {
    out.push("", `STEPS (${done}/${total} done):`);
    for (const s of agent.steps) {
      const mark = s.done ? "[x]" : "[ ]";
      const tail = s.done && s.note ? ` — ${s.note}` : "";
      out.push(`${mark} ${s.id}: ${s.text}${tail}`);
    }
  }

  if (agent.images.length) {
    out.push("", `${agent.images.length} picture(s) came with this agent; they are on the agent in Jarvis.`);
  }

  out.push(
    "",
    "As you work:",
    "- agent_note with id and note (and step: the step id) each time a step is finished.",
    "- agent_handoff with id and note BEFORE you stop for any reason — a closed laptop, a long render left running, running out of time. Say exactly where you got to and what the next machine should do first. This is what lets the work resume instead of starting over.",
    "- agent_note with id and blocked: true when it needs the owner (a key, a decision).",
    "- agent_done with id and result when the goal is actually met.",
    "If you simply stop without calling agent_handoff, the agent sits idle until the lease expires.",
  );
  return out.join("\n");
}

/** What a runner sees when it offered to help and there was nothing for it. */
export function nothingFor(why: string | undefined, have: string[]): string {
  const machine = have.length ? have.join(", ") : "nothing in particular";
  return [why || "No 24/7 agents are waiting.", `This machine reported: ${machine}.`].join("\n");
}

/** The owner-facing one-liner, reused by the UI and by the connector. */
export function ownerLine(agent: Agent, now: number): string {
  return statusLine(agent, now);
}

/** True when a runner currently holds it — used to warn before the owner removes one. */
export function busyNow(agent: Agent, now: number): boolean {
  return leaseHeld(agent, now);
}
