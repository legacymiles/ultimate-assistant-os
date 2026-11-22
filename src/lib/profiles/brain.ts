"use client";

// ---------------------------------------------------------------------------
// Which brain answers the Profiles chat, in order:
//
//   1. the Jarvis harness on the owner's PC (Claude / DeepSeek, their own plan)
//   2. the hub's cloud model (/api/profiles/agent)
//   3. the offline reader (offline.ts) — always there, needs nothing
//
// Settings can pin one. On "auto", a brain that fails hands the question to the
// next one and the reply says which answered and why the first did not, so a
// harness that is switched off is visible rather than silently skipped.
// ---------------------------------------------------------------------------

import { historyBlock, parseReply, systemPrompt, type Turn, type WebContext } from "./agent";
import { foundBlock, gatherFound, type Found } from "./found";
import { askHarness, harnessStatus, type HarnessStatus } from "./harnessBrain";
import { offlineBrain } from "./offline";
import { gapsFor, needsResearch, researchBlock, researchQuery, subjectOf, type WebNote } from "./research";
import type { AgentReply, ProfilesData } from "./types";

export interface AskInput {
  data: ProfilesData;
  here: string;
  scope: "all" | "here";
  message: string;
  history: Turn[];
  signal?: AbortSignal;
  onText?: (sofar: string) => void;
}

export interface Answer extends AgentReply {
  /** Why an earlier brain was passed over, in plain words. */
  note?: string;
  /** "Claude on your PC" */
  label: string;
  /** What turned up in Memory and the Dashboard, for the source cards. */
  found: Found[];
}

let cached: { at: number; status: HarnessStatus } | null = null;

export async function harnessReady(force = false): Promise<HarnessStatus> {
  if (!force && cached && Date.now() - cached.at < 20_000) return cached.status;
  const status = await harnessStatus();
  cached = { at: Date.now(), status };
  return status;
}

/**
 * Look the question up on the web, when it is a how-to rather than a lookup.
 *
 * Free and keyless server-side (see /api/profiles/research), gated by
 * needsResearch so an ordinary "what's my son's teacher's email" costs no
 * extra round trip. Never throws: research failing must not cost the owner
 * their answer, so a failure just means no web block and the prompt tells the
 * brain to say it hasn't checked.
 */
async function research(input: AskInput): Promise<WebContext> {
  if (!needsResearch(input.message)) return {};
  const subject = subjectOf(input.data, input.here);
  const query = researchQuery(input.message, subject);
  const gaps = gapsFor(subject);
  const ctx: WebContext = { gaps, subject: subject?.name };
  try {
    const res = await fetch("/api/profiles/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: input.signal,
    });
    if (!res.ok) return ctx;
    const json = (await res.json()) as { results?: WebNote[]; pages?: { url: string; text: string }[] };
    const hits = Array.isArray(json.results) ? json.results : [];
    if (!hits.length && !json.pages?.length) return ctx;
    return { ...ctx, block: researchBlock(query, hits, json.pages ?? []) };
  } catch {
    return ctx;
  }
}

function scopeLine(input: AskInput): string {
  if (input.scope !== "here") return "";
  const n = input.data.nodes[input.here];
  return n ? `\nAnswer only from ${n.name} and what is inside it.` : "";
}

async function viaHarness(input: AskInput, label: string, found: Found[], web: WebContext): Promise<Answer> {
  const prompt = [
    systemPrompt(input.data, input.here, "", foundBlock(found), web) + scopeLine(input),
    "(This outline is current; it replaces any outline sent earlier in this thread.)",
    historyBlock(input.history),
    `OWNER: ${input.message}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = await askHarness(prompt, {
    signal: input.signal,
    // Show the words as they arrive, without the actions block half-typed.
    onText: (s) => input.onText?.(s.split("```")[0]),
  });
  const { text, actions } = parseReply(raw);
  return { text: text || "Done.", actions, by: "harness", label: `${label} on your PC`, found };
}

async function viaCloud(input: AskInput, found: Found[], web: WebContext): Promise<Answer> {
  const res = await fetch("/api/profiles/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system: systemPrompt(input.data, input.here, "", foundBlock(found), web) + scopeLine(input), history: input.history, message: input.message }),
    signal: input.signal,
  });
  const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string; offline?: boolean };
  if (!res.ok || !json.text) {
    const err = new Error(json.error ?? `The cloud model answered ${res.status}.`);
    (err as Error & { offline?: boolean }).offline = Boolean(json.offline);
    throw err;
  }
  const { text, actions } = parseReply(json.text);
  input.onText?.(text);
  return { text: text || "Done.", actions, by: "cloud", label: "Cloud", found };
}

function viaOffline(input: AskInput, found: Found[], note?: string): Answer {
  const r = offlineBrain(input.data, input.message, input.here, input.scope, found);
  return { ...r, label: "Offline", note, found };
}

export async function ask(input: AskInput): Promise<Answer> {
  const pinned = input.data.settings.brain;
  const notes: string[] = [];
  // Look outside Profiles first (Memory, Folders, Photos), and look the
  // question up on the web when it is a how-to — both alongside the PC check,
  // so research costs no extra wait.
  const [found, status, web] = await Promise.all([
    gatherFound(input.message, input.signal),
    pinned === "auto" || pinned === "harness" ? harnessReady() : Promise.resolve(null),
    pinned === "offline" ? Promise.resolve({} as WebContext) : research(input),
  ]);

  if (pinned === "offline") return viaOffline(input, found);

  if (status) {
    if (status.ok) {
      try {
        return await viaHarness(input, status.label, found, web);
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        cached = null;
        notes.push(`Your PC harness didn't answer: ${(e as Error).message}`);
      }
    } else {
      notes.push(status.why);
    }
    if (pinned === "harness") return viaOffline(input, found, notes.join(" "));
  }

  try {
    const a = await viaCloud(input, found, web);
    return notes.length ? { ...a, note: notes.join(" ") } : a;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    if (!(e as Error & { offline?: boolean }).offline) notes.push((e as Error).message);
  }
  return viaOffline(input, found, notes.join(" ") || undefined);
}
