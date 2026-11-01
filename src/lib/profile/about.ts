// ---------------------------------------------------------------------------
// About Me — the derived briefing.
//
// This is the layer that makes a deep folder tree usable by a model: once the
// owner has 300 folders, nothing can read them per turn, so About Me is the
// context budget. One page, rebuilt from the tree, never hand-authored.
//
// The owner edits it in exactly two ways — PIN a line (always kept) or VETO one
// (never re-added). That is deliberately the whole editing model: a generated
// document you can freely overwrite is a document nobody trusts, and one you
// cannot correct is one nobody keeps.
//
// Every line carries the node ids it came from, which is what the provenance
// hover reads. A line with no sources is a line nobody can trace, and the UI
// marks it as such rather than hiding it.
// ---------------------------------------------------------------------------

import { birthdays, childrenOf, countFilled, nodeById, pathOf } from "./model";
import { isSecret } from "./redact";
import type { AboutDoc, Basics, Node, ProfileStore } from "./types";

/** One page. Past this, a model stops treating it as the briefing and starts skimming. */
export const ABOUT_MAX = 4_000;

export interface AboutLine {
  text: string;
  /** Node ids this line was derived from. */
  sources: string[];
}

/** Split a stored doc back into renderable lines with their sources attached. */
export function aboutLines(doc: AboutDoc): AboutLine[] {
  if (!doc.text.trim()) return [];
  return doc.text.split("\n").map((text, i) => ({ text, sources: doc.sources[String(i)] ?? [] }));
}

/**
 * Assemble a doc from lines, honouring pins and vetoes.
 *
 * Shared by both builders, so the AI path and the offline path cannot drift on
 * how pinning works.
 */
export function assembleAbout(lines: AboutLine[], fromCount: number, prev: AboutDoc): AboutDoc {
  const vetoed = new Set(prev.vetoed.map((v) => v.trim()));
  let kept = lines.filter((l) => !vetoed.has(l.text.trim()));

  // Re-insert any pinned line the rebuild dropped, under its own heading so it
  // is obvious the owner put it there.
  const missing = prev.pinned.filter((p) => !kept.some((l) => l.text.trim() === p.trim()));
  if (missing.length) {
    kept = [...kept, { text: "", sources: [] }, { text: "## Pinned by me", sources: [] }, ...missing.map((text) => ({ text, sources: [] }))];
  }

  let text = kept.map((l) => l.text).join("\n");
  if (text.length > ABOUT_MAX) text = `${text.slice(0, ABOUT_MAX).replace(/\n[^\n]*$/, "")}\n`;

  const sources: Record<string, string[]> = {};
  text.split("\n").forEach((line, i) => {
    const hit = kept.find((l) => l.text === line && l.sources.length);
    if (hit) sources[String(i)] = hit.sources;
  });

  return {
    text,
    builtAt: new Date().toISOString(),
    fromCount,
    sources,
    pinned: prev.pinned,
    vetoed: prev.vetoed,
  };
}

function firstValue(node: Node | null, re: RegExp): string {
  if (!node) return "";
  return node.fields.find((f) => re.test(f.label) && f.value.trim())?.value.trim() ?? "";
}

/** Nodes under a named root, deepest-filled first — "the job that actually has data". */
function filledUnder(nodes: Node[], rootName: string): Node[] {
  const root = nodes.find((n) => n.parentId === null && n.name.toLowerCase() === rootName.toLowerCase());
  if (!root) return [];
  const out: Node[] = [];
  const walk = (id: string) => {
    for (const c of childrenOf(nodes, id)) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(root.id);
  return out.filter((n) => countFilled(n) > 0).sort((a, b) => countFilled(b) - countFilled(a));
}

/**
 * The offline builder. Runs with no key set, and is also the shape the AI is
 * asked to improve on — so a missing key degrades to a plainer briefing rather
 * than an empty one.
 */
export function heuristicAbout(store: ProfileStore): AboutDoc {
  const { nodes, basics } = store;
  const L: AboutLine[] = [];
  const add = (text: string, sources: string[] = []) => L.push({ text, sources });

  add(`# About ${basics.name || "me"}`);
  add("");

  // Who I am — from basics, which is the one block that is never derived.
  const who: string[] = [];
  if (basics.birthday) who.push(`born ${basics.birthday}`);
  if (basics.pronouns) who.push(basics.pronouns);
  if (basics.location) who.push(`based in ${basics.location}`);
  if (who.length) add(`${basics.name || "The owner"} — ${who.join(", ")}.`);
  if (basics.headline) add(basics.headline);
  if (basics.email || basics.phone) add(`Reach me: ${[basics.email, basics.phone].filter(Boolean).join(" · ")}.`);

  // Right now — the current job, any business, where they live.
  const jobs = filledUnder(nodes, "Work").filter((n) => n.pack === "job");
  const current = jobs.find((n) => !firstValue(n, /^ended$/i)) ?? jobs[0] ?? null;
  const businesses = childrenOf(nodes, nodes.find((n) => n.parentId === null && n.name === "Business")?.id ?? null)
    .filter((n) => n.pack === "business" || countFilled(n) > 0);
  const property = filledUnder(nodes, "Home").find((n) => n.pack === "property") ?? null;

  if (current || businesses.length || property) {
    add("");
    add("## Right now");
    if (current) {
      const title = firstValue(current, /^title$/i);
      const employer = firstValue(current, /^employer$/i) || current.name;
      const sched = firstValue(current, /^schedule$/i);
      add(`Works as ${title || "staff"} at ${employer}${sched ? `, ${sched}` : ""}.`, [current.id]);
    }
    for (const b of businesses.slice(0, 3)) {
      const sells = firstValue(b, /what we sell/i);
      add(`Runs ${b.name}${sells ? ` — ${sells}` : ""}.`, [b.id]);
      const kit = childrenOf(nodes, childrenOf(nodes, b.id).find((c) => c.name === "Equipment")?.id ?? null);
      if (kit.length) add(`Equipment: ${kit.map((k) => k.name).join(", ")}.`, kit.map((k) => k.id));
      const clients = childrenOf(nodes, childrenOf(nodes, b.id).find((c) => c.name === "Clients")?.id ?? null);
      if (clients.length) add(`${clients.length} client${clients.length === 1 ? "" : "s"} on file.`, clients.map((c) => c.id));
    }
    if (property) {
      const own = firstValue(property, /own or rent/i);
      add(`${own === "rent" ? "Rents" : own === "own" ? "Owns" : "Lives at"} ${firstValue(property, /^address$/i) || property.name}.`, [property.id]);
    }
  }

  // Hard constraints — the lines that must never be got wrong.
  const health = nodes.find((n) => n.pack === "health" && countFilled(n) > 0) ?? null;
  const allergies = firstValue(health, /allerg/i);
  const meds = firstValue(health, /medication/i);
  if (allergies || meds) {
    add("");
    add("## Hard constraints");
    if (allergies) add(`Allergies: ${allergies}.`, health ? [health.id] : []);
    if (meds) add(`Medications: ${meds}.`, health ? [health.id] : []);
  }

  // How to talk to me — the video's voice.md, the one file Jarvis had no equivalent of.
  const voice = nodes.find((n) => n.pack === "voice" && countFilled(n) > 0) ?? null;
  if (voice) {
    add("");
    add("## How to talk to me");
    const core = firstValue(voice, /core instruction/i);
    const never = firstValue(voice, /never say/i);
    const tone = firstValue(voice, /tone patterns/i);
    if (core) add(core, [voice.id]);
    if (never) add(`Never say: ${never}.`, [voice.id]);
    if (tone) add(tone, [voice.id]);
  }

  // People — the owner's "all friends birthdays", straight off the tree.
  const soon = birthdays(nodes).slice(0, 6);
  if (soon.length) {
    add("");
    add("## People");
    add(
      `Birthdays next up: ${soon.map((b) => `${b.name} (${b.inDays === 0 ? "today" : `${b.inDays}d`})`).join(", ")}.`,
      soon.map((b) => b.nodeId),
    );
  }

  // Money shape — totals only. No account numbers, ever.
  const bills = filledUnder(nodes, "Money").filter((n) => n.pack === "bill");
  if (bills.length) {
    const monthly = bills.reduce((sum, b) => {
      const amount = Number(firstValue(b, /^amount$/i).replace(/[^0-9.]/g, ""));
      const often = firstValue(b, /how often/i).toLowerCase();
      if (!amount) return sum;
      return sum + (often.includes("year") ? amount / 12 : amount);
    }, 0);
    add("");
    add("## Money");
    add(
      `${bills.length} recurring bill${bills.length === 1 ? "" : "s"} on file${monthly ? `, roughly ${Math.round(monthly)} a month` : ""}.`,
      bills.map((b) => b.id),
    );
  }

  // Say out loud what the model must NOT expect to find here.
  const vault = nodes.flatMap((n) => n.fields.filter((f) => isSecret(f.label, f.kind) && f.value.trim()));
  if (vault.length) {
    add("");
    add(`_${vault.length} credential${vault.length === 1 ? "" : "s"} are held in the vault and are not in this briefing._`);
  }

  return assembleAbout(L, nodes.filter((n) => countFilled(n) > 0).length, store.about);
}

/**
 * Turn the extractor's cited lines into a doc.
 *
 * The model is handed node ids and asked to cite them, so provenance is real
 * rather than guessed. Ids it invents are dropped here — a citation that does
 * not resolve is worse than none, because the hover would light nothing.
 */
export function aboutFromCited(
  cited: { text: string; sources?: string[] }[],
  store: ProfileStore,
): AboutDoc {
  const lines: AboutLine[] = cited.map((c) => ({
    text: String(c.text ?? ""),
    sources: (c.sources ?? []).filter((id) => nodeById(store.nodes, id)),
  }));
  return assembleAbout(lines, store.nodes.filter((n) => countFilled(n) > 0).length, store.about);
}

/** Human label for a provenance chip. */
export function sourceLabel(nodes: Node[], id: string): string {
  return pathOf(nodes, id) || "(removed)";
}
