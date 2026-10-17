// ---------------------------------------------------------------------------
// What a block is.
//
// The whole surface is a stack of these. A block is one request and everything
// that came of it — the words as they were said, every step taken, what each
// step returned, and the answer. It is deliberately a RECORD rather than a
// message: a chat turn can be summarised into "Done", a block cannot, because
// its steps are the thing the owner is looking at.
// ---------------------------------------------------------------------------

/** Where the request came from. Voice and typing produce identical blocks. */
export type BlockSource = "typed" | "voice" | "routine";

/**
 * What the command line was set to.
 *
 * Not a different agent — the same loop with a different opening instruction
 * and a different tool budget. Ask never touches the machine at all, which is
 * what makes it safe to leave as the default.
 */
export type Mode = "ask" | "do" | "browse" | "run";

export const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "ask", label: "Ask", hint: "Answer from what it knows. Can remember; cannot touch your PC." },
  { id: "do", label: "Do", hint: "Work the job end to end, using whatever it needs." },
  { id: "browse", label: "Browse", hint: "Drive the browser: open, read, click, fill." },
  { id: "run", label: "Run", hint: "Run it on this PC and show the output." },
];

export type StepStatus = "running" | "ok" | "failed" | "refused" | "waiting";

export interface Step {
  id: string;
  /** 1-based, and shown. A run reads as a numbered ledger. */
  n: number;
  /** The tool name the model called, e.g. browser_click. */
  tool: string;
  /** The bridge route it maps to. Empty for steps that never left the page. */
  route: string;
  args: Record<string, unknown>;
  /** One sentence, from actions.classify — the same one the gate showed. */
  summary: string;
  status: StepStatus;
  ms?: number;
  /** What came back. Rendered by kind, not dumped as JSON. */
  result?: unknown;
  error?: string;
}

export type BlockStatus = "running" | "waiting" | "done" | "failed" | "stopped";

export interface Gate {
  stepId: string;
  summary: string;
  why: string;
  risk: "read" | "act" | "grave";
}

export interface Block {
  id: string;
  source: BlockSource;
  mode: Mode;
  /** Exactly what was typed or heard. Never cleaned up. */
  command: string;
  createdAt: number;
  status: BlockStatus;
  steps: Step[];
  /** The assistant's answer, once there is one. */
  answer: string;
  error?: string;
  ms?: number;
  collapsed: boolean;
  /** Set while a step is waiting on the owner's yes. */
  gate: Gate | null;
  /** What was attached, as small previews. The media itself is not kept. */
  media?: { kind: "image" | "video" | "audio"; name: string; thumb: string }[];
  /** The OpenRouter model picked for this block, when not the default. */
  model?: string;
  /** Which conversation it belongs to (Chat's side panel). */
  thread?: string;
}

export function newBlock(init: Partial<Block> & { command: string; mode: Mode }): Block {
  return {
    id: `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    source: "typed",
    createdAt: Date.now(),
    status: "running",
    steps: [],
    answer: "",
    collapsed: false,
    gate: null,
    ...init,
  };
}

/**
 * How many blocks stay on screen.
 *
 * The stack is the composition's whole argument and also its whole risk: a
 * day's work left mounted is a page that gets slower every hour. Older blocks
 * are dropped from the DOM rather than merely collapsed, because a collapsed
 * block still holds its browser frames and its tables.
 */
export const MAX_LIVE_BLOCKS = 150;

/** A block's own elapsed time, live while it runs. */
export function elapsed(block: Block, now = Date.now()): number {
  return block.ms ?? now - block.createdAt;
}
