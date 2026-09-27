// ---------------------------------------------------------------------------
// Keeping the ledger.
//
// The whole argument of this surface is that work accumulates — that a block
// from an hour ago is still there and still re-runnable. Held in React state
// alone that was a claim the build did not honour: a reload, or a walk to
// another hub app and back, deleted the lot.
//
// What is kept is deliberately not what is shown. A screenshot is a couple of
// hundred kilobytes of base64 and a page read is twenty thousand characters;
// a day of those would blow the storage quota and take the ledger with it. So
// results are slimmed on the way out, and the block says plainly that the big
// part is gone rather than pretending it still has it.
// ---------------------------------------------------------------------------

import type { Block, Step } from "./types";
import { MAX_LIVE_BLOCKS } from "./types";

export const BLOCKS_KEY = "new-jarvis:blocks";

/** Per stored step. Enough to read the ledger back, never enough to fill it. */
const KEPT_CHARS = 2_000;
/** Blocks kept across a reload. Fewer than live, because these are cold. */
export const STORED_BLOCKS = 25;

function slimResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
    if (k === "png") {
      // Named, not dropped silently: the step should read "the picture is no
      // longer here", not as a step that never took one.
      out.pngDropped = true;
      continue;
    }
    if (typeof v === "string" && v.length > KEPT_CHARS) {
      out[k] = `${v.slice(0, KEPT_CHARS)}\n\n… the rest was not kept when this was saved.`;
      continue;
    }
    out[k] = v;
  }
  return out;
}

function slimStep(step: Step): Step {
  return { ...step, result: slimResult(step.result) };
}

/**
 * The blocks as they go to storage.
 *
 * A block still running when the page went away is stored as stopped. It is
 * not running any more — nothing is driving it — and reviving it as "running"
 * would put a permanent ticking timer and a Stop button on a job that ended
 * when the tab did.
 */
export function slim(blocks: Block[]): Block[] {
  return blocks.slice(0, STORED_BLOCKS).map((b) => {
    const interrupted = b.status === "running" || b.status === "waiting";
    return {
      ...b,
      status: interrupted ? ("stopped" as const) : b.status,
      error: interrupted ? b.error || "This run was interrupted when the page closed." : b.error,
      gate: null,
      ms: b.ms ?? (interrupted ? Date.now() - b.createdAt : b.ms),
      steps: b.steps.map(slimStep),
    };
  });
}

/** Anything unrecognised is discarded rather than rendered as a broken block. */
export function revive(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  const out: Block[] = [];
  for (const b of raw) {
    if (!b || typeof b !== "object") continue;
    const o = b as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.command !== "string") continue;
    const steps = Array.isArray(o.steps)
      ? (o.steps as Record<string, unknown>[])
          .filter((s) => s && typeof s.id === "string")
          .map((s, i) => ({
            id: String(s.id),
            n: typeof s.n === "number" ? s.n : i + 1,
            tool: String(s.tool ?? ""),
            route: String(s.route ?? ""),
            args: (s.args && typeof s.args === "object" ? s.args : {}) as Record<string, unknown>,
            summary: String(s.summary ?? ""),
            status: (["running", "ok", "failed", "refused", "waiting"].includes(String(s.status))
              ? s.status
              : "ok") as Step["status"],
            ms: typeof s.ms === "number" ? s.ms : undefined,
            result: s.result,
            error: typeof s.error === "string" ? s.error : undefined,
          }))
      : [];
    out.push({
      id: o.id,
      source: (["typed", "voice", "routine"].includes(String(o.source)) ? o.source : "typed") as Block["source"],
      mode: (["ask", "do", "browse", "run"].includes(String(o.mode)) ? o.mode : "do") as Block["mode"],
      command: o.command,
      createdAt: typeof o.createdAt === "number" ? o.createdAt : Date.now(),
      // A stored block is never live. See slim().
      status: (["done", "failed", "stopped"].includes(String(o.status)) ? o.status : "stopped") as Block["status"],
      steps,
      answer: typeof o.answer === "string" ? o.answer : "",
      error: typeof o.error === "string" ? o.error : undefined,
      ms: typeof o.ms === "number" ? o.ms : undefined,
      // Old work comes back folded. It is history, not what you are doing now.
      collapsed: true,
      gate: null,
    });
    if (out.length >= MAX_LIVE_BLOCKS) break;
  }
  return out;
}
