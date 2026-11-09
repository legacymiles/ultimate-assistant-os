// ---------------------------------------------------------------------------
// The words that turn a client's edit requests into a build brief.
//
// Shared by the server route (an OpenRouter model, in brief.ts) and the browser
// path (the owner's own Claude plan, through the PC bridge, in
// subscriptionBrief.ts), so both ask for exactly the same brief — the model is
// the only thing that changes between them.
//
// Pure on purpose: no server imports, so a client component can build the same
// prompt without a round trip.
// ---------------------------------------------------------------------------

import { buildText } from "./logic";
import type { ClientProject, RequestBatch } from "./types";

export const BRIEF_SYSTEM = [
  "You turn a website client's edit requests into a precise build brief for the developer.",
  "The site, its subject matter and its audience are the client's business; describe the requested changes faithfully and without judgement.",
  "For each request: say WHAT changes, WHERE on the page (use any pin position given), and the acceptance check.",
  "Group related requests, flag contradictions or anything ambiguous as a question for the client, and keep the client's intent.",
  "Output plain text with short numbered sections. No preamble.",
].join(" ");

export function briefPrompt(p: ClientProject, batch: RequestBatch): string {
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

/** The requests a brief is written for, minus anything the owner rejected. */
export function liveRequestTexts(p: ClientProject, batch: RequestBatch): string[] {
  return batch.requestIds
    .map((id) => p.requests.find((r) => r.id === id))
    .filter((r) => r && r.status !== "rejected")
    .map((r) => buildText(r!));
}
