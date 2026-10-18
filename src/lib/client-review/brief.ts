// ---------------------------------------------------------------------------
// "Improve" — turning a client's edit requests into a build brief.
//
// The client writes the way people talk ("make the top bigger and less
// boring"). The owner needs a brief they — or a coding agent — can build from.
// This asks a model for one, down the project's lane (see routing.ts), and
// falls back to a plain numbered list when no AI is configured, so the button
// never just fails.
// ---------------------------------------------------------------------------

import "server-only";

import { aiConfigured, aiFetch, describeFailure } from "@/lib/ai/provider";
import { buildText, plainBrief } from "./logic";
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

const SYSTEM = [
  "You turn a website client's edit requests into a precise build brief for the developer.",
  "The site, its subject matter and its audience are the client's business; describe the requested changes faithfully and without judgement.",
  "For each request: say WHAT changes, WHERE on the page (use any pin position given), and the acceptance check.",
  "Group related requests, flag contradictions or anything ambiguous as a question for the client, and keep the client's intent.",
  "Output plain text with short numbered sections. No preamble.",
].join(" ");

function userPrompt(p: ClientProject, batch: RequestBatch): string {
  const from = p.versions.find((v) => v.id === batch.versionId);
  const reqs = batch.requestIds
    .map((id) => p.requests.find((r) => r.id === id))
    .filter((r) => r && r.status !== "rejected");
  const lines = reqs.map((r, i) => {
    const pin = r!.pin
      ? ` [pinned ${Math.round(r!.pin.x * 100)}% from left, ${Math.round(r!.pin.y * 100)}% from top of the visible screen${r!.pin.viewport ? `, ${r!.pin.viewport}px wide` : ""}]`
      : "";
    return `${i + 1}. ${buildText(r!)}${pin}`;
  });
  return [
    `Project: ${p.name}${p.clientName ? ` for ${p.clientName}` : ""}`,
    from ? `Current version: ${from.number}${from.siteUrl ? ` at ${from.siteUrl}` : ""}` : "",
    from?.summary ? `What that version is: ${from.summary}` : "",
    "",
    "Client edit requests:",
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");
}

async function ask(models: string[], standard: boolean, system: string, user: string) {
  const body: Record<string, unknown> = {
    model: models[0],
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.3,
    max_tokens: 1800,
    // The standard lane names its Claude models as the chain, so the hub's
    // front-page model pick doesn't quietly send a client brief elsewhere.
    task: standard ? { app: "client-review", models } : { app: "client-review" },
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

  // What the requests ask for, before spending a model call on them.
  const texts = batch.requestIds
    .map((id) => p.requests.find((r) => r.id === id))
    .filter((r) => r && r.status !== "rejected")
    .map((r) => buildText(r!));
  const verdict = await checkBatch(texts, p.name);
  if (verdict.route === "blocked") {
    return { ...fallback(verdict.why), model: "not sent to any model" };
  }
  // Auto lane + explicit request: go straight to the uncensored models
  // rather than paying for Claude to refuse first.
  const lane = p.lane === "auto" && verdict.route === "uncensored" ? "uncensored" : p.lane;

  const plans = lanePlan(lane, {
    standard: process.env.CLIENT_REVIEW_STANDARD_MODELS,
    uncensored: process.env.CLIENT_REVIEW_UNCENSORED_MODELS,
  });
  const user = userPrompt(p, batch);
  let lastNote = "";

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const standard = plan.lane === "standard";
    // A named non-Claude model is sent as-is by aiFetch (one model per call),
    // so the uncensored lane walks its own list.
    const tries = standard ? [plan.models] : plan.models.map((m) => [m]);
    for (const models of tries) {
      const out = await ask(models, standard, SYSTEM, user);
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
      ? `${lastNote} Switch this project's lane to Auto or Uncensored to route explicit edits to the other model.`
      : `${lastNote || "No model answered."} Here are the requests as a plain list.`,
  );
}
