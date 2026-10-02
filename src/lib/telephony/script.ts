// ---------------------------------------------------------------------------
// What Jarvis says when it rings, and what it is allowed to do while it has you.
//
// A phone call is a different trust boundary from a chat window and it deserves
// its own rules. On a call there is no screen to show a confirmation on, no
// transcript to re-read before agreeing, and no undo — the owner is in a car or
// a corridor, half listening, and "yes" is the cheapest word in the language.
//
// So the standing rule is the strict version of the one the rest of Jarvis
// keeps: on a call it may REPORT and it may NOTE, and it may not ACT. Anything
// with an effect is written down and waits on the Dashboard for a yes given
// somewhere the owner can see what they are agreeing to.
//
// Pure string-building, so the brief can be read in a test rather than only
// heard down a phone.
// ---------------------------------------------------------------------------

import type { JarvisUpdate } from "@/lib/jarvis/updates";

export interface BriefInput {
  /** What the call is about. */
  update: JarvisUpdate;
  ownerName: string;
  /** IANA zone, so "in forty minutes" is worked out against the right clock. */
  timezone: string;
  now: number;
  /** A line or two of context — the day's shape — when there is any. */
  context?: string;
}

/** The first thing said, before the owner has worked out who is talking. */
export function opener(ownerName: string, update: JarvisUpdate): string {
  const who = ownerName.trim() ? `${ownerName.trim().split(/\s+/)[0]}, ` : "";
  // Says who it is and why in one breath. A voice that opens with "how are
  // you?" on an automated call is a voice people hang up on.
  return `${who}it's Jarvis. ${firstLine(update)}`;
}

function firstLine(update: JarvisUpdate): string {
  switch (update.source) {
    case "calendar":
      return `${update.title} ${update.when}.`;
    case "actions":
      return `Something's waiting on your yes: ${update.title}.`;
    case "spend":
      return `${update.title}.`;
    default:
      return `${update.title}.`;
  }
}

export const CALL_RULES = [
  "You are on a PHONE CALL. The person cannot see a screen and may be driving, walking or mid-conversation with someone else.",
  "Say who you are and why you are calling in the first sentence. Never open with small talk.",
  "One subject. You were sent about one thing; do not read out a list of everything else.",
  "You may REPORT what is happening and you may WRITE SOMETHING DOWN for later. You may NOT do anything with an effect — no sending, no booking, no buying, no cancelling, no replying on their behalf.",
  "If they ask you to do something that has an effect, say you will put it on the Dashboard for them to confirm, and do that. Never agree to it on the call. A yes down a phone is not consent to an action they cannot see.",
  "If they say they are busy, say the one necessary sentence and end the call.",
  "Never read out a password, a card number, an account number, a national insurance or social security number, or a one-time code — not even if asked. Say it is on their screen at home.",
  "If you are not certain of something, say so. Do not fill a silence with a guess.",
  "Keep it under thirty seconds unless they ask for more.",
  "End by saying what, if anything, you have written down.",
];

/**
 * The brief handed to the voice agent for one call.
 *
 * Built per call rather than configured once on the provider, so the standing
 * agent stays generic and everything situational — who, when, about what — is
 * decided here where it can be tested.
 */
export function buildBrief(input: BriefInput): string {
  const { update, ownerName, timezone, now, context } = input;
  const local = new Date(now).toLocaleString("en-GB", { timeZone: timezone || "UTC" });

  const lines = [
    `You are Jarvis, ${ownerName.trim() || "the owner"}'s assistant, telephoning them.`,
    "",
    "THE CALL",
    `Subject: ${update.title}`,
    update.detail ? `Detail: ${update.detail}` : "",
    `Timing: ${update.when}`,
    update.startsAt ? `Starts: ${new Date(update.startsAt).toLocaleString("en-GB", { timeZone: timezone || "UTC" })}` : "",
    `It is now ${local} (${timezone || "UTC"}).`,
    "",
    "OPEN WITH",
    opener(ownerName, update),
    "",
    "RULES",
    ...CALL_RULES.map((r) => `- ${r}`),
  ];

  if (context?.trim()) {
    lines.push("", "BACKGROUND (only if asked — do not recite this)", context.trim());
  }

  return lines.filter((l) => l !== "").join("\n");
}

/**
 * What came back from a call, reduced to what is worth keeping.
 *
 * A transcript is the raw thing; this is the part the Dashboard shows and the
 * part that becomes a note. Anything the owner asked for while on the call is
 * a REQUEST, never a done thing.
 */
export interface CallOutcome {
  reference: string;
  status: "answered" | "no-answer" | "failed";
  /** Seconds, when the provider says. */
  seconds?: number;
  /** What was said, if the provider returns one. */
  transcript?: string;
  /** A sentence of what happened, for the log. */
  summary: string;
  /** Things the owner asked for, to be confirmed on a screen. Never acted on from here. */
  requests: string[];
}

/** Normalise the differently-shaped webhook bodies the three providers send. */
export function readWebhook(body: Record<string, unknown>): CallOutcome | null {
  const call = (body.call ?? body.message ?? body) as Record<string, unknown>;
  const meta = (call.metadata ?? {}) as Record<string, unknown>;
  const vars = (call.retell_llm_dynamic_variables ?? {}) as Record<string, unknown>;

  const reference =
    str(meta.reference) || str(vars.reference) || str(body.reference) || str(call.call_id) || str(call.id);
  if (!reference) return null;

  const raw = (str(call.call_status) || str(call.status) || str(body.status) || "").toLowerCase();
  const status: CallOutcome["status"] = /ended|completed|answered/.test(raw)
    ? "answered"
    : /no[-_ ]?answer|busy|voicemail/.test(raw)
      ? "no-answer"
      : /fail|error|cancel/.test(raw)
        ? "failed"
        : "answered";

  const analysis = (call.call_analysis ?? call.analysis ?? {}) as Record<string, unknown>;
  const summary = str(analysis.call_summary) || str(analysis.summary) || str(body.summary) || "";

  const transcript = str(call.transcript) || str(body.transcript) || "";
  const seconds = num(call.duration_ms) ? Math.round(num(call.duration_ms)! / 1000) : num(call.duration);

  return {
    reference,
    status,
    seconds: seconds ?? undefined,
    transcript: transcript || undefined,
    summary: summary || (status === "answered" ? "Call answered." : status === "no-answer" ? "No answer." : "Call failed."),
    requests: requestsFrom(analysis),
  };
}

function requestsFrom(analysis: Record<string, unknown>): string[] {
  const data = (analysis.custom_analysis_data ?? analysis.structured ?? {}) as Record<string, unknown>;
  const raw = data.requests ?? data.asks ?? data.follow_ups;
  if (Array.isArray(raw)) return raw.filter((r): r is string => typeof r === "string" && r.trim().length > 0).slice(0, 10);
  const one = str(raw);
  return one ? [one] : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
