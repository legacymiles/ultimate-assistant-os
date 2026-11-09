// ---------------------------------------------------------------------------
// Image lanes — which one draws the picture, and why.
//
// Every image the hub made used to go straight to a paid model. The owner has
// WanGP on their PC with Flux 2 Klein 4B already on disk, so the first lane is
// now their own graphics card: free, private, unlimited, and no key.
//
// The order mirrors `ai/provider.ts`'s shape, because the same three questions
// apply to a picture as to a sentence — can we do it here, can we do it free,
// do we have to pay:
//
//   local  — WanGP on the owner's PC. Free. Needs the PC on and the service up.
//   free   — a keyless public endpoint. Free. Watermarked, so never for
//            anything that carries the owner's or a client's name.
//   paid   — the model in image-studio/agents.ts. Costs money. Last.
//
// This file is PURE: it decides, it never fetches. That keeps the decision
// testable and keeps "why did this cost money" answerable in one place.
// ---------------------------------------------------------------------------

/** Where a picture can come from. */
export type LaneId = "local" | "free" | "paid";

/** What the picture is for. It decides whether a watermark is acceptable. */
export type Purpose =
  /** Placeholder art nobody but the owner sees — mockups, drafts, tests. */
  | "placeholder"
  /** Carries the owner's or a client's name — heroes, tiles, OG cards, client sites. */
  | "branded";

export interface LaneState {
  /** The PC's image service answered. */
  localUp: boolean;
  /** A keyless public endpoint is allowed on this deploy. */
  freeAllowed: boolean;
  /** There is a key for the paid model. */
  paidKeyed: boolean;
}

export interface LanePlan {
  /** The lanes to try, in order. Empty means nothing can draw this. */
  order: LaneId[];
  /** Why, in words the owner can read in the UI. */
  why: string;
  /** What to tell them when every lane is out (checklist R3/R4). */
  blocked?: string;
}

export const LANE_LABEL: Record<LaneId, string> = {
  local: "Your PC (free)",
  free: "Free online (watermarked)",
  paid: "Paid model",
};

/**
 * Is this lane allowed to draw this kind of picture at all?
 *
 * The free lane stamps a logo on everything it returns. On a placeholder that
 * is honest — it reads as "stand-in". On an app hero or a client's site it is
 * someone else's brand on the owner's work, so it is simply not offered.
 */
export function laneAllowed(lane: LaneId, purpose: Purpose): boolean {
  if (lane === "free") return purpose === "placeholder";
  return true;
}

/**
 * The order to try, for this purpose, in this state.
 *
 * Local always leads when it is up: it is free, unwatermarked and private, so
 * there is no case where paying first is right.
 */
export function planLanes(purpose: Purpose, state: LaneState): LanePlan {
  const order: LaneId[] = [];
  if (state.localUp) order.push("local");
  if (state.freeAllowed && laneAllowed("free", purpose)) order.push("free");
  if (state.paidKeyed) order.push("paid");

  if (!order.length) {
    return {
      order,
      why: "Nothing can draw this right now.",
      blocked: blockedBecause(purpose, state),
    };
  }

  return { order, why: whyFirst(order[0], purpose, state) };
}

function whyFirst(first: LaneId, purpose: Purpose, state: LaneState): string {
  if (first === "local") return "Your PC is on, so this is drawn on your own graphics card for nothing.";
  if (first === "free") return "Your PC isn't reachable, so this uses a free online drawer. It adds a small watermark.";
  return purpose === "branded" && state.freeAllowed
    ? "This one carries your name, so the watermarked free drawer is skipped and the paid model is used."
    : "Your PC isn't reachable and there's no free lane, so this uses the paid model.";
}

/** The single sentence shown when no lane can run. Always says what would fix it. */
function blockedBecause(purpose: Purpose, state: LaneState): string {
  if (purpose === "branded" && state.freeAllowed && !state.localUp && !state.paidKeyed) {
    return (
      "This picture carries your name, so the watermarked free drawer can't be used. " +
      "Open Jarvis on your PC to draw it there for nothing, or add an image key."
    );
  }
  if (!state.localUp && !state.paidKeyed) {
    return "Open Jarvis on your PC to draw pictures there for nothing, or add an image key.";
  }
  return "No picture drawer is switched on. Open Jarvis on your PC, or add an image key.";
}

/**
 * What the owner is told after the fact: which lane drew it, and what it cost.
 * "Free" is worth saying out loud — it is the whole point of the local lane.
 */
export function laneNote(lane: LaneId, ms: number): string {
  const secs = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  if (lane === "local") return `Drawn on your PC in ${secs} — free.`;
  if (lane === "free") return `Drawn by the free online drawer in ${secs} — free, with its watermark.`;
  return `Drawn by the paid model in ${secs}.`;
}
