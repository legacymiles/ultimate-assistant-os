// ---------------------------------------------------------------------------
// The chat's workbench: real coding agents, started and steered from a message.
//
// Everything else in the chat is a tool that answers in a step or two. A
// harness thread is the opposite shape — it runs for ten minutes, it edits a
// repository in its own worktree, and it can stop to ask a question. The
// bridge already knows how to run one (`/harness/*`), and App Builder and
// Client Review already drive it. What was missing was the CHAT driving it:
// "add dark mode to my site" could browse and read, but it could not hand the
// job to an agent that actually writes, tests and commits.
//
// So this file is the chat's half of that. It is deliberately small and dumb:
// start a thread, poll its ledger, answer its one gate, land its branch. The
// judgement about WHEN to do that lives in the model's instructions, and the
// machinery lives in the bridge — not here.
//
// The digest matters most. A thread emits thousands of token deltas; a tool
// result has to be a few hundred tokens or the chat's own context dies before
// the build finishes. `digest()` folds the bridge's event ring into what a
// person would say if you asked "how is it going?".
// ---------------------------------------------------------------------------

import { emptyThread, reduceEvents } from "./harness/model";
import type { HarnessEvent, HarnessId, ThreadSummary, ToolRow } from "./harness/types";
import type { Trust } from "./trust";

/** The two things the bridge can actually run. See harness.mjs. */
export const WORK_HARNESSES: { id: HarnessId; label: string }[] = [
  { id: "deepseek", label: "DeepSeek Harness" },
  { id: "claude", label: "Claude Code" },
];

/** One page-to-bridge call. Matches `call` in bridge.ts without importing it (tests). */
export interface WorkBridge {
  call<T = Record<string, unknown>>(route: string, args?: Record<string, unknown>): Promise<T>;
  /** The checkout on this PC, from the bridge's /health. */
  folder?: string;
}

export interface WorkDeps {
  /** Injected so tests do not wait in real time. */
  wait?: (ms: number) => Promise<void>;
  /** Never wait longer than this for the first sign of life. */
  waitMs?: number;
  /** The Chat's Permissions setting, applied to a thread the Chat starts. */
  trust?: Trust;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// ---------------------------------------------------------------------------
// Reading a thread
// ---------------------------------------------------------------------------

export interface WorkStep {
  tool: string;
  status: string;
  title: string;
  /** Only for failures: the first line of what went wrong. */
  said?: string;
}

export interface WorkGate {
  gateId: string;
  name: string;
  title: string;
  why: string;
  risk: string;
}

export interface WorkDigest {
  status: ThreadSummary["status"] | "missing";
  busy: boolean;
  cursor: number;
  usd: number;
  /** The last thing the agent said, trimmed. Empty while it is only thinking. */
  said: string;
  steps: WorkStep[];
  gate: WorkGate | null;
  error: string;
  notes: string[];
  dropped: boolean;
}

/** Long enough to carry a plan; short enough that a chat turn still fits. */
const SAID_LIMIT = 2_400;
const STEP_LIMIT = 24;

function trim(text: string, n: number): string {
  const clean = text.trim();
  return clean.length > n ? `${clean.slice(0, n)}\n… (${clean.length - n} more characters)` : clean;
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
}

function stepOf(row: ToolRow): WorkStep {
  const out: WorkStep = { tool: row.name, status: row.status, title: row.title };
  if (row.status === "failed" || row.status === "refused") out.said = firstLine(row.output).slice(0, 240);
  return out;
}

/**
 * Fold the bridge's events into the few facts worth sending back.
 *
 * `reduceEvents` is reused rather than re-parsed here on purpose: it already
 * knows the two things that make a raw stream unreadable — that text arrives as
 * hundreds of deltas, and that dsh's own sandbox denial is a retry, not a
 * failure. A second implementation would drift from the console's.
 */
export function digest(
  events: HarnessEvent[],
  session: ThreadSummary | null,
  dropped = false,
): WorkDigest {
  const view = reduceEvents(emptyThread(), events);
  const turns = view.turns;
  const last = turns.length ? turns[turns.length - 1] : null;

  // Text from earlier turns is already known to the owner; only the last turn's
  // answer is news, unless the last turn has not said anything yet — then the
  // previous answer is the most recent thing the agent actually said.
  const withText = [...turns].reverse().find((t) => t.text.trim());
  const said = trim(withText?.text ?? "", SAID_LIMIT);

  const steps: WorkStep[] = [];
  for (const turn of turns) for (const row of turn.tools) steps.push(stepOf(row));
  const recent = steps.slice(-STEP_LIMIT);

  const gate = view.liveGate
    ? {
        gateId: view.liveGate.gateId,
        name: view.liveGate.name,
        title: view.liveGate.title,
        why: view.liveGate.why,
        risk: view.liveGate.risk,
      }
    : null;

  // The newest failure only. An old failure that was recovered from is history,
  // and repeating it under a healthy thread reads as a thread that is broken.
  const failed = [...turns].reverse().find((t) => t.error);
  const failedStep = [...recent].reverse().find((s) => s.status === "failed");

  return {
    status: session?.status ?? (events.length ? "thinking" : "missing"),
    busy: Boolean(session?.busy),
    cursor: session?.cursor ?? (events.length ? events[events.length - 1].seq : 0),
    usd: Math.round((session?.usd ?? view.usd) * 10000) / 10000,
    said,
    steps: recent,
    gate,
    error: failed?.error ?? failedStep?.said ?? "",
    notes: view.notes.slice(-4),
    dropped,
  };
}

/** Is this reply worth stopping the wait for? */
function settled(events: HarnessEvent[], session: ThreadSummary | null): boolean {
  if (!session) return true;
  if (session.gate) return true;
  // Our own instruction comes back as a `user` event, and the worktree notes
  // arrive as `note`; neither is the agent doing anything. Waiting only for
  // those made the first check return "still starting" one second after start.
  if (events.some((e) => e.kind !== "user" && e.kind !== "note")) return true;
  return session.status === "ended" || session.status === "waiting" || session.status === "idle";
}

// ---------------------------------------------------------------------------
// Starting a thread
// ---------------------------------------------------------------------------

export function pickHarness(requested: unknown): HarnessId {
  return requested === "claude" || requested === "deepseek" ? requested : "deepseek";
}

export function threadTitle(task: string): string {
  const first = firstLine(task).replace(/^[-*#\s]+/, "");
  return (first || "Chat build").slice(0, 64);
}

export interface StartedThread {
  threadId: string;
  harness: HarnessId;
  branch: string;
  worktree: string;
  base: string;
  notes: string[];
}

interface StartReply {
  session: ThreadSummary & { worktree?: { path?: string; branch?: string; base?: string; notes?: string[] } };
}

/**
 * Start one. No worktree of a brand-new app unless `project` is given: a chat
 * request to change an existing app belongs in that app's repository, and the
 * bridge cuts a worktree from it.
 */
export async function startWork(
  bridge: WorkBridge,
  args: Record<string, unknown>,
  deps: WorkDeps = {},
): Promise<StartedThread & { note: string }> {
  const task = String(args.task ?? args.brief ?? args.idea ?? "").trim();
  if (task.length < 12) {
    throw new Error("Say what the agent should do, in a sentence or more — a two-word brief produces a two-word guess.");
  }

  const harness = pickHarness(args.harness);
  const project = str(args.project).trim();
  const repo = project ? "" : str(args.repo).trim() || bridge.folder || "";
  if (!project && !repo) {
    throw new Error("This browser doesn't know where the repo is yet — open Jarvis once with the PC helper running, or pass the repo's folder.");
  }

  const trust: Trust =
    args.trust === "ask" || args.trust === "auto" || args.trust === "full"
      ? args.trust
      : deps.trust ?? "trusted";
  const { session } = await bridge.call<StartReply>("harness/start", {
    harness,
    title: str(args.title) || threadTitle(task),
    ...(project ? { project } : { repo }),
    // The thread works in its own worktree, so writes there are the job, not a
    // surprise. Anything outside it, and anything grave, still stops and asks.
    laneWrites: true,
    trust,
    ...(str(args.model) ? { model: str(args.model) } : {}),
  });

  const id = session.id;
  await bridge.call("harness/say", { id, text: task });

  const worktree = session.worktree ?? {};
  return {
    threadId: id,
    harness,
    branch: worktree.branch ?? "",
    worktree: worktree.path ?? "",
    base: worktree.base ?? "",
    notes: worktree.notes ?? [],
    note:
      `The ${WORK_HARNESSES.find((h) => h.id === harness)?.label ?? harness} is working on it now, in its own git worktree` +
      `${worktree.branch ? ` on ${worktree.branch}` : ""}. It keeps running after this reply. ` +
      "Call work_check with this threadId to read its progress; it will wait a few seconds for something to happen.",
  };
}

// ---------------------------------------------------------------------------
// Watching one
// ---------------------------------------------------------------------------

interface EventsReply {
  events: HarnessEvent[];
  cursor: number;
  dropped: boolean;
  session: ThreadSummary;
}

// dsh takes ten to fifteen seconds to compose its profile and come up before it
// can say anything, so the first check has to be willing to wait that long. A
// shorter default made the chat call this three times before the agent had
// drawn breath, which reads as a stuck thread.
const DEFAULT_WAIT_MS = 15_000;
const MAX_WAIT_MS = 30_000;

/**
 * Read a thread, waiting briefly for it to say something.
 *
 * The wait exists because a harness needs a second or two to start. Returning
 * "nothing yet" immediately makes the model call this five times in a row and
 * burn the run; waiting nine seconds almost always returns its first real step.
 */
export async function checkWork(
  bridge: WorkBridge,
  args: Record<string, unknown>,
  deps: WorkDeps = {},
): Promise<WorkDigest & { next: string }> {
  const id = str(args.threadId ?? args.id).trim();
  if (!id) throw new Error("Which thread? Pass the threadId that work_start returned.");

  const asked = typeof args.waitMs === "number" ? args.waitMs : Number(args.waitMs);
  const wanted = Number.isFinite(asked) ? asked : (deps.waitMs ?? DEFAULT_WAIT_MS);
  const waitMs = Math.min(MAX_WAIT_MS, Math.max(0, wanted));
  const wait = deps.wait ?? sleep;
  const deadline = Date.now() + waitMs;
  let since = Math.max(0, num(args.since));
  let seen: HarnessEvent[] = [];
  let session: ThreadSummary | null = null;
  let dropped = false;

  for (;;) {
    const data = await bridge.call<EventsReply>("harness/events", { id, since });
    session = data.session;
    dropped = dropped || Boolean(data.dropped);
    seen = seen.concat(data.events);
    since = data.cursor;
    if (settled(seen, session) || Date.now() >= deadline) break;
    await wait(900);
  }

  const d = digest(seen, session, dropped);

  // What the model should do next, in one line. This is the difference between
  // a tool result the model reads and a tool result the model acts on.
  let next: string;
  if (d.gate) {
    next =
      `It is BLOCKED on a permission gate: "${d.gate.title || d.gate.name}". Tell the owner what it wants to do and why, ` +
      "then call work_decide with this gateId once they answer.";
  } else if (d.status === "ended") {
    next = "The thread has ended. Read the work with work_finish action=diff, or land it.";
  } else if (d.busy || d.status === "thinking" || d.status === "starting") {
    next = "Still working. Call work_check again with the same threadId and the cursor above to read the next stretch.";
  } else if (d.status === "waiting") {
    next = "It is waiting on something. Read `said` and the steps, then either answer it with work_say or report it.";
  } else {
    next = "It looks idle. Read `said`; if it finished, land it or report what is left.";
  }

  return { ...d, next };
}

// ---------------------------------------------------------------------------
// The tool switchboard
// ---------------------------------------------------------------------------

interface ThreadReply {
  session: ThreadSummary;
}

/**
 * One `work_*` tool call.
 *
 * Kept out of NewJarvis.tsx so the page stays a page, and because these are the
 * only tools whose result is a STATE MACHINE rather than a fact — which makes
 * them the ones worth testing without a browser.
 */
export async function runWorkTool(
  name: string,
  args: Record<string, unknown>,
  bridge: WorkBridge,
  deps: WorkDeps = {},
): Promise<Record<string, unknown>> {
  switch (name) {
    case "work_start":
      return { ...(await startWork(bridge, args, deps)) };

    case "work_check":
      return { ...(await checkWork(bridge, args, deps)) };

    case "work_say": {
      const id = str(args.threadId ?? args.id).trim();
      const text = str(args.text ?? args.message).trim();
      if (!id) throw new Error("Which thread? Pass the threadId.");
      if (!text) throw new Error("Say something to it first.");
      await bridge.call("harness/say", { id, text });
      return { sent: true, threadId: id, note: "Delivered. It will answer in the thread; call work_check to read it." };
    }

    case "work_decide": {
      const id = str(args.threadId ?? args.id).trim();
      const gateId = str(args.gateId).trim();
      if (!id || !gateId) throw new Error("A gate answer needs both the threadId and the gateId from work_check.");
      const allow = args.allow !== false;
      const always = Boolean(args.always) && allow;
      const out = await bridge.call<{ stale?: boolean; remembered?: string | null }>("harness/decide", {
        id,
        gateId,
        allow,
        always,
      });
      return {
        answered: allow ? "yes" : "no",
        ...(out.remembered ? { rememberedFor: out.remembered } : {}),
        ...(out.stale ? { stale: true, note: "That gate was already answered or has timed out. Call work_check for the current state." } : {}),
      };
    }

    case "work_finish": {
      const id = str(args.threadId ?? args.id).trim();
      if (!id) throw new Error("Which thread? Pass the threadId.");
      const action = str(args.action) || "diff";

      if (action === "diff") {
        const out = await bridge.call<{ diff: string; truncated: boolean; work: unknown }>("harness/diff", { id });
        return {
          diff: trim(out.diff ?? "", 6_000),
          truncated: Boolean(out.truncated),
          work: out.work ?? null,
          note: "This is the change in the thread's worktree only. Nothing is on main, and nothing is pushed.",
        };
      }

      if (action === "land") {
        const out = await bridge.call<{ committed: boolean; merged: boolean; sha: string; why: string; session: ThreadSummary }>(
          "harness/land",
          { id, message: str(args.message), merge: args.merge !== false },
        );
        return {
          committed: out.committed,
          merged: out.merged,
          sha: out.sha,
          why: out.why,
          note: out.merged
            ? `Committed and merged${out.sha ? ` as ${out.sha}` : ""} into the base checkout. It is NOT pushed — use github to push it or open a pull request.`
            : `Committed${out.sha ? ` as ${out.sha}` : ""} but not merged: ${out.why || "the base checkout is not clean enough to merge into."}`,
        };
      }

      if (action === "stop" || action === "discard") {
        const out = await bridge.call<ThreadReply>(action === "stop" ? "harness/stop" : "harness/discard", { id });
        return {
          [action === "stop" ? "stopped" : "discarded"]: true,
          status: out.session?.status ?? "ended",
          note:
            action === "stop"
              ? "The agent is stopped. Its worktree and branch are still there, so the work is not lost."
              : "The agent is stopped and its worktree is gone. Its branch was deleted too.",
        };
      }

      throw new Error(`work_finish action must be diff, land, stop or discard — not "${action}".`);
    }

    case "work_list": {
      const out = await bridge.call<{ threads: ThreadSummary[] }>("harness/threads");
      return {
        threads: (out.threads ?? []).slice(0, 12).map((t) => ({
          threadId: t.id,
          title: t.title,
          harness: t.harness,
          status: t.status,
          busy: t.busy,
          branch: t.worktree?.branch ?? "",
          usd: Math.round(t.usd * 10000) / 10000,
        })),
      };
    }

    default:
      throw new Error(`There is no work tool called "${name}".`);
  }
}
