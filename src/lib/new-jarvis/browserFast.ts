// ---------------------------------------------------------------------------
// The fast browser lane: Jev clicks, Claude thinks.
//
// A browser agent is slow because every step — read the page, pick the link,
// read again — is a full chat-model call that writes a paragraph of reasoning
// to choose one button. Most of those steps are not reasoning at all. "Which
// of these 40 links gets me closer to the pricing page?" is a multiple-choice
// question, and Jev answers multiple-choice questions in well under a second.
//
// So the loop is split by what each step actually needs:
//
//   after any click, scroll, back or open     → read the page. No model at all;
//                                               the rules already say to.
//   after a read, the next move is a CLICK     → Jev picks it from the page's
//                                               own controls (links, buttons,
//                                               tabs, menu items).
//   anything else — typing, a form, judging     → the chat model, exactly as before.
//   what the page says, writing the answer,
//   or Jev not sure
//
// Jev only ever picks among controls that are really on the page, so it can
// choose wrong but cannot invent a target. And it never picks a control whose
// click cannot be undone (send, pay, delete, sign up…) — those go to the chat
// model and then still stop at the owner's gate, as every click always has.
//
// Jev can't type: it doesn't write text. Anything that needs words goes to the
// chat model. That is the whole split, and it is why it is fast and safe.
//
// Pure: the agent route asks Jev and then calls `pickStep`.
// ---------------------------------------------------------------------------

import type { DecisionRequest, DecisionResult } from "@/lib/ai/decisions";
import { confidentChoice } from "@/lib/ai/decisions";
import { isIrreversibleClick } from "./actions";

/** Tool-call ids the lane makes, so later rounds can tell its steps apart. */
export const FAST_ID = "jev_";

/** How sure Jev must be before it clicks instead of the chat model. */
export const CLICK_CONFIDENCE = 0.7;

/** Jev steps in a row before the chat model takes a look anyway. */
export const MAX_STREAK = 16;

/** Controls offered to Jev at once. Ranked by overlap with the goal. */
export const MAX_OPTIONS = 30;

export const FAST_TIMEOUT_MS = 1_500;

export interface Wire {
  role?: string;
  content?: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
}

export interface Control {
  ref: string;
  role: string;
  name: string;
}

export interface Snapshot {
  tabId?: string;
  url: string;
  title: string;
  text: string;
  controls: Control[];
}

/** What the person asked for in this turn: the latest user message's words. */
export function goalOf(messages: Wire[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content.trim();
    if (Array.isArray(m.content)) {
      return m.content
        .map((p) => (p as { text?: unknown }).text)
        .filter((t): t is string => typeof t === "string")
        .join("\n")
        .trim();
    }
    return "";
  }
  return "";
}

/** The messages after the latest user turn — this turn's steps. */
function thisTurn(messages: Wire[]): Wire[] {
  let i = messages.length - 1;
  while (i >= 0 && messages[i].role !== "user") i--;
  return messages.slice(i + 1);
}

/** Consecutive lane steps at the end of this turn. */
export function fastStreak(messages: Wire[]): number {
  let n = 0;
  for (const m of [...thisTurn(messages)].reverse()) {
    if (m.role === "tool") {
      if (!String(m.tool_call_id ?? "").startsWith(FAST_ID)) break;
      n += 1;
    }
  }
  return n;
}

/** The last tool result, if the conversation ends on one. */
export function lastTool(messages: Wire[]): { name: string; content: string } | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "tool") return null;
  return { name: String(last.name ?? ""), content: typeof last.content === "string" ? last.content : "" };
}

/** Names Jev already clicked this turn, so it doesn't go round in a circle. */
function clickedNames(messages: Wire[]): Set<string> {
  const out = new Set<string>();
  for (const m of thisTurn(messages)) {
    for (const c of m.tool_calls ?? []) {
      if (c.function?.name !== "browser_click") continue;
      try {
        const a = JSON.parse(c.function.arguments || "{}") as { name?: string };
        if (a.name) out.add(a.name.trim().toLowerCase());
      } catch {}
    }
  }
  return out;
}

const unescape = (s: string) => {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s;
  }
};

/**
 * A browser_read result back out of the tool message.
 *
 * The page sends it as JSON, but capped at 16k characters (runner.ts
 * forModel), so a long page arrives cut mid-object. Parse when it is whole;
 * otherwise pull each control out by pattern — the bridge always writes ref,
 * role and name first, in that order.
 */
export function parseSnapshot(content: string): Snapshot | null {
  if (!content || content.startsWith("That step failed")) return null;
  try {
    const j = JSON.parse(content) as { tabId?: string; url?: string; title?: string; text?: string; elements?: Control[] };
    if (Array.isArray(j.elements)) {
      return {
        tabId: j.tabId,
        url: j.url ?? "",
        title: j.title ?? "",
        text: j.text ?? "",
        controls: j.elements.filter((e) => e && typeof e.ref === "string").map((e) => ({ ref: e.ref, role: String(e.role ?? ""), name: String(e.name ?? "") })),
      };
    }
  } catch {}
  const field = (k: string) => {
    const m = content.match(new RegExp(`"${k}":"((?:[^"\\\\]|\\\\.)*)"`));
    return m ? unescape(m[1]) : "";
  };
  const controls: Control[] = [];
  const re = /\{"ref":"(ref_\d+)","role":"((?:[^"\\]|\\.)*)","name":"((?:[^"\\]|\\.)*)"/g;
  for (let m = re.exec(content); m; m = re.exec(content)) controls.push({ ref: m[1], role: unescape(m[2]), name: unescape(m[3]) });
  if (!controls.length) return null;
  return { tabId: field("tabId") || undefined, url: field("url"), title: field("title"), text: field("text"), controls };
}

const CLICKABLE = new Set(["link", "a", "button", "tab", "menuitem"]);

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

/**
 * The clicks Jev may choose between: links, buttons, tabs and menu items
 * with a visible name, minus anything irreversible and anything it already
 * clicked this turn, ranked by how many of the goal's words they share.
 */
export function clickOptions(snap: Snapshot, goal: string, already: Set<string>): Control[] {
  const want = new Set(words(goal));
  const seen = new Set<string>();
  const pool = snap.controls.filter((c) => {
    const name = c.name.trim();
    const key = name.toLowerCase();
    if (!name || name.length > 80 || !CLICKABLE.has(c.role.toLowerCase())) return false;
    if (isIrreversibleClick(name) || already.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const score = (c: Control) => words(c.name).filter((w) => want.has(w)).length;
  return pool
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, MAX_OPTIONS)
    .map((x) => x.c);
}

/** Option keys must be plain identifiers; refs already are. */
const META = {
  think: "None of these clicks clearly moves toward the goal — or the next step needs typing, filling a form, choosing carefully, or reading and judging what the page says.",
  done: "The page already shows what the goal asked for, or the goal is complete. Time to answer.",
  scroll: "What is needed is probably further down this same page.",
  back: "This page is a wrong turn for the goal. Go back.",
} as const;

export function fastRequest(goal: string, snap: Snapshot, options: Control[]): DecisionRequest {
  const criteria: Record<string, string> = {};
  for (const o of options) criteria[o.ref] = `Click the ${o.role} "${o.name}".`;
  for (const [k, v] of Object.entries(META)) criteria[k] = v;
  return {
    model: "typesafe/jev-1.13",
    state: {
      goal: goal.slice(0, 1_500),
      page_title: snap.title.slice(0, 200),
      page_url: snap.url.slice(0, 300),
      page_text: snap.text.slice(0, 4_000),
    },
    questions: {
      next: {
        type: "choice",
        instructions: "An assistant is using a web browser to do this goal for someone. Given the page it is on, what is the best next step?",
        criteria,
      },
    },
  };
}

export interface FastStep {
  toolCall: { id: string; name: string; args: Record<string, unknown> };
  /** What it did, for the ledger and logs. */
  why: string;
}

function newId(): string {
  return `${FAST_ID}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Steps that change the page, after which the only sensible move is to read it. */
const MOVES = new Set(["browser_open", "browser_click", "browser_scroll", "browser_navigate"]);

/**
 * No model at all: the last step moved the page, so read it. Saves a whole
 * chat-model round trip per click — the system prompt already tells the model
 * to do exactly this.
 */
export function autoRead(messages: Wire[], hasBrowser: boolean): FastStep | null {
  if (!hasBrowser) return null;
  const last = lastTool(messages);
  if (!last || !MOVES.has(last.name) || last.content.startsWith("That step failed") || last.content.startsWith("The owner declined")) return null;
  if (fastStreak(messages) >= MAX_STREAK) return null;
  let tabId: string | undefined;
  const m = last.content.match(/"tabId":"([^"]+)"/);
  if (m) tabId = m[1];
  return { toolCall: { id: newId(), name: "browser_read", args: tabId ? { tabId } : {} }, why: "read the page after it changed" };
}

/** Should Jev be asked about this round at all? */
export function fastCandidate(messages: Wire[], mode: string, hasBrowser: boolean): { snap: Snapshot; options: Control[]; goal: string } | null {
  if (!hasBrowser || (mode !== "browse" && mode !== "do")) return null;
  const last = lastTool(messages);
  if (!last || last.name !== "browser_read") return null;
  if (fastStreak(messages) >= MAX_STREAK) return null;
  const snap = parseSnapshot(last.content);
  const goal = goalOf(messages);
  if (!snap || !goal) return null;
  const options = clickOptions(snap, goal, clickedNames(messages));
  return { snap, options, goal };
}

/** Jev's answer as a step, or null to hand the round to the chat model. */
export function pickStep(result: DecisionResult | null, c: { snap: Snapshot; options: Control[] }, messages: Wire[]): FastStep | null {
  const pick = confidentChoice(result, "next", CLICK_CONFIDENCE);
  if (!pick || pick === "think" || pick === "done") return null;
  const tab = c.snap.tabId ? { tabId: c.snap.tabId } : {};
  if (pick === "scroll") {
    // Two lane scrolls in a row and still nothing: let the model look.
    const recent = thisTurn(messages).filter((m) => m.role === "tool").slice(-4).filter((m) => m.name === "browser_scroll").length;
    if (recent >= 2) return null;
    return { toolCall: { id: newId(), name: "browser_scroll", args: { direction: "down", ...tab } }, why: "scroll for more" };
  }
  if (pick === "back") return { toolCall: { id: newId(), name: "browser_navigate", args: { action: "back", ...tab } }, why: "wrong page, go back" };
  const target = c.options.find((o) => o.ref === pick);
  if (!target) return null;
  return { toolCall: { id: newId(), name: "browser_click", args: { ref: target.ref, name: target.name, ...tab } }, why: `click "${target.name}"` };
}
