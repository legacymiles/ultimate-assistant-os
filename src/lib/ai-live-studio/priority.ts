// What gets answered first. Gifts and follows are the moments a viewer paid
// for in money or attention; answering those late is what loses them.

import type { AgentEvent } from "./events";

export const PRIORITY = {
  /** The owner pressed "Answer now" or typed a line for the character. */
  operator: 1000,
  gift: 100,
  follow: 80,
  mention: 60,
  share: 50,
  question: 40,
  chatter: 20,
} as const;

/** Whole-word, case-insensitive, with or without a leading @. */
export function mentionsName(text: string, name: string): boolean {
  if (!name) return false;
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])@?${safe}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

export function priorityOf(ev: AgentEvent, characterName: string): number {
  if (ev.kind === "gift") return PRIORITY.gift;
  if (ev.kind === "follow") return PRIORITY.follow;
  if (ev.kind === "share") return PRIORITY.share;
  if (mentionsName(ev.text, characterName)) return PRIORITY.mention;
  if (ev.text.includes("?")) return PRIORITY.question;
  return PRIORITY.chatter;
}
