// ---------------------------------------------------------------------------
// The chat front door: Jev decides what kind of message this is before the
// big model starts.
//
// Every turn used to go to the chat model with the full tool list — browser,
// shell, files, Record, memory, lists, calendar. That makes the request big,
// and the hub's router (src/lib/ai/router.ts) treats "tools on the request" as
// harder work, so even "what's 15% of 80?" was answered by a tool-capable
// model reading a page of tool schemas.
//
// Jev answers one multiple-choice question in 70–500 ms, before that call:
//
//   quick     answer from what Jarvis knows — no tools at all, so the router
//             can give it to the fastest cheap model
//   remember  save or look up the owner's own things (memory, Record, lists,
//             calendar, folders) — only those tools, none for the PC
//   computer  needs the PC: browser, shell, files, screen — everything, as before
//   build     a coding job — everything, plus a nudge to offer the harness
//
// Rules that keep it safe:
//
//   - Only the FIRST step of a turn is triaged. Once a tool has run, the loop
//     keeps the full tool list, exactly as before.
//   - Only in Do and Ask. Browse and Run are the owner saying which tools they
//     want; Jev does not second-guess that.
//   - A turn carrying a picture or sound is never trimmed — what's in the
//     media can change what the job is.
//   - Below the confidence bar, or with no key, or if Jev is slow: nothing
//     changes. A wrong "quick" can only make Jarvis answer instead of act; it
//     can never make it act when it should not.
//
// Pure, so the decision is testable without a network. The call is in the
// agent route.
// ---------------------------------------------------------------------------

import type { DecisionRequest, DecisionResult } from "@/lib/ai/decisions";
import { confidentChoice, JEV } from "@/lib/ai/decisions";

export type TriageLane = "quick" | "remember" | "computer" | "build";

/** A "quick" or "remember" call trims tools, so it has to be surer than a plain choice. */
export const TRIAGE_CONFIDENCE = 0.75;

/** Past this Jev has stopped being a shortcut. Its published range is 70–500 ms. */
export const TRIAGE_TIMEOUT_MS = 1_200;

interface TurnMessage {
  role?: string;
  content?: unknown;
}

/** The latest user words, or null when this is not the first step of a turn. */
export function firstStepText(messages: TurnMessage[]): string | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return null;
  if (typeof last.content === "string") return last.content.trim() || null;
  if (!Array.isArray(last.content)) return null;
  // Media in the turn: leave it to the big model.
  if (last.content.some((p) => (p as { type?: string })?.type !== "text")) return null;
  const text = last.content
    .map((p) => (p as { text?: unknown }).text)
    .filter((t): t is string => typeof t === "string")
    .join("\n")
    .trim();
  return text || null;
}

export function shouldTriage(mode: string, messages: TurnMessage[]): boolean {
  return (mode === "do" || mode === "ask") && firstStepText(messages) !== null;
}

/** The question Jev is asked. Recent context helps "yes do it" mean something. */
export function triageRequest(text: string, previous: string): DecisionRequest {
  return {
    model: JEV,
    state: {
      message: text.slice(0, 2_000),
      ...(previous ? { previous_assistant_reply: previous.slice(0, 600) } : {}),
    },
    questions: {
      lane: {
        type: "choice",
        instructions:
          "A person sent this message to their personal assistant, which can use their computer. What does answering it need?",
        criteria: {
          quick: "Just an answer: a question, explanation, calculation, advice, writing or chat. Nothing to look up on their computer or the web, nothing to save.",
          remember: "Saving or looking up their own things: a memory, a note, a list item, a to-do, a calendar event, a personal detail.",
          computer: "Doing something on their computer or the web: browsing a site, searching online, opening or reading files, running commands, looking at the screen, current information like news, prices or weather.",
          build: "Writing, fixing or changing code, an app or a website.",
        },
      },
    },
  };
}

export interface TriagePlan {
  lane: TriageLane | null;
  /** Drop every tool. */
  noTools: boolean;
  /** Keep only the owner's own stores, none that need the PC. */
  hubOnly: boolean;
  /** An extra line for the system prompt. */
  note: string;
}

const NONE: TriagePlan = { lane: null, noTools: false, hubOnly: false, note: "" };

export function planFromTriage(result: DecisionResult | null): TriagePlan {
  const lane = confidentChoice(result, "lane", TRIAGE_CONFIDENCE) as TriageLane | null;
  switch (lane) {
    case "quick":
      return {
        lane,
        noTools: true,
        hubOnly: false,
        note: "This looks like a question you can answer directly. Answer it. If it turns out to need their computer or saving something, say so in one line and they will ask again.",
      };
    case "remember":
      return { lane, noTools: false, hubOnly: true, note: "" };
    case "build":
      return {
        lane,
        noTools: false,
        hubOnly: false,
        note: "This looks like a coding job. If it is bigger than a quick edit, suggest handing it to the harness (Claude Code or DeepSeek in its own worktree) in one line.",
      };
    case "computer":
      return { lane, noTools: false, hubOnly: false, note: "" };
    default:
      return NONE;
  }
}

/** The last thing Jarvis said, so a short reply like "yes, do it" has context. */
export function previousReply(messages: TurnMessage[]): string {
  for (let i = messages.length - 2; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && typeof m.content === "string" && m.content.trim()) return m.content;
  }
  return "";
}
