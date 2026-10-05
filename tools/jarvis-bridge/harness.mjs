// ---------------------------------------------------------------------------
// Harness threads: the long-lived half the HTTP routes are a view of.
//
// Everything else this bridge does is one bounded request — run this command,
// read this file, click this element — and answers in under two minutes. A
// coding harness is the opposite shape. It works for ten minutes, it talks
// while it works, it stops in the middle to ask permission, and the page
// driving it is a tab that may be closed and reopened on a different device
// before it finishes. So a thread lives HERE, in this process, and the routes
// only start one, feed it, read its ledger and answer its gates.
//
// Two decisions are worth stating because the obvious alternatives both fail:
//
//   Events are POLLED from a ring, not streamed. A long-lived SSE response
//   through the existing CORS-and-token door would need its own auth path (the
//   browser cannot set an Authorization header on EventSource), and it dies
//   silently whenever a laptop sleeps — which is the normal state of this
//   machine. A ring with a monotonic cursor survives a sleep, a reload, and a
//   second tab reading the same thread, and says so when a reader has fallen
//   too far behind to be caught up honestly.
//
//   A gate is a PARKED PROMISE, not a question in the transcript. The
//   adapter's permission hook is blocked on it, so nothing has happened yet
//   when the card appears on the page, and nothing happens if the card is
//   never answered. That is the only arrangement in which "I approved it" and
//   "it happened" cannot come apart.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { startClaude, CLAUDE_LABEL } from "./harness-claude.mjs";
import { startAcp, DEEPSEEK_LABEL, DSH_CWD } from "./harness-acp.mjs";
import {
  createWorktree, landWorktree, removeWorktree, worktreeDiff, worktreeStatus,
  DEFAULT_REPO, WORKTREE_ROOT,
} from "./worktree.mjs";
import { startPreview, stopPreview, publicView } from "./harness-preview.mjs";

/**
 * How much of a thread is kept.
 *
 * A thread that runs all afternoon produces tens of thousands of text deltas.
 * The ring holds the recent ones for the page to draw; the page keeps what it
 * has already read, so trimming here loses nothing a reader has seen.
 */
const RING = 6_000;

/** Threads, by id. Lost on a bridge restart, which is the honest lifetime. */
const sessions = new Map();

const HARNESSES = {
  claude: {
    id: "claude",
    label: CLAUDE_LABEL,
    blurb: "Anthropic's own harness, through the Agent SDK. Every edit and command is asked about here.",
  },
  deepseek: {
    id: "deepseek",
    label: DEEPSEEK_LABEL,
    blurb: "DeepSeek's harness over Agent Client Protocol, pinned to a read-only sandbox so every write escalates to you.",
  },
};

/** Which harnesses this PC can actually run, and why not when it cannot. */
export async function listHarnesses() {
  const out = [];

  let claudeWhy = "";
  try {
    await import("@anthropic-ai/claude-agent-sdk");
  } catch {
    claudeWhy = "The Claude Agent SDK is not installed — run `npm install` in tools/jarvis-bridge.";
  }
  out.push({ ...HARNESSES.claude, available: !claudeWhy, why: claudeWhy });

  const dshWhy = existsSync(DSH_CWD)
    ? ""
    : `dsh is not installed at ${DSH_CWD}. Install @deepseek-ai/dsh there, or set DSH_DIR.`;
  out.push({ ...HARNESSES.deepseek, available: !dshWhy, why: dshWhy });

  return { harnesses: out, worktreeRoot: WORKTREE_ROOT, defaultRepo: DEFAULT_REPO };
}

// ---------------------------------------------------------------------------
// One thread
// ---------------------------------------------------------------------------

function summary(s) {
  return {
    id: s.id,
    harness: s.harness,
    label: s.label,
    title: s.title,
    createdAt: s.createdAt,
    status: s.status,
    detail: s.detail,
    model: s.model,
    usd: s.usd,
    busy: Boolean(s.adapter?.busy),
    worktree: s.worktree,
    strict: s.strict,
    laneWrites: s.laneWrites,
    preview: publicView(s.preview),
    cursor: s.seq,
    gate: s.pendingGate,
    landed: s.landed,
  };
}

function mustGet(id) {
  const s = sessions.get(String(id ?? ""));
  if (!s) throw Object.assign(new Error("No such harness thread. It may have ended with the bridge."), { status: 404 });
  return s;
}

export async function startThread({ harness = "claude", title = "", repo, strict = false, laneWrites = false, model = "" } = {}) {
  const which = HARNESSES[harness];
  if (!which) throw Object.assign(new Error(`There is no "${harness}" harness.`), { status: 400 });

  const { harnesses } = await listHarnesses();
  const found = harnesses.find((h) => h.id === harness);
  if (!found?.available) throw Object.assign(new Error(found?.why ?? "That harness is not available."), { status: 400 });

  const id = randomUUID();
  const worktree = await createWorktree({ id, repo, title: title || harness });

  const s = {
    id,
    harness,
    label: which.label,
    title: title || "Untitled thread",
    createdAt: Date.now(),
    status: "starting",
    detail: "",
    model: "",
    sessionId: "",
    usd: 0,
    strict: Boolean(strict),
    laneWrites: Boolean(laneWrites),
    worktree,
    preview: null,
    events: [],
    seq: 0,
    gates: new Map(),
    pendingGate: null,
    landed: null,
    adapter: null,
  };
  sessions.set(id, s);

  const emit = (event) => {
    s.seq += 1;
    const row = { seq: s.seq, at: Date.now(), ...event };
    s.events.push(row);
    if (s.events.length > RING) s.events.splice(0, s.events.length - RING);

    if (event.kind === "status") {
      s.status = event.status ?? s.status;
      if (event.detail) s.detail = event.detail;
      if (event.model) s.model = event.model;
      if (event.sessionId) s.sessionId = event.sessionId;
    }
    if (event.kind === "turn_end" && typeof event.usd === "number") s.usd += event.usd;
    return row;
  };

  /**
   * Park until the owner answers.
   *
   * The timeout exists because the alternative is a harness child holding a
   * tool call open for the life of the process when a tab is closed on a gate.
   * Twenty minutes is long enough to walk away from the desk and come back,
   * and a timeout refuses rather than approves.
   */
  const gate = (ask) =>
    new Promise((resolve) => {
      const gateId = `g_${s.seq + 1}_${Math.random().toString(36).slice(2, 7)}`;
      const card = {
        gateId,
        name: ask.name,
        title: ask.title,
        why: ask.why,
        risk: ask.risk,
        patch: ask.patch || "",
        command: ask.command || "",
        path: ask.path || "",
        askedAt: Date.now(),
      };
      const timer = setTimeout(() => finish(false, "timeout"), 20 * 60_000);
      const finish = (allow, how) => {
        if (!s.gates.has(gateId)) return;
        clearTimeout(timer);
        s.gates.delete(gateId);
        if (s.pendingGate?.gateId === gateId) s.pendingGate = null;
        emit({ kind: "gate_done", gateId, allow, how: how ?? "owner" });
        // Asking set the status to "waiting"; answering has to take it back.
        // Nothing else does: the adapter is blocked INSIDE the permission hook,
        // so resolving this promise returns it to work without emitting a
        // status of its own, and the thread then reads "waiting" while it is
        // demonstrably writing files. Watched a lane report "needs you" for
        // four minutes while it wrote two components.
        //
        // Only when no OTHER gate is parked: with several tools in flight,
        // answering one does not unblock the thread.
        if (!s.gates.size && s.status !== "ended") {
          emit({ kind: "status", status: "thinking" });
        }
        resolve(allow);
      };
      s.gates.set(gateId, finish);
      s.pendingGate = card;
      emit({ kind: "gate", ...card });
      emit({ kind: "status", status: "waiting" });
    });

  const common = { cwd: worktree.path, emit, gate, strict: Boolean(strict), laneWrites: Boolean(laneWrites) };
  s.adapter = harness === "claude" ? startClaude({ ...common, model }) : startAcp(common);

  if (worktree.notes.length) {
    for (const note of worktree.notes) emit({ kind: "note", text: note });
  }
  emit({
    kind: "note",
    text: `Working in ${worktree.path} on ${worktree.branch}, cut from ${worktree.base}. Your ${worktree.base} checkout is untouched.`,
  });

  return { session: summary(s) };
}

export function sayToThread({ id, text }) {
  const s = mustGet(id);
  const t = String(text ?? "").trim();
  if (!t) throw Object.assign(new Error("Nothing to send."), { status: 400 });
  if (s.status === "ended") throw Object.assign(new Error("That thread has ended. Start a new one."), { status: 409 });
  s.adapter.say(t);
  return { ok: true, cursor: s.seq };
}

/**
 * Everything since `since`.
 *
 * `dropped` is the important field. A reader whose cursor predates the ring
 * cannot be caught up, and quietly handing it the oldest kept events would
 * leave a hole in the middle of a transcript that nothing afterwards reveals.
 */
export function threadEvents({ id, since = 0 }) {
  const s = mustGet(id);
  const from = Number(since) || 0;
  const oldest = s.events.length ? s.events[0].seq : s.seq + 1;
  const dropped = from > 0 && from + 1 < oldest;
  return {
    events: s.events.filter((e) => e.seq > from),
    cursor: s.seq,
    dropped,
    session: summary(s),
  };
}

export function decideGate({ id, gateId, allow }) {
  const s = mustGet(id);
  const finish = s.gates.get(String(gateId ?? ""));
  if (!finish) {
    // Answering a gate twice is normal: two tabs, or a tap on a stale card.
    return { ok: true, stale: true };
  }
  finish(Boolean(allow));
  return { ok: true, stale: false };
}

export async function interruptThread({ id }) {
  const s = mustGet(id);
  await s.adapter.interrupt();
  return { ok: true };
}

export async function stopThread({ id }) {
  const s = mustGet(id);
  // Refuse every parked gate first. Killing the child under a blocked
  // permission hook leaves the model's last tool call unanswered forever.
  for (const finish of [...s.gates.values()]) finish(false, "stopped");
  await s.adapter.stop();
  // The dev server is a separate child and does not die with the harness. Left
  // running it holds a port that the next thread on it cannot have.
  if (s.preview) {
    await stopPreview(s.preview).catch(() => {});
    s.preview = null;
  }
  return { ok: true, session: summary(s) };
}

export function listThreads() {
  return { threads: [...sessions.values()].map(summary) };
}

export async function threadStatus({ id }) {
  const s = mustGet(id);
  return { session: summary(s), work: await worktreeStatus(s.worktree.path) };
}

export async function threadDiff({ id }) {
  const s = mustGet(id);
  const [patch, work] = await Promise.all([worktreeDiff(s.worktree.path), worktreeStatus(s.worktree.path)]);
  return { ...patch, work, session: summary(s) };
}

export async function landThread({ id, message = "", merge = true, attribution = "" }) {
  const s = mustGet(id);
  const result = await landWorktree({
    path: s.worktree.path,
    repo: s.worktree.repo,
    base: s.worktree.base,
    branch: s.worktree.branch,
    message: message || s.title,
    merge: Boolean(merge),
    attribution,
  });
  s.landed = { ...result, at: Date.now() };
  return { ...result, session: summary(s) };
}

export async function discardThread({ id, keepBranch = false }) {
  const s = mustGet(id);
  for (const finish of [...s.gates.values()]) finish(false, "discarded");
  await s.adapter.stop().catch(() => {});
  // Before the folder goes: a server with its cwd deleted under it is a
  // process that cannot be explained afterwards.
  if (s.preview) {
    await stopPreview(s.preview).catch(() => {});
    s.preview = null;
  }
  await removeWorktree({
    path: s.worktree.path,
    repo: s.worktree.repo,
    branch: s.worktree.branch,
    deleteBranch: !keepBranch,
  });
  sessions.delete(s.id);
  return { ok: true };
}

/**
 * Serve this thread's worktree so its work can be clicked through.
 *
 * Idempotent on purpose: a page that reloads mid-run asks again, and the honest
 * answer is the server it already has rather than a second one on a dead port.
 */
export async function previewThread({ id, port }) {
  const s = mustGet(id);
  if (s.preview) return { ...publicView(s.preview), ready: true, reused: true };
  const { handle, ...view } = await startPreview({ cwd: s.worktree.path, port });
  s.preview = handle;
  // A server whose thread is gone is a port nobody can account for, so the
  // thread lets go of it the moment the child does.
  handle.child.once("exit", () => {
    if (s.preview === handle) s.preview = null;
  });
  emit_note(s, `Serving this worktree at ${view.url}`);
  return { ...view, reused: false };
}

export async function previewStopThread({ id }) {
  const s = mustGet(id);
  if (!s.preview) return { ok: true, stopped: false };
  await stopPreview(s.preview);
  s.preview = null;
  return { ok: true, stopped: true };
}

/** A note after the fact, which `startThread`'s own `emit` closure cannot do. */
function emit_note(s, text) {
  s.seq += 1;
  s.events.push({ seq: s.seq, at: Date.now(), kind: "note", text });
  if (s.events.length > RING) s.events.splice(0, s.events.length - RING);
}

/** Called when the bridge is going down, so no child outlives it silently. */
export async function stopAllThreads() {
  await Promise.all(
    [...sessions.values()].flatMap((s) => [
      s.adapter?.stop?.().catch(() => {}),
      s.preview ? stopPreview(s.preview).catch(() => {}) : null,
    ]),
  );
}
