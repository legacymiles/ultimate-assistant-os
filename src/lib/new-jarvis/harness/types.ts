// ---------------------------------------------------------------------------
// What a harness thread looks like to the page.
//
// The bridge sends a flat, append-only stream of events, because that is the
// only shape that survives a sleeping laptop and a reader on a second device.
// The page needs the opposite: turns, each with its ledger, its answer and its
// one live gate. `model.ts` is the fold between them, and these are its ends.
// ---------------------------------------------------------------------------

export type HarnessId = "claude" | "deepseek";

/** What the bridge says it can run, and why not when it cannot. */
export interface HarnessChoice {
  id: HarnessId;
  label: string;
  blurb: string;
  available: boolean;
  why: string;
}

/** Every event kind the bridge emits. Unknown kinds are ignored, never thrown. */
export type EventKind =
  | "status" | "user" | "text" | "thinking" | "tool" | "tool_end"
  | "allowed" | "gate" | "gate_done" | "turn_end" | "usage" | "plan" | "note" | "error";

export interface HarnessEvent {
  seq: number;
  at: number;
  kind: EventKind | string;
  [key: string]: unknown;
}

export type ToolKind = "read" | "write" | "run" | "other";
export type ToolStatus = "running" | "ok" | "failed" | "refused" | "escalating";

export interface ToolRow {
  callId: string;
  name: string;
  title: string;
  kindOf: ToolKind;
  path: string;
  command: string;
  status: ToolStatus;
  output: string;
  at: number;
}

export type Risk = "read" | "act" | "grave";

export interface GateCard {
  gateId: string;
  name: string;
  title: string;
  why: string;
  risk: Risk;
  /** A patch built from the tool's own arguments. The thing actually approved. */
  patch: string;
  command: string;
  path: string;
  askedAt: number;
  /** Set once answered, so the card stays in the ledger as a record. */
  answered?: boolean;
  allowed?: boolean;
  /** "owner", "timeout", "stopped", "discarded". */
  how?: string;
}

export type TurnStatus = "running" | "waiting" | "done" | "failed";

export interface Turn {
  id: string;
  at: number;
  /** Exactly what was sent. Empty only for the opening notes. */
  prompt: string;
  text: string;
  thinking: string;
  tools: ToolRow[];
  gates: GateCard[];
  plan: { text: string; status: string }[];
  notes: string[];
  status: TurnStatus;
  ms: number;
  usd: number;
  error: string;
}

export interface ThreadView {
  turns: Turn[];
  /** Notes that arrived before the first turn — the worktree, the warnings. */
  notes: string[];
  /** The one gate currently blocking the harness, if any. */
  liveGate: GateCard | null;
  usd: number;
  /** dsh reports its context window; Claude does not. */
  used: number;
  size: number;
  /** The last status line the bridge sent, verbatim. */
  detail: string;
}

export const EMPTY_THREAD: ThreadView = {
  turns: [],
  notes: [],
  liveGate: null,
  usd: 0,
  used: 0,
  size: 0,
  detail: "",
};

/** The thread summary the bridge returns beside every poll. */
export interface ThreadSummary {
  id: string;
  harness: HarnessId;
  label: string;
  title: string;
  createdAt: number;
  status: "starting" | "ready" | "thinking" | "waiting" | "idle" | "ended";
  detail: string;
  model: string;
  usd: number;
  busy: boolean;
  strict: boolean;
  /**
   * Writes inside this thread's own worktree are allowed without asking. Set by
   * a bake-off lane and nothing else; see `autoAllow` in harness-gate.mjs for
   * what it still stops.
   */
  laneWrites: boolean;
  /** The dev server serving this worktree, once one has been started. */
  preview: { port: number; url: string; pid: number } | null;
  cursor: number;
  gate: GateCard | null;
  worktree: { path: string; branch: string; base: string; repo: string; notes: string[] };
  landed: { committed: boolean; merged: boolean; sha: string; why: string; at: number } | null;
}

/** One row of `git status` in the thread's worktree. */
export interface WorkFile {
  state: string;
  file: string;
}

export interface WorkSummary {
  exists: boolean;
  files: WorkFile[];
  added: number;
  removed: number;
  dirty: boolean;
}
