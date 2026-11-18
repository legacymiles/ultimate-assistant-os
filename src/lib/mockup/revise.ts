"use client";

// ---------------------------------------------------------------------------
// Change the three mockups from a note — "a deeper purple, keep the white
// cards" — the way the harness would: Claude reads the request, the three
// readings on screen, the note and the page, and rewrites all three.
//
// Claude on the owner's own plan answers first, through the PC helper's
// one-shot brain (`brain/claude`, the same Claude Code the harness runs), with
// the model picked in the Studio's model menu when that pick is a plan model.
// When the PC is off, unpaired or out of plan, the hub's own model does the
// same job with the same prompt (/api/mockup/readings with `change`). Null
// only when neither could answer — the board then paints from the words alone.
// ---------------------------------------------------------------------------

import { SUBSCRIPTION_PREFIX } from "@/lib/client-review/models";
import { readChatModel } from "@/lib/new-jarvis/useChatModel";
import { readingsFromText, REVISE_SYSTEM, reviseUser, type CustomLane } from "./edit";

export interface ReviseArgs {
  edit: string;
  change: string;
  previous: CustomLane[];
  siteName: string;
  url?: string;
  /** The page as it is now (a data URL), for the model to look at. */
  image?: string;
}

export interface Revised {
  lanes: CustomLane[];
  /** Who wrote them, for the line under the board. */
  by: string;
}

/** The plan model to ask for: the menu's pick when it is one, else the plan's default. */
function planModel(): string {
  const pick = readChatModel();
  return pick.startsWith(SUBSCRIPTION_PREFIX) ? pick.slice(SUBSCRIPTION_PREFIX.length) : "";
}

async function onPlan(a: ReviseArgs): Promise<Revised | null> {
  try {
    const { call, probe } = await import("@/lib/new-jarvis/bridge");
    const health = await probe();
    if (!health.up) return null;
    const content = [
      { type: "text", text: reviseUser(a) },
      ...(a.image ? [{ type: "image_url", image_url: { url: a.image } }] : []),
    ];
    const model = planModel();
    const out = await call<{ text?: string; model?: string }>(
      "brain/claude",
      { system: REVISE_SYSTEM, messages: [{ role: "user", content }], ...(model ? { model } : {}) },
      { signal: AbortSignal.timeout(120_000) },
    );
    const lanes = readingsFromText(out.text ?? "");
    return lanes ? { lanes, by: "Claude on your plan" } : null;
  } catch {
    return null;
  }
}

async function onHub(a: ReviseArgs): Promise<Revised | null> {
  try {
    const res = await fetch("/api/mockup/readings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        edit: a.edit,
        siteName: a.siteName,
        url: a.url || undefined,
        image: a.image || undefined,
        change: a.change,
        previous: a.previous,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = (await res.json().catch(() => ({}))) as { lanes?: CustomLane[] | null };
    return res.ok && Array.isArray(data.lanes) && data.lanes.length === 3 ? { lanes: data.lanes, by: "the hub's AI" } : null;
  } catch {
    return null;
  }
}

export async function reviseReadings(a: ReviseArgs): Promise<Revised | null> {
  return (await onPlan(a)) ?? (await onHub(a));
}
