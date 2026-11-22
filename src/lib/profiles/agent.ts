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
import { intakePromptBlock } from "./intake";
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
        const rows = s.items
          .map((i) => `@${i.id} ${i.k}=${i.noAi ? "[withheld — the owner can tap it]" : i.v}${i.date ? ` (${i.date})` : ""}${i.secret ? " [private]" : ""}`)
          .join(" | ");
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

/** What research turned up for this question, when it was a how-to rather than a lookup. */
export interface WebContext {
  /** The formatted FROM THE WEB block (see research.ts). */
  block?: string;
  /** Facts this machine's profile is missing that would change the answer. */
  gaps?: string[];
  /** The machine the question is about, by name. */
  subject?: string;
}

export function systemPrompt(data: ProfilesData, here: string, ownerName = "", found = "", web: WebContext = {}): string {
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
    "- FACTS ABOUT THE OWNER — names, numbers, dates, what they own, what they paid — come from the outline below ONLY. Never invent one. If it is not there, say so in one sentence and offer to add it.",
    "- GENERAL KNOWLEDGE is different, and allowed: how a machine works, what a setting does, what a piece of software needs, what a part is called. When a FROM THE WEB block appears below, answer from it and name the page you used. With no web block, you may give general guidance, but say plainly that you haven't checked it — and never state a specific setting, temperature, menu path or version number from memory. A confident wrong answer about the owner's equipment wastes their ink, film and money.",
    "- Lead with the answer itself (the value), then where it is. Keep replies short: one to three sentences.",
    "- Values marked [private] are codes and numbers; you may state them, the page hides them until tapped.",
    "- Do not read files or run commands. The web has already been searched for you where it was needed: the FROM THE WEB block below is the result, so never say you are unable to look things up.",
    "- Put new information where it belongs: a new person or place gets its own profile (add_node) inside the right parent; facts go in a section with a plain title (Contact, Important dates, Personal information, Settings, Notes…). Dates also get date: \"YYYY-MM-DD\".",
    "- If one thing they said belongs in two places (a conference that is the teacher's AND the son's date), add it to both.",
    "- When you propose changes, say what you WILL do (\"I'll add…\"), never that it is done: nothing is saved until the owner taps Save. Don't list sources for a change set.",
    "- After proposing changes, ask at most ONE follow-up question for what is still missing, with 2–3 short chips.",
    "- To move or reorganise, use move_node; to show a profile in a second place, link_node.",
    "- Values shown as [withheld] are never sent to you. Say where they are and that the owner can tap to see them; never guess them.",
    "- When something came from FOUND ELSEWHERE, say so (\"from your Memory\", \"in Folders › …\") and put its ~id in sources.",
    "- Cite every web page you used in \"links\": [{\"title\":\"…\",\"url\":\"…\"}]. Never put a web fact into a change unless the owner asks you to save it — researched knowledge is an answer, not a fact about their life.",
    ...(web.gaps?.length
      ? [
          "",
          "WHAT THIS PROFILE IS MISSING",
          `${web.subject ?? "This machine"}'s profile does not record: ${web.gaps.join("; ")}.`,
          "These change the answer to most how-to questions about it. Answer as far as you honestly can, then ask for the ONE or TWO that matter most for THIS question, saying in half a sentence why each one changes the answer. Offer them as chips. Do not recite the whole list, and do not refuse to answer because they are missing.",
        ]
      : []),
    "",
    intakePromptBlock(),
    "",
    `The owner is looking at: ${at || "the Profiles home"} (#${here}).`,
    "",
    "OUTLINE (#id = profile, @id = row)",
    outline(data),
    found ? `
${found}` : "",
    web.block ? `\n${web.block}` : "",
    "",
    "REPLY FORMAT",
    "Plain words first. Then, only if you have actions, ONE fenced block:",
    "```" + FENCE,
    '{"changes":[...], "sources":["@row-or-#profile ids your answer came from"], "links":[{"title":"page you used","url":"https://…"}], "open":"profile id to show", "media":"profile id whose photos to show", "chips":["short reply", "..."]}',
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
  const m = text.match(re) ?? text.match(/```(?:json)?\s*(\{[\s\S]*?"(?:changes|sources|links|open|media|chips)"[\s\S]*?\})\s*```/i);
  let actions: AgentActions = {};
  let words = text;
  if (m) {
    words = (text.slice(0, m.index) + text.slice((m.index ?? 0) + m[0].length)).trim();
    try {
      const j = JSON.parse(m[1].trim()) as Record<string, unknown>;
      const ids = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").map((s) => s.replace(/^[#@~]/, "")).slice(0, 8) : []);
      const one = (x: unknown) => (typeof x === "string" && x ? x.replace(/^[#@]/, "") : undefined);
      // Only http(s) links, titled, deduped — a brain that invents a "source"
      // like file:///… or javascript: must never reach an anchor tag.
      const links = Array.isArray(j.links)
        ? (j.links as unknown[])
            .flatMap((l) => {
              const o = l as { title?: unknown; url?: unknown };
              const url = typeof o?.url === "string" ? o.url.trim() : "";
              if (!/^https?:\/\/\S+$/i.test(url)) return [];
              const title = typeof o?.title === "string" && o.title.trim() ? o.title.trim().slice(0, 120) : url;
              return [{ title, url: url.slice(0, 500) }];
            })
            .filter((l, i, a) => a.findIndex((x) => x.url === l.url) === i)
            .slice(0, 6)
        : [];
      actions = {
        changes: sanitizeChanges(j.changes),
        sources: ids(j.sources),
        links,
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
