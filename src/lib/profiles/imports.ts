// ---------------------------------------------------------------------------
// Bringing the owner's existing profiles into the one Profiles app.
//
// Before Profiles there were three places holding the same kind of facts: the
// Dashboard's Profiles board (people and businesses with fields and accounts),
// the Life record (the 47 fields a form asks for, which Read my screen writes
// to), and the old "Who you are" tree. Profiles is now the one place, so:
//
//   · Dashboard profiles are imported ONCE each ("recall:<id>" in `imported`),
//     keeping a link to their folder so Folders/Photos stay the same subject.
//   · The Life record is synced EVERY time Profiles opens, into My Profile,
//     keyed by record field so it updates in place and never duplicates.
//     Read my screen keeps writing to the record; this is what makes what it
//     reads show up here.
//
// Pure functions over plain data, so they are tested without a browser.
// ---------------------------------------------------------------------------

import { newId } from "./changes";
import { ROOT } from "./seed";
import type { Item, ProfileNode, ProfilesData, Section } from "./types";
import type { Profile as RecallProfile, RecallData } from "@/lib/recall/types";
import { GROUPS, SECTIONS, entryTitle, type LifeRecord } from "@/lib/jarvis/record/types";

function clone<T>(x: T): T {
  return typeof structuredClone === "function" ? structuredClone(x) : JSON.parse(JSON.stringify(x));
}

/** The world without the seeded examples; anything the owner made is kept. */
export function withoutExamples(data: ProfilesData): ProfilesData {
  if (!data.examples) return data;
  const next = clone(data);
  const keep = new Set(Object.values(next.nodes).filter((n) => !n.example).map((n) => n.id));
  keep.add(ROOT);
  const nodes: ProfilesData["nodes"] = {};
  for (const id of keep) nodes[id] = next.nodes[id];
  for (const n of Object.values(nodes)) {
    n.children = n.children.filter((c) => keep.has(c));
    n.links = n.links.filter((c) => keep.has(c));
  }
  // Anything whose home was an example now lives on the home screen.
  const homed = new Set(Object.values(nodes).flatMap((n) => n.children));
  for (const id of keep) if (id !== ROOT && !homed.has(id)) nodes[ROOT].children.push(id);
  return { ...next, nodes, memory: next.memory.filter((m) => keep.has(m.about)), examples: false };
}

function blank(id: string, o: Partial<ProfileNode> & Pick<ProfileNode, "name" | "label" | "sub">): ProfileNode {
  return { id, kind: "thing", children: [], links: [], sections: [], media: [], ...o };
}

/** Find a real (non-example) child of `parent` by name, or make it. */
function ensureChild(data: ProfilesData, parent: string, name: string, o: Partial<ProfileNode> & Pick<ProfileNode, "label" | "sub">): ProfileNode {
  const found = data.nodes[parent]?.children.map((c) => data.nodes[c]).find((n) => n && !n.example && !n.archived && n.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  const node = blank(newId("p"), { name, ...o });
  data.nodes[node.id] = node;
  data.nodes[parent].children.push(node.id);
  return node;
}

/** The owner's own profile, made real if it is still the example. */
export function ensureMe(data: ProfilesData): ProfileNode {
  const me = data.nodes.me;
  if (me && !me.example && !me.archived) return me;
  const node = blank(me && me.example ? newId("p") : "me", { name: "My Profile", kind: "person", label: "You", sub: "", icon: "user", hue: 34 });
  data.nodes[node.id] = node;
  if (!data.nodes[ROOT].children.includes(node.id)) data.nodes[ROOT].children.unshift(node.id);
  return node;
}

function upsertRow(node: ProfileNode, sectionTitle: string, icon: string | undefined, key: string, row: Omit<Item, "id">): boolean {
  node.recordKeys = node.recordKeys ?? {};
  const existing = node.recordKeys[key];
  for (const s of node.sections) {
    const it = s.items.find((i) => i.id === existing);
    if (it) {
      if (it.v === row.v && it.k === row.k) return false;
      Object.assign(it, row);
      return true;
    }
  }
  let s = node.sections.find((x) => x.title === sectionTitle);
  if (!s) {
    s = { id: newId("s"), title: sectionTitle, icon, items: [] } as Section;
    node.sections.push(s);
  }
  const id = newId("i");
  s.items.push({ id, ...row });
  node.recordKeys[key] = id;
  return true;
}

const SECTION_ICON: Record<string, string> = {
  identity: "id-card",
  contact: "phone",
  household: "home",
  work: "badge",
  health: "stethoscope",
};

/**
 * Sync the Life record into My Profile. Returns the new data and how many rows
 * were added or changed (0 means nothing to save).
 */
export function syncLifeRecord(input: ProfilesData, record: LifeRecord | null): { data: ProfilesData; changed: number } {
  if (!record) return { data: input, changed: 0 };
  const hasAny =
    Object.values(record.fields ?? {}).some((f) => f?.value?.trim()) ||
    Object.values(record.groups ?? {}).some((g) => g?.length);
  if (!hasAny) return { data: input, changed: 0 };
  const data = withoutExamples(clone(input));
  const me = ensureMe(data);
  let changed = 0;

  for (const section of SECTIONS)
    for (const f of section.fields) {
      const v = record.fields?.[f.key]?.value?.trim();
      if (!v) continue;
      const row: Omit<Item, "id"> = { k: f.label, v };
      if (f.sensitive) Object.assign(row, { secret: true, noAi: true });
      if (f.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) row.date = v;
      if (upsertRow(me, section.label, SECTION_ICON[section.id], `field:${f.key}`, row)) changed++;
    }

  for (const group of GROUPS) {
    const entries = record.groups?.[group.id] ?? [];
    if (!entries.length) continue;
    if (group.id === "jobs") {
      // Work history becomes job profiles inside My Jobs, each its own world.
      const jobs = ensureChild(data, ROOT, "My Jobs", { label: "Work", sub: "", icon: "badge", hue: 268 });
      for (const e of entries) {
        const key = `group:jobs:${e.id}`;
        let job = me.recordKeys?.[key] ? data.nodes[me.recordKeys[key]] : undefined;
        if (!job) {
          job = blank(newId("p"), { name: entryTitle(group, e), label: "Job", sub: "", icon: "badge" });
          data.nodes[job.id] = job;
          jobs.children.push(job.id);
          me.recordKeys = { ...(me.recordKeys ?? {}), [key]: job.id };
          changed++;
        }
        for (const f of group.fields) {
          const v = e.values[f.key]?.trim();
          if (!v) continue;
          const row: Omit<Item, "id"> = { k: f.label, v };
          if (f.sensitive) Object.assign(row, { secret: true, noAi: true });
          if (f.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) row.date = v;
          if (upsertRow(job, "Work info", "badge", `field:${f.key}`, row)) changed++;
        }
      }
      continue;
    }
    for (const e of entries) {
      const rest = group.fields
        .filter((f) => !group.title.includes(f.key) && e.values[f.key]?.trim() && !f.sensitive)
        .map((f) => e.values[f.key].trim())
        .join(" · ");
      if (upsertRow(me, group.label, undefined, `group:${group.id}:${e.id}`, { k: entryTitle(group, e), v: rest || "—" })) changed++;
    }
  }
  return changed ? { data, changed } : { data: input, changed: 0 };
}

const PERSON_HOME: Record<string, "root" | "me"> = { self: "me", child: "root", partner: "root", relative: "me", friend: "me", client: "root", vendor: "root", other: "root" };
const ROLE_LABEL: Record<string, string> = { child: "Person", partner: "Person", relative: "Family", friend: "Friend", client: "Client", vendor: "Vendor", other: "Person" };

/** Import each Dashboard profile once. */
export function importRecallProfiles(input: ProfilesData, recall: Pick<RecallData, "profiles"> | null): { data: ProfilesData; count: number } {
  const done = new Set(input.imported ?? []);
  const todo = (recall?.profiles ?? []).filter((p) => !done.has(`recall:${p.id}`));
  if (!todo.length) return { data: input, count: 0 };
  const data = withoutExamples(clone(input));
  let count = 0;
  for (const p of todo) {
    const target = placeFor(data, p);
    fillFromRecall(target, p);
    data.imported = [...(data.imported ?? []), `recall:${p.id}`];
    count++;
  }
  return { data, count };
}

function placeFor(data: ProfilesData, p: RecallProfile): ProfileNode {
  if (p.kind === "person" && p.role === "self") {
    const me = ensureMe(data);
    return me;
  }
  let parent = ROOT;
  if (p.kind === "business") parent = ensureChild(data, ROOT, "My Businesses", { label: "Businesses", sub: "", icon: "briefcase", hue: 208 }).id;
  else if (PERSON_HOME[p.role ?? "other"] === "me") parent = ensureMe(data).id;
  const node = blank(newId("p"), {
    name: p.displayName || p.legalName || "Untitled",
    kind: p.kind === "person" ? "person" : "thing",
    label: p.kind === "business" ? "Business" : ROLE_LABEL[p.role ?? "other"] ?? "Person",
    sub: p.headline ?? "",
    icon: p.kind === "business" ? "briefcase" : undefined,
    initials: p.kind === "person" ? initials(p.displayName) : undefined,
  });
  if (parent === ROOT && p.kind === "person") node.hue = HUES[Object.keys(data.nodes).length % HUES.length];
  data.nodes[node.id] = node;
  data.nodes[parent].children.push(node.id);
  return node;
}

const HUES = [158, 345, 188, 34, 268, 12];

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function fillFromRecall(node: ProfileNode, p: RecallProfile): void {
  node.recall = { ...(node.recall ?? {}), profileId: p.id, folderId: node.recall?.folderId ?? p.folderId ?? undefined };
  if (p.avatar && !node.avatar) node.avatar = p.avatar;
  if (p.headline && !node.sub) node.sub = p.headline;
  const rows = p.fields.filter((f) => f.value?.trim());
  if (rows.length) {
    const s: Section = { id: newId("s"), title: p.kind === "business" ? "Business details" : "Personal information", icon: p.kind === "business" ? "info" : "user", items: [] };
    for (const f of rows) {
      const it: Item = { id: newId("i"), k: f.label, v: f.value.trim() };
      if (f.sensitive || f.type === "ssn" || f.type === "secret" || f.type === "login") it.secret = true;
      if (f.type === "ssn" || f.type === "secret") it.noAi = true;
      if (f.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(f.value.trim())) it.date = f.value.trim();
      s.items.push(it);
    }
    node.sections.push(s);
  }
  if (p.accounts.length) {
    const s: Section = { id: newId("s"), title: "Accounts and logins", icon: "key-round", items: [] };
    for (const a of p.accounts) {
      s.items.push({ id: newId("i"), k: a.label, v: [a.provider, a.login].filter(Boolean).join(" · ") || a.url || "—", meta: a.url || undefined });
      if (a.accountNumber) s.items.push({ id: newId("i"), k: `${a.label} account number`, v: a.accountNumber, secret: true });
      if (a.password) s.items.push({ id: newId("i"), k: `${a.label} password`, v: a.password, secret: true, noAi: true });
    }
    node.sections.push(s);
  }
  if (p.notes?.trim()) node.sections.push({ id: newId("s"), title: "Notes", icon: "notebook-pen", items: [{ id: newId("i"), k: "Note", v: p.notes.trim() }] });
}
