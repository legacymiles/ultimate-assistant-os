// ---------------------------------------------------------------------------
// A build brief written by the owner's OWN Claude plan.
//
// Every other pick in the menu is a cloud model, and the server in brief.ts can
// reach it. The Claude plan cannot be reached from there: it is Claude Code
// running on the owner's PC, behind the local bridge at 127.0.0.1:42020. So
// this path runs in the browser — the same tab that can already pair with the
// bridge — and posts the finished brief back through saveBrief.
//
// A versioned model name is tried first, then the family alias: Claude Code's
// list of ids moves faster than a menu can, and "opus" always means "the Opus
// your plan has". Whichever answers is what the badge shows, so the screen
// never claims a model that did not write the words.
// ---------------------------------------------------------------------------

import { call, probe, BridgeError } from "@/lib/new-jarvis/bridge";
import { briefPrompt, BRIEF_SYSTEM } from "./briefPrompt";
import { SUBSCRIPTION_PREFIX } from "./models";
import type { ClientProject, RequestBatch } from "./types";

/** The alias to fall back to when the plan has never heard of the versioned id. */
const FAMILY_ALIAS: Record<string, string> = {
  "claude-opus-5-5": "opus",
  "claude-opus-5": "opus",
  "claude-sonnet-5-5": "sonnet",
  "claude-sonnet-5": "sonnet",
};

export interface PlanBrief {
  brief: string;
  /** What the bridge says actually answered ("claude-subscription:claude-…"). */
  model: string;
  /** Set when the versioned id was not available and the alias answered instead. */
  note?: string;
}

/** "No such model" — the one failure worth retrying with the alias. */
function isUnknownModel(message: string): boolean {
  return /model/i.test(message) && /(not found|unknown|invalid|does not exist|unsupported|no such)/i.test(message);
}

export async function writeBriefOnPlan(p: ClientProject, batch: RequestBatch, value: string): Promise<PlanBrief> {
  const asked = value.slice(SUBSCRIPTION_PREFIX.length);

  const health = await probe();
  if (!health.up) {
    throw new Error(
      "Jarvis's PC helper isn't running, so your Claude plan can't be reached. Start it on this PC — or pick an OpenRouter model in the model menu.",
    );
  }

  const messages = [{ role: "user", content: briefPrompt(p, batch) }];
  const ask = async (model: string) =>
    call<{ text?: string; model?: string }>("brain/claude", {
      system: BRIEF_SYSTEM,
      messages,
      ...(model ? { model } : {}),
    });

  let out: { text?: string; model?: string };
  let note: string | undefined;
  try {
    out = await ask(asked);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const alias = FAMILY_ALIAS[asked];
    if (!alias || !isUnknownModel(message)) {
      throw err instanceof BridgeError ? new Error(message) : err;
    }
    // The plan doesn't offer that exact id. Let it answer with the family's
    // current model rather than failing the button over a version number.
    out = await ask(alias);
    note = `Your Claude plan didn't offer “${asked}”, so Claude used its default ${alias}.`;
  }

  const brief = String(out.text ?? "").trim();
  if (!brief) throw new Error("Claude answered with nothing. Try again, or pick another model.");
  const reported = out.model || value;
  return {
    brief,
    // The bridge reports "claude-subscription:claude-opus-5-5-20260…", which is
    // true but unreadable as a badge. Keep the fact, drop the id prefix.
    model: reported.startsWith(SUBSCRIPTION_PREFIX)
      ? `Claude plan · ${reported.slice(SUBSCRIPTION_PREFIX.length)}`
      : reported,
    note,
  };
}
