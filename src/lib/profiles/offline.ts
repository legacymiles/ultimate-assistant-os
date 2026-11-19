// ---------------------------------------------------------------------------
// The offline brain: answers without a PC, a key or a network.
//
// The hub must work in local demo mode (AGENTS.md §3), so when neither the
// harness nor the cloud model can answer, this reader does — with plain
// pattern matching over the same search the page uses. It speaks the same
// AgentReply protocol, so the page cannot tell the difference except by the
// small "offline" label under the message.
// ---------------------------------------------------------------------------

import type { Found } from "./found";
import { classifyIntake, intakeName, isNewProfileAsk, type IntakeGuide } from "./intake";
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

/** Where a new profile of this kind belongs, from what already exists. */
function homeFor(data: ProfilesData, guide: IntakeGuide, text: string, here: string): string {
  const byName = (re: RegExp) => Object.values(data.nodes).find((n) => !n.archived && n.id !== ROOT && re.test(`${n.name} ${(n.aliases ?? []).join(" ")}`))?.id;
  switch (guide.type) {
    case "teacher": {
      const school = byName(/\bschool\b/i);
      return school ?? (data.nodes[here]?.kind === "person" ? here : ROOT);
    }
    case "business":
      return byName(/\b(my businesses|businesses)\b/i) ?? ROOT;
    case "job":
      return byName(/\b(my jobs|jobs)\b/i) ?? ROOT;
    case "coworker":
    case "doctor":
      return here !== ROOT ? here : ROOT;
    case "parent":
    case "relative":
    case "friend":
      return data.nodes.me && !data.nodes.me.archived ? "me" : ROOT;
    default: {
      // "add X inside Y" names the parent outright.
      const inside = text.match(/\b(?:in|inside|under)\s+(.+)$/i);
      return (inside && resolveNode(data, inside[1], here)?.id) || ROOT;
    }
  }
}

function intake(data: ProfilesData, text: string, here: string, found: Found[]): AgentReply {
  const guide = classifyIntake(text);
  const name = intakeName(text.replace(/\b(?:in|inside|under)\s+.+$/i, ""));
  const parent = homeFor(data, guide, text, here);
  const changes: Change[] = [
    { op: "add_node", ref: "new:1", parent, name, kind: guide.kind, label: guide.label, icon: guide.icon },
  ];
  const facts = found.filter((f) => !f.src).slice(0, 4);
  for (const f of facts) changes.push({ op: "add_item", node: "new:1", section: "Found elsewhere", k: f.title.slice(0, 60), v: f.text.slice(0, 160), meta: `${f.source} · ${f.where}` });
  const photos = found.filter((f) => f.src).length;
  const where = parent === ROOT ? "your Profiles home" : whereLabel(data, parent, false);
  const seen = facts.length
    ? ` I searched your Memory and Folders and found ${facts.length} ${facts.length === 1 ? "thing" : "things"} that look related, so they're in the change set. Untick any that aren't.`
    : " I searched your Memory and Folders and didn't find anything about it yet.";
  const pics = photos ? ` There ${photos === 1 ? "is 1 photo" : `are ${photos} photos`} in Photos that may be ${guide.kind === "person" ? "them" : "it"}.` : "";
  return reply(`I'll make a ${guide.label.toLowerCase()} profile for ${name} in ${where}.${seen}${pics}\n\nOnce it's saved: ${guide.questions[0]}`, {
    changes,
    sources: found.slice(0, 3).map((f) => f.id),
    chips: guide.questions.slice(1, 3).map((q) => q.split(/[?—.]/)[0].slice(0, 48)),
  });
}

export function offlineBrain(data: ProfilesData, input: string, here: string, scope: "all" | "here" = "all", found: Found[] = []): AgentReply {
  const text = input.trim().replace(/\s+/g, " ");
  if (!text) return reply("Ask me anything about your profiles, or tell me something new to file.");

  // --- a new profile --------------------------------------------------------
  if (isNewProfileAsk(text)) return intake(data, text, here, found);

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
    if (found.length) {
      const f = found[0];
      return reply(`Not in your profiles, but your ${f.source} has it: ${f.title}. ${f.text}`, { sources: found.slice(0, 3).map((x) => x.id) });
    }
    return reply(`I couldn't find anything about "${text}" in your profiles, Memory or Folders. Tell me and I'll add it.`);
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
