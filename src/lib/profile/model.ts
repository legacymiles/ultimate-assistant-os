// ---------------------------------------------------------------------------
// Profile — store, tree helpers, search, and the draft → tree writer.
//
// Everything here is pure and synchronous so it can be unit-tested without a
// browser: the UI holds one `ProfileStore` in state and replaces it wholesale,
// the same shape Recall and the Four-Cs dashboard already use with
// `loadLocal` / `saveSynced`.
// ---------------------------------------------------------------------------

import { PACK_BY_ID, ROOT_TREE, packOf } from "./packs";
import type {
  AboutDoc, Basics, ConfirmItem, Draft, Field, FieldKind, IconName, Node, ProfileStore, Source, WriteMark,
} from "./types";

/** Shared with the Four-Cs dashboard's key naming so sync treats it as one app. */
export const STORE_KEY = "jarvis-profile-v1";

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function today(): string {
  return new Date().toISOString();
}

export function emptyBasics(): Basics {
  return { name: "", birthday: "", pronouns: "", email: "", phone: "", location: "", headline: "" };
}

export function emptyAbout(): AboutDoc {
  return { text: "", builtAt: "", fromCount: 0, sources: {}, pinned: [], vetoed: [] };
}

export function emptyStore(): ProfileStore {
  return {
    version: 1,
    avatar: "",
    basics: emptyBasics(),
    nodes: [],
    about: emptyAbout(),
    queue: [],
    writes: [],
    onboarded: false,
  };
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export function newField(label: string, kind: FieldKind = "text", value = "", source: Source = "you"): Field {
  return {
    id: uid(),
    label,
    kind,
    value,
    source,
    // Anything the owner typed is true by definition; an AI draft has to be agreed to.
    confirmed: source !== "ai",
    updatedAt: today(),
  };
}

export function newNode(
  name: string,
  parentId: string | null,
  pack = "",
  icon: IconName = "Folder",
): Node {
  const p = packOf(pack);
  return {
    id: uid(),
    parentId,
    name,
    pack,
    icon: p?.icon ?? icon,
    // A pack's fields arrive empty rather than absent: an empty "Door code" row
    // is the prompt that gets it filled, which a missing row never is.
    fields: (p?.fields ?? []).map((f) => newField(f.label, f.kind, "", "you")),
    notes: "",
    createdAt: today(),
    updatedAt: today(),
  };
}

/** Create a node AND the children its pack declares, returning all of them. */
export function spawn(name: string, parentId: string | null, pack = "", icon: IconName = "Folder"): Node[] {
  const node = newNode(name, parentId, pack, icon);
  const kids = (packOf(pack)?.children ?? []).flatMap((c) => spawn(c.name, node.id, c.pack ?? "", c.icon ?? "Folder"));
  return [node, ...kids];
}

/** The seven root tiles and their obvious children. Run once, on first open. */
export function seedNodes(): Node[] {
  const out: Node[] = [];
  for (const root of ROOT_TREE) {
    const r = newNode(root.name, null, "", root.icon);
    r.pinned = true;
    out.push(r);
    for (const child of root.children) {
      out.push(...spawn(child.name, r.id, child.pack ?? "", child.icon ?? "Folder"));
    }
  }
  return out;
}

export function roots(nodes: Node[]): Node[] {
  return nodes.filter((n) => n.parentId === null);
}

export function childrenOf(nodes: Node[], id: string | null): Node[] {
  return nodes.filter((n) => n.parentId === id).sort((a, b) => a.name.localeCompare(b.name));
}

export function nodeById(nodes: Node[], id: string): Node | null {
  return nodes.find((n) => n.id === id) ?? null;
}

/** Root-first chain of nodes down to `id`, used for breadcrumbs and column state. */
export function chainTo(nodes: Node[], id: string | null): Node[] {
  const out: Node[] = [];
  let cur = id ? nodeById(nodes, id) : null;
  // `seen` stops a corrupted parent pointer (a cycle) hanging the render.
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parentId ? nodeById(nodes, cur.parentId) : null;
  }
  return out;
}

/** "Work › Acme › Pay stubs" */
export function pathOf(nodes: Node[], id: string, sep = " › "): string {
  return chainTo(nodes, id).map((n) => n.name).join(sep);
}

/** Every descendant of `id`, so deleting a folder takes its contents with it. */
export function descendants(nodes: Node[], id: string): string[] {
  const out: string[] = [];
  const walk = (parent: string) => {
    for (const n of nodes) {
      if (n.parentId === parent) {
        out.push(n.id);
        walk(n.id);
      }
    }
  };
  walk(id);
  return out;
}

export function removeNode(nodes: Node[], id: string): Node[] {
  const gone = new Set([id, ...descendants(nodes, id)]);
  return nodes.filter((n) => !gone.has(n.id));
}

export function countFilled(node: Node): number {
  return node.fields.filter((f) => f.value.trim()).length;
}

// ---------------------------------------------------------------------------
// Drafts → tree
// ---------------------------------------------------------------------------

/** Find a child by name, case-insensitively, so "work" matches the seeded "Work". */
function childNamed(nodes: Node[], parentId: string | null, name: string): Node | null {
  const want = name.trim().toLowerCase();
  return nodes.find((n) => n.parentId === parentId && n.name.trim().toLowerCase() === want) ?? null;
}

/**
 * Walk/create a path of names, returning the final node id and every node that
 * had to be created. Missing parents are created as plain folders — the pack
 * only ever applies to the LAST segment, because "Work" is a folder and "Acme"
 * is the job.
 */
export function ensurePath(nodes: Node[], path: string[], pack: string): { nodes: Node[]; id: string } {
  let list = nodes;
  let parentId: string | null = null;
  let id = "";
  path.forEach((name, i) => {
    const last = i === path.length - 1;
    const found = childNamed(list, parentId, name);
    if (found) {
      // A path that already exists but has no pack adopts the one the draft
      // names, so a seeded empty "Current Job" becomes a typed job rather than
      // a second folder beside it.
      if (last && pack && !found.pack) {
        const p = packOf(pack);
        const add = (p?.fields ?? [])
          .filter((f) => !found.fields.some((e) => e.label.toLowerCase() === f.label.toLowerCase()))
          .map((f) => newField(f.label, f.kind, "", "you"));
        list = list.map((n) => (n.id === found.id ? { ...n, pack, icon: p?.icon ?? n.icon, fields: [...n.fields, ...add] } : n));
      }
      parentId = found.id;
      id = found.id;
      return;
    }
    const made = spawn(name, parentId, last ? pack : "", "Folder");
    list = [...list, ...made];
    parentId = made[0].id;
    id = made[0].id;
  });
  return { nodes: list, id };
}

/**
 * Write drafts into the tree. Every value lands `source: "ai"` and therefore
 * unconfirmed, which is what makes the owner's first run a review rather than a
 * typing session. Returns the write marks so each one can be undone.
 */
export function applyDrafts(store: ProfileStore, drafts: Draft[]): { store: ProfileStore; marks: WriteMark[] } {
  let nodes = store.nodes;
  const marks: WriteMark[] = [];

  for (const draft of drafts) {
    if (!draft.path?.length) continue;
    const walked = ensurePath(nodes, draft.path, draft.pack ?? "");
    nodes = walked.nodes;
    const target = nodeById(nodes, walked.id);
    if (!target) continue;

    let fields = target.fields;
    for (const f of draft.fields ?? []) {
      if (!f.label?.trim()) continue;
      const src: Source = f.source ?? "ai";
      const existing = fields.find((e) => e.label.toLowerCase() === f.label.trim().toLowerCase());
      const value = (f.value ?? "").trim();
      if (!value) continue;

      if (existing) {
        if (existing.value.trim() === value) continue;
        marks.push({
          id: uid(),
          at: today(),
          where: `${pathOf(nodes, target.id)} · ${existing.label}`,
          nodeId: target.id,
          fieldId: existing.id,
          before: existing.value,
        });
        fields = fields.map((e) =>
          e.id === existing.id
            ? { ...e, value, source: src, confirmed: src !== "ai", updatedAt: today() }
            : e,
        );
      } else {
        const made = newField(f.label.trim(), f.kind ?? "text", value, src);
        marks.push({
          id: uid(),
          at: today(),
          where: `${pathOf(nodes, target.id)} · ${made.label}`,
          nodeId: target.id,
          fieldId: made.id,
          before: "",
          created: true,
        });
        fields = [...fields, made];
      }
    }

    const notes = draft.notes?.trim() ? [target.notes, draft.notes.trim()].filter(Boolean).join("\n\n") : target.notes;
    nodes = nodes.map((n) => (n.id === target.id ? { ...n, fields, notes, updatedAt: today() } : n));
  }

  return { store: { ...store, nodes, writes: [...marks, ...store.writes].slice(0, 50) }, marks };
}

/** Put a field back the way it was before an AI write. */
export function undoWrite(store: ProfileStore, markId: string): ProfileStore {
  const mark = store.writes.find((w) => w.id === markId);
  if (!mark) return store;
  const nodes = store.nodes.map((n) => {
    if (n.id !== mark.nodeId) return n;
    const fields = mark.created
      ? n.fields.filter((f) => f.id !== mark.fieldId)
      : n.fields.map((f) => (f.id === mark.fieldId ? { ...f, value: mark.before, source: "you" as Source, confirmed: true } : f));
    return { ...n, fields, updatedAt: today() };
  });
  return {
    ...store,
    nodes,
    writes: store.writes.filter((w) => w.id !== markId),
    queue: store.queue.filter((q) => q.fieldId !== mark.fieldId),
  };
}

// ---------------------------------------------------------------------------
// The confirm queue
// ---------------------------------------------------------------------------

/** Fields whose label says they carry a date that can lapse. */
const LAPSES = /(expires|expiry|renews|renewal|registration due|warranty until|respond by|lease until)/i;

/**
 * Derive the queue from the tree rather than storing it, so it can never drift
 * out of date: an unconfirmed field that gets confirmed simply stops appearing.
 *
 * `conflict` items are the video's A$950-vs-A$1,200 moment — the same labelled
 * fact holding two different values in two places, which a life profile
 * produces constantly (an old address, a replaced card, a job you left).
 */
export function buildQueue(nodes: Node[], now = new Date()): ConfirmItem[] {
  const out: ConfirmItem[] = [];

  // Conflicts: one label, two live values, across different nodes.
  const byLabel = new Map<string, { node: Node; field: Field }[]>();
  for (const n of nodes) {
    for (const f of n.fields) {
      if (f.kind === "secret" || !f.value.trim()) continue;
      const key = f.label.trim().toLowerCase();
      byLabel.set(key, [...(byLabel.get(key) ?? []), { node: n, field: f }]);
    }
  }
  for (const [label, hits] of byLabel) {
    const values = [...new Set(hits.map((h) => h.field.value.trim()))];
    // Only ask about labels where one answer is the point. Two jobs legitimately
    // have two employers; one person does not have two birthdays.
    const singular = /(birthday|address|phone|email|blood type|tax number)/i.test(label);
    if (values.length > 1 && singular) {
      out.push({
        id: `conflict-${hits[0].field.id}`,
        kind: "conflict",
        nodeId: hits[0].node.id,
        fieldId: hits[0].field.id,
        question: `Two answers for ${hits[0].field.label.toLowerCase()} — which is current?`,
        options: values.slice(0, 4),
      });
    }
  }

  // Stale: a lapse date that has passed.
  for (const n of nodes) {
    for (const f of n.fields) {
      if (!f.value.trim() || !LAPSES.test(f.label)) continue;
      const when = new Date(f.value);
      if (!Number.isNaN(when.getTime()) && when < now) {
        out.push({
          id: `stale-${f.id}`,
          kind: "stale",
          nodeId: n.id,
          fieldId: f.id,
          question: `${n.name} · ${f.label} passed on ${f.value}. Still right?`,
        });
      }
    }
  }

  // Unconfirmed: the AI wrote it and nobody has agreed yet.
  for (const n of nodes) {
    for (const f of n.fields) {
      if (f.confirmed || !f.value.trim()) continue;
      out.push({
        id: `unconfirmed-${f.id}`,
        kind: "unconfirmed",
        nodeId: n.id,
        fieldId: f.id,
        question: `${n.name} · ${f.label} — is "${f.kind === "secret" ? "the value I found" : f.value}" right?`,
      });
    }
  }

  // Conflicts first: they are the only kind where the profile is actively wrong.
  const rank: Record<ConfirmItem["kind"], number> = { conflict: 0, stale: 1, unconfirmed: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, 60);
}

export function confirmField(store: ProfileStore, nodeId: string, fieldId: string, value?: string): ProfileStore {
  return {
    ...store,
    nodes: store.nodes.map((n) =>
      n.id !== nodeId
        ? n
        : {
            ...n,
            updatedAt: today(),
            fields: n.fields.map((f) =>
              f.id !== fieldId
                ? f
                : { ...f, value: value ?? f.value, source: "you" as Source, confirmed: true, updatedAt: today() },
            ),
          },
    ),
  };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface Hit {
  node: Node;
  path: string;
  /** Why it matched, e.g. "Door code" or "name". */
  on: string;
  score: number;
}

/**
 * One bar searches node names, field labels and field VALUES — a profile is
 * only useful if "what's my plate" finds the plate, not just a folder called
 * Vehicles. Secret values are excluded: the bar must never be a way to read
 * a password by guessing at it.
 */
export function search(nodes: Node[], query: string, limit = 24): Hit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: Hit[] = [];

  for (const n of nodes) {
    const name = n.name.toLowerCase();
    let score = 0;
    let on = "name";
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 70;
    else if (name.includes(q)) score = 50;

    if (!score) {
      for (const f of n.fields) {
        if (f.label.toLowerCase().includes(q)) {
          score = 34;
          on = f.label;
          break;
        }
        if (f.kind !== "secret" && f.value && f.value.toLowerCase().includes(q)) {
          score = 28;
          on = f.label;
          break;
        }
      }
    }
    if (!score && n.notes.toLowerCase().includes(q)) {
      score = 18;
      on = "notes";
    }
    if (score) hits.push({ node: n, path: pathOf(nodes, n.id), on, score });
  }

  return hits
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}

/** A question gets the Ask affordance; a word gets the filter. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 6) return false;
  return t.endsWith("?") || /^(what|when|where|who|which|why|how|do i|did i|am i|is my|are my|can you|tell me|show me|remind)\b/.test(t);
}

// ---------------------------------------------------------------------------
// Birthdays — the owner's "all friends birthdays" ask, read straight off the tree
// ---------------------------------------------------------------------------

export interface Birthday {
  nodeId: string;
  name: string;
  /** Raw value as stored. */
  date: string;
  /** Days until the next occurrence, 0 = today. */
  inDays: number;
}

export function birthdays(nodes: Node[], now = new Date()): Birthday[] {
  const out: Birthday[] = [];
  for (const n of nodes) {
    const f = n.fields.find((x) => /birthday/i.test(x.label) && x.value.trim());
    if (!f) continue;
    const parsed = new Date(f.value);
    if (Number.isNaN(parsed.getTime())) continue;
    // Compare on month/day only — a birthday has a year, but "when is it next"
    // does not care about it.
    const next = new Date(now.getFullYear(), parsed.getMonth(), parsed.getDate());
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (next < start) next.setFullYear(next.getFullYear() + 1);
    out.push({
      nodeId: n.id,
      name: n.name,
      date: f.value,
      inDays: Math.round((next.getTime() - start.getTime()) / 86_400_000),
    });
  }
  return out.sort((a, b) => a.inDays - b.inDays);
}

export { PACK_BY_ID };
