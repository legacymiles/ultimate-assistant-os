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
// TYPING. Jev doesn't write words, but it can pick them. When it chooses
// "type into this box", a second quick Jev call decides where the words come
// from, cheapest first:
//
//   your saved details   the box is a Life Record field you've filled (name,
//                        email, address…). Jarvis fills it in THIS TAB from
//                        the Record — the value never reaches a server or a
//                        model. Sensitive fields (ID numbers, accounts) never.
//   your own words       the text is already in your message ("search for
//                        blue running shoes") — Jev picks the snippet.
//   new words            only now does a model write anything: a small cheap
//                        one, given just the goal and the box's label, never
//                        the whole conversation. DeepSeek by default, so
//                        explicit sites work too.
//
// Never a password, card or ID box; never "submit" — pressing Enter or a Send
// button still goes through the owner's gate exactly as before. Long writing
// (a whole email) and anything Jev isn't sure about stays with the chat model.
//
// Pure: the agent route asks Jev and then calls `pickStep`.
// ---------------------------------------------------------------------------

import type { DecisionRequest, DecisionResult } from "@/lib/ai/decisions";
import { confidentChoice, JEV } from "@/lib/ai/decisions";
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
  /** The input's type attribute, when the read had it. */
  type?: string;
  /** What's already in the box. */
  value?: string;
  /** The bridge masked it as secret. */
  masked?: boolean;
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
      const tool = c.function?.name;
      if (tool !== "browser_click" && tool !== "browser_type" && tool !== "record_fill") continue;
      try {
        const a = JSON.parse(c.function.arguments || "{}") as { name?: string; ref?: string };
        if (tool === "browser_click" && a.name) out.add(a.name.trim().toLowerCase());
        // A box typed into this turn, by its label: refs are renumbered on every read.
        if (tool !== "browser_click" && a.name) out.add(`typed:${a.name.trim().toLowerCase()}`);
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
        controls: j.elements
          .filter((e) => e && typeof e.ref === "string")
          .map((e) => ({
            ref: e.ref,
            role: String(e.role ?? ""),
            name: String(e.name ?? ""),
            ...(typeof e.type === "string" ? { type: e.type } : {}),
            ...(typeof e.value === "string" ? { value: e.value } : {}),
            ...(e.masked ? { masked: true } : {}),
          })),
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

const TYPABLE = new Set(["input", "textarea", "textbox", "searchbox", "combobox"]);
/** Input types that take free text. Anything else (checkbox, file, date pickers…) is not typed into here. */
const TEXT_TYPES = new Set(["", "text", "search", "email", "tel", "url", "number"]);
/** Boxes no model ever types into. The bridge masks most of these already; this is the second lock. */
const SECRET = /pass(word|code|phrase)?|\bpin\b|card|cvv|cvc|security code|expir|ssn|social security|routing|account (no|number|#)|iban|sort code|tax id|passport|licen[cs]e (no|number)/i;

/** Boxes Jev may type into: empty, free-text, not secret, not typed into this turn. */
export function typeOptions(snap: Snapshot, goal: string, already: Set<string>): Control[] {
  const want = new Set(words(goal));
  const seen = new Set<string>();
  const pool = snap.controls.filter((c) => {
    const role = c.role.toLowerCase();
    const type = (c.type ?? "").toLowerCase();
    const name = c.name.trim();
    if (!name || name.length > 80 || !TYPABLE.has(role)) return false;
    if (role === "input" && !TEXT_TYPES.has(type)) return false;
    if (c.masked || type === "password" || SECRET.test(name)) return false;
    if (c.value && c.value.trim()) return false;
    const key = `type:${c.ref}`;
    if (already.has(key) || seen.has(name.toLowerCase())) return false;
    seen.add(name.toLowerCase());
    return true;
  });
  const score = (c: Control) => words(c.name).filter((w) => want.has(w)).length;
  return pool
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, 10)
    .map((x) => x.c);
}

/** Option keys must be plain identifiers; refs already are. */
const META = {
  think: "None of these clearly moves toward the goal — or the next step needs choosing carefully, writing something long, or reading and judging what the page says.",
  done: "The page already shows what the goal asked for, or the goal is complete. Time to answer.",
  scroll: "What is needed is probably further down this same page.",
  back: "This page is a wrong turn for the goal. Go back.",
} as const;

export function fastRequest(goal: string, snap: Snapshot, options: Control[], typables: Control[] = []): DecisionRequest {
  const criteria: Record<string, string> = {};
  for (const o of options) criteria[o.ref] = `Click the ${o.role} "${o.name}".`;
  for (const t of typables) criteria[`type_${t.ref}`] = `Type into the empty box "${t.name}".`;
  for (const [k, v] of Object.entries(META)) criteria[k] = v;
  return {
    model: JEV,
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
const MOVES = new Set(["browser_open", "browser_click", "browser_scroll", "browser_navigate", "browser_type", "record_fill"]);

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
export interface Candidate {
  snap: Snapshot;
  options: Control[];
  typables: Control[];
  goal: string;
}

export function fastCandidate(messages: Wire[], mode: string, hasBrowser: boolean): Candidate | null {
  if (!hasBrowser || (mode !== "browse" && mode !== "do")) return null;
  const last = lastTool(messages);
  if (!last || last.name !== "browser_read") return null;
  if (fastStreak(messages) >= MAX_STREAK) return null;
  const snap = parseSnapshot(last.content);
  const goal = goalOf(messages);
  if (!snap || !goal) return null;
  const done = clickedNames(messages);
  const options = clickOptions(snap, goal, done);
  const typables = typeOptions(snap, goal, new Set()).filter((t) => !done.has(`typed:${t.name.trim().toLowerCase()}`));
  return { snap, options, typables, goal };
}

/** Jev chose to type: which box. The words are decided by a second call (see wordsRequest). */
export interface TypeIntent {
  box: Control;
}

/** Jev's answer as a step, a box to type into, or null to hand the round to the chat model. */
export function pickStep(
  result: DecisionResult | null,
  c: { snap: Snapshot; options: Control[]; typables?: Control[] },
  messages: Wire[],
): FastStep | TypeIntent | null {
  const pick = confidentChoice(result, "next", CLICK_CONFIDENCE);
  if (!pick || pick === "think" || pick === "done") return null;
  if (pick.startsWith("type_")) {
    const box = (c.typables ?? []).find((t) => `type_${t.ref}` === pick);
    return box ? { box } : null;
  }
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

// --- typing: where the words come from --------------------------------------

/** How sure Jev must be about WHICH words before they're typed. */
export const WORDS_CONFIDENCE = 0.7;

/** A saved Life Record field the page told us is filled. Key and label only — never the value. */
export interface SavedField {
  key: string;
  label: string;
}

/**
 * Pieces of the person's own message that could be what goes in a box:
 * anything in quotes, what follows "search for / look up / type / enter…",
 * and the whole message when it is short.
 */
export function snippetsFrom(goal: string): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim().replace(/[.!?,;:]+$/, "");
    if (t && t.length <= 200 && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  for (const m of goal.matchAll(/["“']([^"”']{2,200})["”']/g)) add(m[1]);
  const after =
    /\b(?:search(?:\s+(?:for|up))?|look\s+up|look\s+for|find|type|enter|put|write|google|query|for)\s+(.{2,160}?)(?=\s+(?:on|in|at|into|from|and then|then|and)\s|[.!?\n]|$)/gi;
  for (const m of goal.matchAll(after)) add(m[1]);
  if (goal.length <= 80) add(goal);
  return out.slice(0, 6);
}

/** Saved fields whose label shares words with the box, plus the rule-matched one, best first. */
export function savedFor(box: Control, saved: SavedField[], ruleKey?: string | null): SavedField[] {
  const want = new Set(words(box.name));
  const scored = saved
    .map((f, i) => ({ f, i, s: (f.key === ruleKey ? 10 : 0) + words(f.label).filter((w) => want.has(w)).length }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.slice(0, 10).map((x) => x.f);
}

export interface WordsContext {
  box: Control;
  snippets: string[];
  saved: SavedField[];
}

export function wordsRequest(goal: string, snap: Snapshot, ctx: WordsContext): DecisionRequest {
  const criteria: Record<string, string> = {};
  ctx.saved.forEach((f) => (criteria[`saved_${f.key}`] = `Their saved ${f.label}.`));
  ctx.snippets.forEach((t, i) => (criteria[`said_${i}`] = `Exactly these words from their request: "${t}"`));
  criteria.write = "Something new has to be written for this box — it is not in their request and not one of their saved details.";
  criteria.unsure = "It is not clear what belongs in this box.";
  return {
    model: JEV,
    state: {
      goal: goal.slice(0, 1_500),
      page_title: snap.title.slice(0, 200),
      box_label: ctx.box.name.slice(0, 200),
    },
    questions: {
      words: {
        type: "choice",
        instructions: "An assistant is filling in a box on a web page to do this goal for someone. What should go in this box?",
        criteria,
      },
    },
  };
}

export type WordsPick = { kind: "said"; text: string } | { kind: "saved"; key: string; label: string } | { kind: "write" } | null;

export function pickWords(result: DecisionResult | null, ctx: WordsContext): WordsPick {
  const pick = confidentChoice(result, "words", WORDS_CONFIDENCE);
  if (!pick || pick === "unsure") return null;
  if (pick === "write") return { kind: "write" };
  if (pick.startsWith("said_")) {
    const text = ctx.snippets[Number(pick.slice(5))];
    return text ? { kind: "said", text } : null;
  }
  if (pick.startsWith("saved_")) {
    const f = ctx.saved.find((x) => `saved_${x.key}` === pick);
    return f ? { kind: "saved", key: f.key, label: f.label } : null;
  }
  return null;
}

/** Type words into a box. Never submits — Enter or a Send button still go through the gate. */
export function typeStep(box: Control, value: string, tabId: string | undefined, why: string): FastStep {
  return {
    toolCall: { id: newId(), name: "browser_type", args: { ref: box.ref, value, name: box.name, ...(tabId ? { tabId } : {}) } },
    why,
  };
}

/** Fill a box from the Life Record, in the owner's tab. The value is never in this message. */
export function fillStep(box: Control, key: string, label: string, tabId: string | undefined): FastStep {
  return {
    toolCall: { id: newId(), name: "record_fill", args: { ref: box.ref, key, name: box.name, ...(tabId ? { tabId } : {}) } },
    why: `fill "${box.name}" with your saved ${label}`,
  };
}

/** The tiny prompt the word-writer gets: the goal and the box, nothing else. */
export function writerPrompt(goal: string, snap: Snapshot, box: Control): { system: string; user: string } {
  return {
    system:
      "You fill in one box on a web page for someone. Reply with ONLY the exact text to type into the box — no quotes, no explanation, no preamble. Keep it as short as the box needs. If you can't tell what belongs there, reply with exactly: ?",
    user: `What they want done: ${goal.slice(0, 1_200)}\nPage: ${snap.title.slice(0, 160)} (${snap.url.slice(0, 200)})\nThe box is labelled: "${box.name.slice(0, 160)}"${box.role === "textarea" ? " (a multi-line box)" : ""}`,
  };
}

/** The writer's reply, cleaned — or null when it is empty, unsure, a refusal, or far too long. */
export function cleanWritten(raw: string, box: Control): string | null {
  let t = raw.trim().replace(/^["'`“”]+|["'`“”]+$/g, "").trim();
  if (!t || t === "?" || /^(i('m| am) (sorry|unable)|i can(no|')t|sorry[,.])/i.test(t)) return null;
  const max = box.role === "textarea" ? 1_500 : 300;
  if (t.length > max) return null;
  if (box.role !== "textarea") t = t.replace(/\s*\n+\s*/g, " ");
  return t;
}
