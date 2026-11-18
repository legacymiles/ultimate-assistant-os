// ---------------------------------------------------------------------------
// Reading the web of profiles: paths, colours, what's next, and search.
//
// Pure functions over ProfilesData so the page, the offline brain and the
// tests all read the tree the same way.
// ---------------------------------------------------------------------------

import { ROOT } from "./seed";
import type { Item, Media, MemoryNote, ProfileNode, ProfilesData, Section } from "./types";

export const TODAY_ISO = (): string => new Date().toISOString().slice(0, 10);

export function live(data: ProfilesData, id: string): ProfileNode | undefined {
  const n = data.nodes[id];
  return n && !n.archived ? n : undefined;
}

/** The home parent: the node whose `children` lists this one. */
export function parentOf(data: ProfilesData, id: string): string | null {
  for (const n of Object.values(data.nodes)) if (n.children.includes(id)) return n.id;
  return null;
}

/** Root first, `id` last. Stops on a cycle rather than looping. */
export function pathTo(data: ProfilesData, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.unshift(cur);
    cur = parentOf(data, cur);
  }
  return out;
}

export function childrenOf(data: ProfilesData, id: string): ProfileNode[] {
  const n = data.nodes[id];
  if (!n) return [];
  return n.children.map((c) => live(data, c)).filter((x): x is ProfileNode => Boolean(x));
}

export function linksOf(data: ProfilesData, id: string): ProfileNode[] {
  const n = data.nodes[id];
  if (!n) return [];
  return n.links.map((c) => live(data, c)).filter((x): x is ProfileNode => Boolean(x));
}

/** Every live node below `id`, depth first. */
export function descendants(data: ProfilesData, id: string): ProfileNode[] {
  const out: ProfileNode[] = [];
  const seen = new Set<string>([id]);
  const walk = (at: string) => {
    for (const c of childrenOf(data, at)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

export function isInside(data: ProfilesData, id: string, ancestor: string): boolean {
  return pathTo(data, id).includes(ancestor);
}

/** The colour of the world this node is in. */
export function hueOf(data: ProfilesData, id: string): number {
  const p = pathTo(data, id);
  for (let i = p.length - 1; i >= 0; i--) {
    const h = data.nodes[p[i]]?.hue;
    if (typeof h === "number") return h;
  }
  return 208;
}

/** "MY SON › SCHOOL" — the path under root, in source-label case. */
export function whereLabel(data: ProfilesData, id: string, upper = true): string {
  const names = pathTo(data, id)
    .filter((x) => x !== ROOT)
    .map((x) => data.nodes[x]?.name ?? x);
  const s = names.join(" › ");
  return upper ? s.toUpperCase() : s;
}

export function findItem(data: ProfilesData, itemId: string): { node: ProfileNode; section: Section; item: Item } | null {
  for (const node of Object.values(data.nodes)) {
    for (const section of node.sections) {
      const item = section.items.find((i) => i.id === itemId);
      if (item) return { node, section, item };
    }
  }
  return null;
}

export function mediaUnder(data: ProfilesData, id: string): (Media & { from: string })[] {
  const own = (live(data, id)?.media ?? []).map((m) => ({ ...m, from: id }));
  const below = descendants(data, id).flatMap((n) => n.media.map((m) => ({ ...m, from: n.id })));
  return [...own, ...below];
}

/** The soonest dated row on or after today, in this node or anything inside it. */
export function nextDate(data: ProfilesData, id: string, today = TODAY_ISO()): { item: Item; node: ProfileNode } | null {
  const nodes = [live(data, id), ...descendants(data, id)].filter((x): x is ProfileNode => Boolean(x));
  let best: { item: Item; node: ProfileNode } | null = null;
  for (const node of nodes)
    for (const s of node.sections)
      for (const item of s.items)
        if (item.date && item.date >= today && (!best || item.date < best.item.date!)) best = { item, node };
  return best;
}

/** "Dec 4" */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "in 16 days", "tomorrow", "today" */
export function fromNow(iso: string, today = TODAY_ISO()): string {
  const a = new Date(`${today}T12:00:00`).getTime();
  const b = new Date(`${iso}T12:00:00`).getTime();
  const days = Math.round((b - a) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 0) return days === -1 ? "yesterday" : `${-days} days ago`;
  if (days < 14) return `in ${days} days`;
  if (days < 70) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

// --- search ----------------------------------------------------------------

const STOP = new Set(
  ("a an the and or of to in on at for from with my me i im is are was do does did what whats where when how which who " +
    "show find get tell give please jarvis can you could your his her their our that this those these it its about use used " +
    "using need any there again next").split(" "),
);

const SYNONYMS: string[][] = [
  ["email", "e-mail", "mail", "emails", "gmail", "inbox"],
  ["vendor", "supplier", "supply", "supplies", "wholesale", "wholesaler"],
  ["print", "printing", "shirt", "tshirt", "t-shirt", "tee"],
  ["code", "pin", "passcode", "combo", "keypad"],
  ["job", "work", "shift", "employer", "station", "shell"],
  ["son", "leo", "kid", "boy"],
  ["girlfriend", "gf", "maya", "partner"],
  ["photo", "picture", "pic", "image", "video", "media"],
  ["teacher", "alvarez"],
  ["birthday", "bday", "born"],
  ["phone", "number", "cell", "call", "tel"],
  ["dentist", "dental"],
  ["gas", "fuel"],
  ["wifi", "wi-fi", "internet", "password"],
  ["purchase", "buy", "bought", "spent", "spend"],
  ["press", "heatpress"],
  ["doctor", "pediatrician", "clinic"],
];
const CANON = new Map<string, string>();
for (const g of SYNONYMS) for (const w of g) CANON.set(w, g[0]);

export function canon(word: string): string {
  let w = word.toLowerCase().replace(/[’']s$/, "").replace(/[^a-z0-9-]/g, "");
  if (CANON.has(w)) return CANON.get(w)!;
  if (w.length > 3 && w.endsWith("es") && CANON.has(w.slice(0, -2))) return CANON.get(w.slice(0, -2))!;
  if (w.length > 3 && w.endsWith("s")) w = w.slice(0, -1);
  return CANON.get(w) ?? w;
}

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .split(/[^a-z0-9@.\-]+/)
    .map((w) => w.replace(/^[.\-]+|[.\-]+$/g, ""))
    .filter((w) => w && !STOP.has(w))
    .map(canon);
}

export type Hit =
  | { type: "item"; score: number; node: ProfileNode; section: Section; item: Item }
  | { type: "node"; score: number; node: ProfileNode }
  | { type: "memory"; score: number; node: ProfileNode; note: MemoryNote };

interface Field {
  t: Set<string>;
  w: number;
}

function field(text: string, w: number): Field {
  return { t: new Set(tokens(text)), w };
}

function score(q: string[], fields: Field[]): number {
  let total = 0;
  let matched = 0;
  for (const tok of q) {
    let best = 0;
    for (const f of fields) if (f.t.has(tok) && f.w > best) best = f.w;
    if (best) matched++;
    total += best;
  }
  if (!matched) return 0;
  return total + (matched / q.length) * 2;
}

/**
 * Everything Jarvis can see, ranked against a question. `within` narrows it to
 * one profile and what is inside it. Hidden profiles are never searched.
 */
export function search(data: ProfilesData, query: string, within?: string): Hit[] {
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const pool = within ? [live(data, within), ...descendants(data, within)] : Object.values(data.nodes).filter((n) => !n.archived);
  const nodes = pool.filter((n): n is ProfileNode => Boolean(n) && n!.id !== ROOT && !n!.hidden && !isHiddenByAncestor(data, n!.id));
  const hits: Hit[] = [];
  for (const node of nodes) {
    const ancestry = pathTo(data, node.id)
      .slice(1, -1)
      .map((x) => `${data.nodes[x]?.name ?? ""} ${(data.nodes[x]?.aliases ?? []).join(" ")}`)
      .join(" ");
    const self = field(`${node.name} ${(node.aliases ?? []).join(" ")}`, 2);
    const up = field(ancestry, 1.2);
    const sub = field(node.sub, 1);
    const ns = score(q, [field(`${node.name} ${(node.aliases ?? []).join(" ")} ${node.label}`, 3.5), sub, up]);
    if (ns) hits.push({ type: "node", score: ns, node });
    for (const section of node.sections)
      for (const item of section.items) {
        const s = score(q, [field(item.k, 3), field(section.title, 2), field(`${item.v} ${item.meta ?? ""}`, 1.5), self, up]);
        if (s) hits.push({ type: "item", score: s, node, section, item });
      }
  }
  for (const note of data.memory) {
    const node = live(data, note.about);
    if (!node || node.hidden || (within && !isInside(data, node.id, within))) continue;
    const s = score(q, [field(note.k, 3), field(note.v, 1.5), field(`${node.name} ${(node.aliases ?? []).join(" ")}`, 2)]);
    if (s) hits.push({ type: "memory", score: s, node, note });
  }
  return hits.sort((a, b) => b.score - a.score);
}

function isHiddenByAncestor(data: ProfilesData, id: string): boolean {
  return pathTo(data, id).some((x) => data.nodes[x]?.hidden);
}

/** Best node for a phrase like "his school folder" or "my son's teacher". */
export function resolveNode(data: ProfilesData, phrase: string, near?: string): ProfileNode | null {
  const q = tokens(phrase.replace(/\b(profile|folder|page|section)s?\b/gi, " "));
  if (!q.length) return null;
  let best: { node: ProfileNode; s: number } | null = null;
  for (const node of Object.values(data.nodes)) {
    if (node.archived || node.id === ROOT || node.hidden) continue;
    const ancestry = pathTo(data, node.id)
      .slice(1, -1)
      .map((x) => `${data.nodes[x]?.name ?? ""} ${(data.nodes[x]?.aliases ?? []).join(" ")}`)
      .join(" ");
    let s = score(q, [field(`${node.name} ${(node.aliases ?? []).join(" ")} ${node.label}`, 3), field(node.sub, 0.8), field(ancestry, 1)]);
    if (s && near) {
      const top = pathTo(data, near)[1];
      if (top && pathTo(data, node.id)[1] === top) s += 0.5;
    }
    if (s && (!best || s > best.s)) best = { node, s };
  }
  return best && best.s >= 3 ? best.node : null;
}
