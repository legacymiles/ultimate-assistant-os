// ---------------------------------------------------------------------------
// "Improve" — turning a client's edit requests into a build brief.
//
// The client writes the way people talk ("make the top bigger and less
// boring"). The owner needs a brief they — or a coding agent — can build from.
// This asks a model for one and falls back to a plain numbered list when no AI
// is configured, so the button never just fails.
//
// WHICH model is the owner's call, from the menu in the console
// (src/lib/client-review/models.ts):
//
//   no pick        the project's lane — Claude, then the uncensored chain when
//                  Claude refuses (the behaviour that predates the menu)
//   a cloud id     that one model, no re-route: an explicit pick outranks the
//                  lanes, including the refusal re-route
//   a plan id      the owner's own Claude subscription, which lives on their
//                  PC and is written in the browser (subscriptionBrief.ts) —
//                  the guard below says so rather than silently choosing
//                  something else
//
// The words are in briefPrompt.ts, shared with the browser path, so the brief
// is the same request whichever brain writes it.
// ---------------------------------------------------------------------------

import "server-only";

import { aiConfigured, aiFetch, describeFailure } from "@/lib/ai/provider";
import { BRIEF_SYSTEM, briefPrompt, liveRequestTexts } from "./briefPrompt";
import {
  isSubscriptionValue,
  laneForModel,
  SUBSCRIPTION_PREFIX,
} from "./models";
import { plainBrief } from "./logic";
import { isPolicyFailure, lanePlan, looksLikeRefusal } from "./routing";
import { checkBatch } from "./contentCheckServer";
import type { ClientProject, RequestBatch } from "./types";

export interface BriefResult {
  brief: string;
  model: string;
  lane: "standard" | "uncensored";
  /** Set when the standard lane refused and the uncensored lane wrote it. */
  rerouted: boolean;
  /** Plain-English reason the AI couldn't help, when it fell back to the plain list. */
  note?: string;
}

async function ask(models: string[], system: string, user: string) {
  const body: Record<string, unknown> = {
    model: models[0],
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.3,
    max_tokens: 1800,
    // The chain is declared on EVERY call, including the single-model ones.
    // Without it the hub's front-page pick (Jev Router, or whatever the owner
    // chose for the hub) would quietly take the brief: `planCall` treats an
    // "anthropic/…" id as "the general model" and substitutes the saved pick.
    // A brief is not a hub call — its model is this project's setting.
    task: { app: "client-review", models },
  };
  const res = await aiFetch({ body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await describeFailure(res);
    return { ok: false as const, status: res.status, text };
  }
  const json = (await res.json().catch(() => null)) as {
    model?: string;
    choices?: { message?: { content?: string; refusal?: string | null } }[];
  } | null;
  const msg = json?.choices?.[0]?.message;
  const content = (msg?.content ?? "").trim();
  return {
    ok: true as const,
    content,
    refused: Boolean(msg?.refusal) || looksLikeRefusal(content),
    model: json?.model || models[0],
  };
}

export async function writeBrief(p: ClientProject, batch: RequestBatch): Promise<BriefResult> {
  const fallback = (note: string): BriefResult => ({
    brief: plainBrief(p, batch),
    model: "plain list",
    lane: "standard",
    rerouted: false,
    note,
  });
  if (!aiConfigured()) return fallback("No AI key is set on this site, so this is the requests as a plain list.");

  const pick = (p.briefModel ?? "").trim();

  // The owner's own plan runs on their PC. This server is nowhere near it, so
  // say that plainly instead of quietly writing the brief with a cloud model
  // and labelling it with the plan's name.
  if (isSubscriptionValue(pick)) {
    return fallback(
      `“${pick.slice(SUBSCRIPTION_PREFIX.length)}” runs on your own Claude plan in the browser — open this project in a browser paired with your PC helper and press Improve there.`,
    );
  }

  // What the requests ask for, before spending a model call on them.
  const texts = liveRequestTexts(p, batch);
  const verdict = await checkBatch(texts, p.name);
  if (verdict.route === "blocked") {
    return { ...fallback(verdict.why), model: "not sent to any model" };
  }

  const user = briefPrompt(p, batch);

  // An explicit pick: one model, no lanes, no refusal re-route. The owner chose
  // it, so a refusal is reported rather than worked around behind their back.
  if (pick) {
    const out = await ask([pick], BRIEF_SYSTEM, user);
    if (out.ok && !out.refused && out.content) {
      return { brief: out.content, model: out.model, lane: laneForModel(pick), rerouted: false };
    }
    return fallback(
      out.ok
        ? `${out.model} declined to write this brief. Pick another model in the model menu, or switch to Auto.`
        : `The AI couldn't write this one: ${out.text}`,
    );
  }

  // Auto lane + explicit request: go straight to the uncensored models
  // rather than paying for Claude to refuse first.
  const lane = p.lane === "auto" && verdict.route === "uncensored" ? "uncensored" : p.lane;

  const plans = lanePlan(lane, {
    standard: process.env.CLIENT_REVIEW_STANDARD_MODELS,
    uncensored: process.env.CLIENT_REVIEW_UNCENSORED_MODELS,
  });
  let lastNote = "";

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const standard = plan.lane === "standard";
    // A named non-Claude model is sent as-is by aiFetch (one model per call),
    // so the uncensored lane walks its own list.
    const tries = standard ? [plan.models] : plan.models.map((m) => [m]);
    for (const models of tries) {
      const out = await ask(models, BRIEF_SYSTEM, user);
      if (out.ok && !out.refused && out.content) {
        return { brief: out.content, model: out.model, lane: plan.lane, rerouted: i > 0 };
      }
      if (out.ok) {
        lastNote = `${out.model} declined to write this brief.`;
        // A refusal on the standard lane is what "auto" re-routes on.
        if (standard) break;
        continue;
      }
      lastNote = out.text;
      if (standard && !isPolicyFailure(out.status, out.text)) {
        // Not a content refusal (no credit, outage): the uncensored lane would
        // not fix that, and silently sending the client's words there would
        // surprise the owner. Stop with the plain list.
        return fallback(`The AI couldn't write this one: ${out.text}`);
      }
      if (standard) break;
    }
  }
  return fallback(
    p.lane === "standard"
      ? `${lastNote} Switch this project's model to Auto or Uncensored to route explicit edits to the other model.`
      : `${lastNote || "No model answered."} Here are the requests as a plain list.`,
  );
}
