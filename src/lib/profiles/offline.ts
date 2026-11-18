// ---------------------------------------------------------------------------
// The offline brain: answers without a PC, a key or a network.
//
// The hub must work in local demo mode (AGENTS.md §3), so when neither the
// harness nor the cloud model can answer, this reader does — with plain
// pattern matching over the same search the page uses. It speaks the same
// AgentReply protocol, so the page cannot tell the difference except by the
// small "offline" label under the message.
// ---------------------------------------------------------------------------

import { ROOT } from "./seed";
import { findItem, mediaUnder, resolveNode, search, tokens, whereLabel, type Hit } from "./tree";
import type { AgentReply, Change, ProfilesData } from "./types";

const MEDIA = /\b(photo|photos|picture|pictures|pic|pics|image|images|video|videos)\b/i;

function reply(text: string, actions: AgentReply["actions"] = {}): AgentReply {
  return { text, actions, by: "offline" };
}

function hitId(h: Hit): string {
  return h.type === "item" ? h.item.id : h.type === "memory" ? h.node.id : h.node.id;
}

export function offlineBrain(data: ProfilesData, input: string, here: string, scope: "all" | "here" = "all"): AgentReply {
  const text = input.trim().replace(/\s+/g, " ");
  if (!text) return reply("Ask me anything about your profiles, or tell me something new to file.");

  // --- move ---------------------------------------------------------------
  const move = text.match(/^(?:please\s+)?(?:move|put|file|place)\s+(.+?)\s+(?:into|in|to|under|inside)\s+(.+?)[.?!]*$/i);
  if (move) {
    const src = resolveNode(data, move[1], here);
    const dst = src ? resolveNode(data, move[2], src.id) : null;
    if (!src || !dst) return reply(`I couldn't tell ${!src ? "what to move" : "where to put it"}. Try the names as they appear on the cards.`);
    const change: Change = { op: "move_node", node: src.id, parent: dst.id };
    return reply(`I'll move ${src.name} into ${whereLabel(data, dst.id, false)}.`, { changes: [change], open: dst.id });
  }

  // --- photos -------------------------------------------------------------
  if (MEDIA.test(text) && /\b(show|see|find|pull up|open|any)\b/i.test(text)) {
    const phrase = text.replace(MEDIA, " ").replace(/\b(show|see|find|pull up|open|me|of|any|my|the)\b/gi, " ");
    const n = resolveNode(data, phrase, here) ?? data.nodes[here];
    if (!n || n.id === ROOT) return reply("Whose photos? Name a profile and I'll pull them up.");
    const all = mediaUnder(data, n.id);
    if (!all.length) return reply(`There are no photos in ${n.name} yet. Drop some into this chat and I'll file them there.`);
    const vids = all.filter((m) => m.kind === "video").length;
    return reply(`${all.length - vids} photos${vids ? ` and ${vids} ${vids === 1 ? "video" : "videos"}` : ""} in ${n.name}.`, { media: n.id });
  }

  // --- remember / add ------------------------------------------------------
  const tell = text.match(/^(?:remember|note|add|save|log)\s+(?:that\s+)?(.+?)[.!]*$/i);
  if (tell) {
    const body = tell[1];
    const into = body.match(/^(.+?)\s+(?:to|in|under|for)\s+(.+)$/i);
    const is = body.match(/^(.+?)\s+(?:is|are|=)\s+(.+)$/i);
    if (is) {
      // "Leo's shoe size is 3Y" → who = Leo, label = shoe size.
      const left = is[1];
      const who = resolveNode(data, left, here) ?? data.nodes[here];
      if (!who || who.id === ROOT) return reply("Who is that about? Name the profile and I'll file it.");
      const label = left
        .replace(new RegExp(`\\b(${[who.name, ...(who.aliases ?? [])].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(['’]s)?\\b`, "gi"), " ")
        .replace(/\b(my|his|her|their|the)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      const k = label ? label[0].toUpperCase() + label.slice(1) : "Note";
      const existing = who.sections.flatMap((s) => s.items).find((i) => i.k.toLowerCase() === k.toLowerCase());
      if (existing)
        return reply(`${who.name}'s ${k.toLowerCase()} is ${existing.v} right now. Change it to ${is[2]}?`, { changes: [{ op: "set_item", item: existing.id, v: is[2] }] });
      const section = who.sections[0]?.title ?? (who.kind === "person" ? "Personal information" : "Notes");
      return reply(`I'll add that to ${who.name}.`, { changes: [{ op: "add_item", node: who.id, section, k, v: is[2] }] });
    }
    if (into) {
      const target = resolveNode(data, into[2], here);
      if (target) return reply(`I'll add a note to ${target.name}.`, { changes: [{ op: "add_item", node: target.id, section: "Notes", k: "Note", v: into[1] }] });
    }
    const target = data.nodes[here]?.id !== ROOT ? data.nodes[here] : null;
    if (target) return reply(`I'll add that as a note in ${target.name}.`, { changes: [{ op: "add_item", node: target.id, section: "Notes", k: "Note", v: body }] });
    return reply("Which profile should that go in? Open it first, or name it.");
  }

  // --- change -------------------------------------------------------------
  const change = text.match(/^(?:change|update|set|edit)\s+(?:the\s+|my\s+)?(.+?)\s+to\s+(.+?)[.!]*$/i);
  if (change) {
    const hit = search(data, change[1], scope === "here" ? here : undefined).find((h) => h.type === "item");
    if (!hit || hit.type !== "item") return reply(`I couldn't find "${change[1]}" to change.`);
    return reply(`Change ${hit.item.k} at ${hit.node.name}?`, { changes: [{ op: "set_item", item: hit.item.id, v: change[2] }], sources: [hit.item.id] });
  }

  // --- go ----------------------------------------------------------------
  const go = text.match(/^(?:open|go to|goto|take me to|jump to)\s+(.+?)[.!]*$/i);
  if (go) {
    const n = resolveNode(data, go[1], here);
    if (n) return reply(`Opening ${n.name}.`, { open: n.id });
  }

  // --- a statement with no verb we know: offer to file it ----------------------
  const isQuestion = /\?$/.test(text) || /^(what|when|where|who|which|how|is|are|do|does|did|can|show)\b/i.test(text);

  // --- search -------------------------------------------------------------
  const hits = search(data, text, scope === "here" ? here : undefined);
  const top = hits[0];
  if (!top || top.score < 3 || (!isQuestion && tokens(text).length > 6)) {
    if (!isQuestion && data.nodes[here] && here !== ROOT) {
      return reply(`Want me to file that in ${data.nodes[here].name}?`, {
        changes: [{ op: "add_item", node: here, section: "Notes", k: "Note", v: text }],
      });
    }
    return reply(`I couldn't find anything about "${text}" in your profiles. Tell me and I'll add it.`);
  }
  const related = hits.filter((h, i) => i > 0 && h.score >= top.score * 0.55).slice(0, 3);
  const sources = [top, ...related].map(hitId);
  if (top.type === "item") {
    if (top.item.secret && data.settings.mask)
      return reply(`Your ${top.item.k.toLowerCase()} is in ${top.node.name} › ${top.section.title}. Tap it to show.`, { sources });
    return reply(`${top.item.v}
That's “${top.item.k}” in ${top.node.name} › ${top.section.title}.`, { sources });
  }
  if (top.type === "memory") return reply(`${top.note.v}. That's from Memory, about ${top.node.name}.`, { sources });
  return reply(`Here's ${top.node.name}.`, { sources, open: top.node.id });
}

/** For the answer card: the row a source id points at, or null. */
export function sourceRow(data: ProfilesData, id: string) {
  return findItem(data, id);
}
