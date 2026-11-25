// ---------------------------------------------------------------------------
// Folders — retrieval for the Ask Jarvis agent (RAG).
//
// Three layers, cheapest first, all on the device:
//   1. Keyword + tag + extract scoring (search.ts), with light stemming so
//      "strategies" finds "strategy".
//   2. Folder scope: a question that names a folder ("summarise my AI
//      development folder", "what's in Trading › Gold") pulls that folder's
//      items AND every nested subfolder's, not just items whose words match.
//   3. The OUTLINE: one line per saved item — id, title, full folder path,
//      a short gist. This is the Profiles agent's approach (the whole tree in
//      the prompt), and it is what makes retrieval semantic: the model reads
//      the outline, recognises "my gold trading strategy" in an item titled
//      "XAU London-open breakout", and asks to READ it in a second pass.
//
// Credentials never enter any of the three.
// ---------------------------------------------------------------------------

import { folderPathString } from "./store";
import { search } from "./search";
import type { Folder, Item } from "./types";

/** Items a question may see. Logins never leave the device. */
export function shareable(items: Item[]): Item[] {
  return items.filter((i) => i.kind !== "credential");
}

/** "strategies" → "strategy", "notes" → "note", "trading" → "trad". Crude, on purpose. */
export function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.length > 5 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && /(ches|shes|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

const STOP = new Set(
  "the a an and or of in on to for my me i is are was were what where when how did do does find show tell about this that these those it its with from into inside folder folders saved save stored store previously write wrote information info notes note please summarize summarise".split(
    " ",
  ),
);

function words(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

/** Every folder id under (and including) the given one. */
export function descendantIds(folders: Folder[], rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * Folders the question names. A folder counts when every word of its name
 * (stemmed) appears in the question — so "AI development" matches "summarise
 * my AI development folder" but "AI" alone does not match "AI Rankings".
 */
export function foldersNamedIn(question: string, folders: Folder[]): Folder[] {
  const q = new Set(words(question).map(stem));
  if (!q.size) return [];
  return folders
    .filter((f) => {
      const name = words(f.name).map(stem);
      return name.length > 0 && name.every((w) => q.has(w));
    })
    // The most specific (longest) name first.
    .sort((a, b) => b.name.length - a.name.length);
}

/**
 * The shortlist whose full text goes to the model: keyword hits (with stemmed
 * variants of the question) merged with everything inside a folder the
 * question names, newest first within the folder.
 */
export function retrieveContext(question: string, data: { items: Item[]; folders: Folder[] }, limit = 8): Item[] {
  const safe = shareable(data.items);
  const stemmed = words(question).map(stem).join(" ");
  const seen = new Set<string>();
  const out: Item[] = [];
  const add = (it: Item) => {
    if (out.length < limit && !seen.has(it.id)) {
      seen.add(it.id);
      out.push(it);
    }
  };

  const named = foldersNamedIn(question, data.folders);
  const scoped = new Set<string>();
  for (const f of named.slice(0, 2)) for (const id of descendantIds(data.folders, f.id)) scoped.add(id);

  const ranked = [
    ...search(question, { items: safe, folders: data.folders }).items,
    ...(stemmed ? search(stemmed, { items: safe, folders: data.folders }).items : []),
  ].sort((a, b) => b.score - a.score);

  // Hits inside the named folder outrank hits elsewhere.
  if (scoped.size) {
    for (const s of ranked) if (s.item.folderId && scoped.has(s.item.folderId)) add(s.item);
    const inside = safe
      .filter((i) => i.folderId && scoped.has(i.folderId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const it of inside) add(it);
  }
  for (const s of ranked) add(s.item);
  if (!out.length) for (const it of [...safe].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) add(it);
  return out;
}

export interface OutlineEntry {
  id: string;
  title: string;
  path: string;
  kind: string;
  gist: string;
}

/**
 * One line per saved item, newest first, capped by characters so a big
 * library still fits. Items already in the shortlist are skipped (their full
 * text is sent anyway).
 */
export function buildOutline(
  data: { items: Item[]; folders: Folder[] },
  opts: { skip?: Set<string>; maxChars?: number } = {},
): { entries: OutlineEntry[]; omitted: number } {
  const maxChars = opts.maxChars ?? 40_000;
  const items = shareable(data.items)
    .filter((i) => !opts.skip?.has(i.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const entries: OutlineEntry[] = [];
  let used = 0;
  for (const it of items) {
    const e: OutlineEntry = {
      id: it.id,
      title: it.title.slice(0, 90),
      path: folderPathString(data.folders, it.folderId),
      kind: it.kind,
      // Who is in a filed photo comes from face matching against Profiles
      // (Camera Autopilot) — it makes "photos of my son" findable by meaning.
      gist: [it.people?.length ? `people: ${it.people.join(", ")}` : "", (it.summary || it.body || it.extract || "").replace(/\s+/g, " ").slice(0, 90)]
        .filter(Boolean)
        .join(" · "),
    };
    const cost = e.id.length + e.title.length + e.path.length + e.gist.length + 12;
    if (used + cost > maxChars) break;
    used += cost;
    entries.push(e);
  }
  return { entries, omitted: items.length - entries.length };
}

export interface DestinationStep {
  name: string;
  /** The folder this step lands on, when it already exists. */
  folderId: string | null;
  exists: boolean;
}

/**
 * Where a proposed path actually lands, step by step — the same
 * case-insensitive walk `ensureFolderPath` does, without creating anything.
 * The confirmation card shows which steps exist and which would be new.
 */
export function resolveDestination(path: string[], folders: Folder[]): DestinationStep[] {
  const steps: DestinationStep[] = [];
  let parentId: string | null = null;
  let missing = false;
  for (const raw of path) {
    const name = raw.trim();
    if (!name) continue;
    const hit: Folder | undefined = missing
      ? undefined
      : folders.find((f) => f.parentId === parentId && f.name.trim().toLowerCase() === name.toLowerCase());
    if (hit) {
      steps.push({ name: hit.name, folderId: hit.id, exists: true });
      parentId = hit.id;
    } else {
      missing = true;
      steps.push({ name, folderId: null, exists: false });
    }
  }
  return steps;
}

/** Every folder as a root-first path array, for the "save somewhere else" picker. */
export function allFolderPaths(folders: Folder[]): string[][] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (f: Folder): string[] => {
    const out: string[] = [];
    let cur: Folder | undefined = f;
    let guard = 0;
    while (cur && guard++ < 32) {
      out.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return out;
  };
  return folders.map(pathOf).sort((a, b) => a.join("/").localeCompare(b.join("/")));
}
