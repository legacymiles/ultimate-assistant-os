// ---------------------------------------------------------------------------
// What every brain is told, and how its answer is read back.
//
// Three brains can answer the Profiles chat — a thread on the owner's Jarvis
// harness (Claude or DeepSeek on their PC), the cloud model through the hub's
// AI provider, or the offline reader in offline.ts — and all three speak the
// same protocol: plain words for the owner, then at most one fenced
// `profiles-actions` JSON block for the page. The page never lets a brain
// write directly; it shows the proposed change set and waits for Save.
// ---------------------------------------------------------------------------

import { sanitizeChanges } from "./changes";
import { ROOT } from "./seed";
import { childrenOf, linksOf, pathTo } from "./tree";
import type { AgentActions, ProfilesData } from "./types";

export const FENCE = "profiles-actions";

/** The whole web as a compact outline: ids, names, rows. */
export function outline(data: ProfilesData): string {
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    for (const n of childrenOf(data, id)) {
      if (n.hidden) continue;
      const pad = "  ".repeat(depth);
      const aka = n.aliases?.length ? ` aka ${n.aliases.slice(0, 4).join("/")}` : "";
      lines.push(`${pad}#${n.id} "${n.name}" ${n.kind} · ${n.label}${n.sub ? ` · ${n.sub}` : ""}${aka}`);
      for (const s of n.sections) {
        const rows = s.items.map((i) => `@${i.id} ${i.k}=${i.v}${i.date ? ` (${i.date})` : ""}${i.secret ? " [private]" : ""}`).join(" | ");
        lines.push(`${pad}  [${s.title}] ${rows}`);
      }
      if (n.media.length) lines.push(`${pad}  [Photos] ${n.media.length}`);
      const links = linksOf(data, n.id);
      if (links.length) lines.push(`${pad}  [Linked here] ${links.map((l) => `#${l.id}`).join(" ")}`);
      walk(n.id, depth + 1);
    }
  };
  walk(ROOT, 0);
  if (data.memory.length) {
    lines.push("MEMORY");
    for (const m of data.memory) lines.push(`  about #${m.about}: ${m.k}=${m.v}`);
  }
  return lines.join("\n");
}

export function systemPrompt(data: ProfilesData, here: string, ownerName = ""): string {
  const at = pathTo(data, here)
    .filter((x) => x !== ROOT)
    .map((x) => data.nodes[x]?.name)
    .join(" › ");
  return [
    `You are Jarvis, the assistant inside the Profiles app of ${ownerName ? `${ownerName}'s` : "the owner's"} AI operating system.`,
    "Profiles is a web of folders: each person, business and job has a profile; profiles live inside other profiles; each holds sections of label=value rows, photos, and links to profiles that live elsewhere.",
    "The owner talks to you to FIND things and to TELL you new things. When they tell you something, you work out where it belongs and propose the changes. You never save anything yourself: the page shows your changes and the owner taps Save.",
    "",
    "RULES",
    "- Answer from the outline below only. Never invent a fact. If it is not there, say so in one sentence and offer to add it.",
    "- Lead with the answer itself (the value), then where it is. Keep replies short: one to three sentences.",
    "- Values marked [private] are codes and numbers; you may state them, the page hides them until tapped.",
    "- Do not use tools, read files or run commands. Everything you need is below.",
    "- Put new information where it belongs: a new person or place gets its own profile (add_node) inside the right parent; facts go in a section with a plain title (Contact, Important dates, Personal information, Settings, Notes…). Dates also get date: \"YYYY-MM-DD\".",
    "- If one thing they said belongs in two places (a conference that is the teacher's AND the son's date), add it to both.",
    "- When you propose changes, say what you WILL do (\"I'll add…\"), never that it is done: nothing is saved until the owner taps Save. Don't list sources for a change set.",
    "- After proposing changes, ask at most ONE follow-up question for what is still missing, with 2–3 short chips.",
    "- To move or reorganise, use move_node; to show a profile in a second place, link_node.",
    "",
    `The owner is looking at: ${at || "the Profiles home"} (#${here}).`,
    "",
    "OUTLINE (#id = profile, @id = row)",
    outline(data),
    "",
    "REPLY FORMAT",
    "Plain words first. Then, only if you have actions, ONE fenced block:",
    "```" + FENCE,
    '{"changes":[...], "sources":["@row-or-#profile ids your answer came from"], "open":"profile id to show", "media":"profile id whose photos to show", "chips":["short reply", "..."]}',
    "```",
    "Change ops (use ids exactly as written, without the # or @):",
    '{"op":"add_node","ref":"new:1","parent":"<id>","name":"…","kind":"person|thing","label":"Teacher","sub":"one line"}',
    '{"op":"add_item","node":"<id or new:1>","section":"Contact","k":"Email","v":"…","date":"YYYY-MM-DD?","secret":true?}',
    '{"op":"set_item","item":"<row id>","v":"new value"}',
    '{"op":"remove_item","item":"<row id>"}',
    '{"op":"move_node","node":"<id>","parent":"<id>"}',
    '{"op":"link_node","node":"<id>","into":"<id>"}',
    '{"op":"rename_node","node":"<id>","name":"…","sub":"…"}',
    '{"op":"archive_node","node":"<id>"}',
    '{"op":"remember","about":"<id>","k":"…","v":"…"}',
  ].join("\n");
}

/** Split a brain's reply into the words and the actions. Never throws. */
export function parseReply(raw: string): { text: string; actions: AgentActions } {
  const text = String(raw ?? "");
  const re = new RegExp("```\\s*" + FENCE + "\\s*([\\s\\S]*?)```", "i");
  const m = text.match(re) ?? text.match(/```(?:json)?\s*(\{[\s\S]*?"(?:changes|sources|open|media|chips)"[\s\S]*?\})\s*```/i);
  let actions: AgentActions = {};
  let words = text;
  if (m) {
    words = (text.slice(0, m.index) + text.slice((m.index ?? 0) + m[0].length)).trim();
    try {
      const j = JSON.parse(m[1].trim()) as Record<string, unknown>;
      const ids = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").map((s) => s.replace(/^[#@]/, "")).slice(0, 8) : []);
      const one = (x: unknown) => (typeof x === "string" && x ? x.replace(/^[#@]/, "") : undefined);
      actions = {
        changes: sanitizeChanges(j.changes),
        sources: ids(j.sources),
        open: one(j.open),
        media: one(j.media),
        chips: Array.isArray(j.chips) ? j.chips.filter((s): s is string => typeof s === "string" && s.length < 60).slice(0, 4) : [],
      };
    } catch {
      // A block that is not JSON is dropped; the words still stand.
    }
  }
  return { text: words.replace(/\n{3,}/g, "\n\n").trim(), actions };
}

/** Earlier turns, kept short, so a follow-up like "add a phone" has context. */
export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export function historyBlock(turns: Turn[]): string {
  const recent = turns.slice(-8);
  if (!recent.length) return "";
  return "EARLIER IN THIS CONVERSATION\n" + recent.map((t) => `${t.role === "user" ? "Owner" : "Jarvis"}: ${t.text.slice(0, 600)}`).join("\n");
}
