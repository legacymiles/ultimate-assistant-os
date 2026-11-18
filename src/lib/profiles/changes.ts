// ---------------------------------------------------------------------------
// Applying a change set — and knowing how to take it back.
//
// Every write in Profiles goes through applyChanges(), whether the owner typed
// it or Jarvis proposed it. It is pure: it returns a new ProfilesData plus the
// exact list of changes that undoes it, so "Undo" is the same machinery run
// again rather than a snapshot that could clobber edits made since.
//
// A change that names something that does not exist is skipped and reported,
// never guessed at. Jarvis is a language model; when it invents an id, the
// owner should see "couldn't find that" rather than a row filed in the wrong
// profile.
// ---------------------------------------------------------------------------

import { ROOT } from "./seed";
import { findItem, isInside, parentOf, whereLabel } from "./tree";
import type { Change, Item, ProfileNode, ProfilesData, Section } from "./types";

let counter = 0;
export function newId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function clone(data: ProfilesData): ProfilesData {
  return typeof structuredClone === "function" ? structuredClone(data) : JSON.parse(JSON.stringify(data));
}

function initialsOf(name: string): string {
  const words = name.replace(/^(mr|mrs|ms|dr|miss)\.?\s+/i, "").split(/\s+/).filter(Boolean);
  const pick = name.match(/^(mr|mrs|ms|dr)\.?\s+/i) ? [name[0], words[0]?.[0] ?? ""] : words.slice(0, 2).map((w) => w[0]);
  return pick.join("").toUpperCase().slice(0, 2);
}

export interface Applied {
  data: ProfilesData;
  undo: Change[];
  /** Plain sentences of what happened, in order. */
  done: string[];
  /** Changes that could not be applied, with why. */
  skipped: string[];
  /** Ids that were created, by their `ref`. */
  created: Record<string, string>;
  /** The node most of the set touched, for "Open it". */
  focus: string | null;
}

/** Resolve "new:1"-style refs to the ids they were given earlier in the set. */
function ref(id: string | undefined, created: Record<string, string>): string {
  if (!id) return "";
  return created[id] ?? id;
}

function sectionFor(node: ProfileNode, title: string): Section {
  const want = title.trim().toLowerCase();
  let s = node.sections.find((x) => x.title.toLowerCase() === want);
  if (!s) {
    s = { id: newId("s"), title: title.trim() || "Notes", items: [] };
    node.sections.push(s);
  }
  return s;
}

export function applyChanges(input: ProfilesData, changes: Change[]): Applied {
  const data = clone(input);
  const undo: Change[] = [];
  const done: string[] = [];
  const skipped: string[] = [];
  const created: Record<string, string> = {};
  let focus: string | null = null;
  const node = (id: string): ProfileNode | undefined => data.nodes[ref(id, created)];

  for (const c of changes) {
    switch (c.op) {
      case "add_node": {
        const parent = node(c.parent);
        if (!parent) {
          skipped.push(`Couldn't find where to put ${c.name}.`);
          break;
        }
        const id = newId("p");
        const kind = c.kind === "person" ? "person" : "thing";
        data.nodes[id] = {
          id,
          name: c.name.trim() || "Untitled",
          kind,
          label: c.label?.trim() || (kind === "person" ? "Person" : "Folder"),
          sub: c.sub?.trim() ?? "",
          icon: kind === "thing" ? c.icon || "folder" : undefined,
          initials: kind === "person" ? c.initials || initialsOf(c.name) : undefined,
          children: [],
          links: [],
          sections: [],
          media: [],
        };
        parent.children.push(id);
        if (c.ref) created[c.ref] = id;
        undo.unshift({ op: "delete_node", node: id });
        done.push(`Created ${data.nodes[id].name} in ${parent.name}`);
        focus = id;
        break;
      }
      case "add_item": {
        const n = node(c.node);
        if (!n) {
          skipped.push(`Couldn't find the profile for "${c.k}".`);
          break;
        }
        const s = sectionFor(n, c.section);
        const item: Item = { id: newId("i"), k: c.k.trim(), v: String(c.v ?? "").trim() };
        if (c.secret) item.secret = true;
        if (c.date && /^\d{4}-\d{2}-\d{2}$/.test(c.date)) item.date = c.date;
        if (typeof c.money === "number" && Number.isFinite(c.money)) item.money = c.money;
        if (c.meta) item.meta = c.meta;
        s.items.push(item);
        undo.unshift({ op: "remove_item", item: item.id });
        done.push(`Added ${item.k} to ${n.name}`);
        focus = focus ?? n.id;
        break;
      }
      case "set_item": {
        const found = findItem(data, c.item);
        if (!found) {
          skipped.push("Couldn't find the row to change.");
          break;
        }
        undo.unshift({ op: "set_item", item: c.item, v: found.item.v, date: found.item.date });
        found.item.v = String(c.v ?? "").trim();
        if (c.date !== undefined) {
          if (c.date && /^\d{4}-\d{2}-\d{2}$/.test(c.date)) found.item.date = c.date;
          else delete found.item.date;
        }
        done.push(`Changed ${found.item.k} in ${found.node.name}`);
        focus = focus ?? found.node.id;
        break;
      }
      case "remove_item": {
        let hit = false;
        for (const n of Object.values(data.nodes)) {
          const si = n.sections.findIndex((s) => s.items.some((i) => i.id === c.item));
          if (si < 0) continue;
          const s = n.sections[si];
          const index = s.items.findIndex((i) => i.id === c.item);
          const [item] = s.items.splice(index, 1);
          undo.unshift({ op: "restore_item", node: n.id, section: s.id, sectionIndex: si, index, item, sectionTitle: s.title, sectionIcon: s.icon });
          // No empty sections, ever.
          if (!s.items.length) n.sections.splice(si, 1);
          done.push(`Removed ${item.k} from ${n.name}`);
          hit = true;
          break;
        }
        if (!hit) skipped.push("Couldn't find the row to remove.");
        break;
      }
      case "restore_item": {
        const n = node(c.node);
        if (!n) break;
        let s = n.sections.find((x) => x.id === c.section);
        if (!s) {
          s = { id: c.section, title: c.sectionTitle, icon: c.sectionIcon, items: [] };
          n.sections.splice(Math.min(c.sectionIndex, n.sections.length), 0, s);
        }
        s.items.splice(Math.min(c.index, s.items.length), 0, c.item);
        undo.unshift({ op: "remove_item", item: c.item.id });
        done.push(`Put back ${c.item.k}`);
        break;
      }
      case "move_node": {
        const id = ref(c.node, created);
        const n = data.nodes[id];
        const to = node(c.parent);
        const from = parentOf(data, id);
        if (!n || !to || id === ROOT) {
          skipped.push("Couldn't find what to move, or where.");
          break;
        }
        if (isInside(data, to.id, id)) {
          skipped.push(`Can't move ${n.name} inside itself.`);
          break;
        }
        if (from === to.id) {
          skipped.push(`${n.name} is already in ${to.name}.`);
          break;
        }
        if (from) data.nodes[from].children = data.nodes[from].children.filter((x) => x !== id);
        to.children.push(id);
        to.links = to.links.filter((x) => x !== id);
        undo.unshift({ op: "move_node", node: id, parent: from ?? ROOT });
        done.push(`Moved ${n.name} into ${to.name}`);
        focus = id;
        break;
      }
      case "link_node": {
        const n = node(c.node);
        const into = node(c.into);
        if (!n || !into || into.links.includes(n.id) || into.children.includes(n.id)) {
          skipped.push("Couldn't link that.");
          break;
        }
        into.links.push(n.id);
        undo.unshift({ op: "unlink_node", node: n.id, into: into.id });
        done.push(`Linked ${n.name} inside ${into.name}`);
        break;
      }
      case "unlink_node": {
        const into = node(c.into);
        if (!into) break;
        into.links = into.links.filter((x) => x !== c.node);
        undo.unshift({ op: "link_node", node: c.node, into: c.into });
        done.push("Removed a link");
        break;
      }
      case "rename_node": {
        const n = node(c.node);
        if (!n) {
          skipped.push("Couldn't find the profile to rename.");
          break;
        }
        undo.unshift({ op: "rename_node", node: n.id, name: n.name, sub: n.sub });
        if (c.name?.trim()) n.name = c.name.trim();
        if (c.sub !== undefined) n.sub = c.sub.trim();
        done.push(`Renamed to ${n.name}`);
        focus = focus ?? n.id;
        break;
      }
      case "archive_node": {
        const n = node(c.node);
        if (!n || n.id === ROOT) {
          skipped.push("Couldn't find the profile to archive.");
          break;
        }
        n.archived = true;
        undo.unshift({ op: "restore_node", node: n.id });
        done.push(`Archived ${n.name}`);
        break;
      }
      case "restore_node": {
        const n = node(c.node);
        if (!n) break;
        n.archived = false;
        undo.unshift({ op: "archive_node", node: n.id });
        done.push(`Restored ${n.name}`);
        break;
      }
      case "delete_node": {
        const id = ref(c.node, created);
        const n = data.nodes[id];
        if (!n) break;
        const from = parentOf(data, id);
        if (from) data.nodes[from].children = data.nodes[from].children.filter((x) => x !== id);
        for (const other of Object.values(data.nodes)) other.links = other.links.filter((x) => x !== id);
        // Its own children go up a level rather than vanishing with it.
        if (from) data.nodes[from].children.push(...n.children);
        delete data.nodes[id];
        done.push(`Removed ${n.name}`);
        break;
      }
      case "add_media": {
        const n = node(c.node);
        if (!n || !c.media?.length) {
          skipped.push("Couldn't find where to file the photos.");
          break;
        }
        const list = c.media.map((m) => ({ ...m, id: m.id || newId("m") }));
        n.media = [...list, ...n.media];
        undo.unshift({ op: "remove_media", node: n.id, ids: list.map((m) => m.id) });
        done.push(`Added ${list.length} ${list.length === 1 ? "item" : "items"} to ${n.name}'s photos`);
        focus = focus ?? n.id;
        break;
      }
      case "remove_media": {
        const n = node(c.node);
        if (!n) break;
        const gone = new Set(c.ids);
        n.media = n.media.filter((m) => !gone.has(m.id));
        done.push("Removed photos");
        break;
      }
      case "remember": {
        const about = node(c.about);
        if (!about) {
          skipped.push("Couldn't tell who that was about.");
          break;
        }
        const id = newId("mem");
        data.memory.push({ id, about: about.id, k: c.k, v: c.v });
        undo.unshift({ op: "forget", id });
        done.push(`Remembered ${c.k} for ${about.name}`);
        break;
      }
      case "patch_node": {
        const n = node(c.node);
        if (!n) break;
        const before: Record<string, unknown> = {};
        for (const k of Object.keys(c.patch) as (keyof typeof c.patch)[]) before[k] = n[k];
        Object.assign(n, c.patch);
        for (const [k, v] of Object.entries(c.patch)) if (v === undefined) delete (n as unknown as Record<string, unknown>)[k];
        undo.unshift({ op: "patch_node", node: n.id, patch: before as typeof c.patch });
        done.push(`Updated ${n.name}`);
        focus = focus ?? n.id;
        break;
      }
      case "forget": {
        data.memory = data.memory.filter((m) => m.id !== c.id);
        break;
      }
      default:
        skipped.push("Jarvis asked for something Profiles can't do yet.");
    }
  }
  return { data, undo, done, skipped, created, focus };
}

/** One line for a change card, before it is applied. */
export interface ChangeLine {
  mark: "+" | "edit" | "move" | "remove";
  title: string;
  detail: string;
  where: string;
}

export function describeChanges(data: ProfilesData, changes: Change[]): ChangeLine[] {
  const pending: Record<string, string> = {};
  const nameOf = (id: string) => pending[id] ?? data.nodes[id]?.name ?? id;
  const whereOf = (id: string) => (pending[id] ? `› ${pending[id].toUpperCase()}` : whereLabel(data, id));
  const out: ChangeLine[] = [];
  for (const c of changes) {
    switch (c.op) {
      case "add_node":
        if (c.ref) pending[c.ref] = c.name;
        out.push({ mark: "+", title: `New profile · ${c.name}`, detail: [c.label, c.sub].filter(Boolean).join(" · "), where: whereOf(c.parent) });
        break;
      case "add_item":
        out.push({ mark: "+", title: `${c.k} · ${c.secret ? "••••" : c.v}`, detail: c.section, where: whereOf(c.node) });
        break;
      case "set_item": {
        const f = findItem(data, c.item);
        out.push({ mark: "edit", title: `${f?.item.k ?? "Row"} · ${f?.item.secret ? "••••" : (f?.item.v ?? "")} → ${f?.item.secret ? "••••" : c.v}`, detail: f?.section.title ?? "", where: f ? whereLabel(data, f.node.id) : "" });
        break;
      }
      case "remove_item": {
        const f = findItem(data, c.item);
        out.push({ mark: "remove", title: `Remove ${f?.item.k ?? "row"}`, detail: f?.section.title ?? "", where: f ? whereLabel(data, f.node.id) : "" });
        break;
      }
      case "move_node":
        out.push({ mark: "move", title: `Move ${nameOf(c.node)}`, detail: `into ${nameOf(c.parent)}`, where: whereOf(c.parent) });
        break;
      case "link_node":
        out.push({ mark: "+", title: `Link ${nameOf(c.node)}`, detail: `also show it in ${nameOf(c.into)}`, where: whereOf(c.into) });
        break;
      case "rename_node":
        out.push({ mark: "edit", title: `Rename ${nameOf(c.node)}${c.name ? ` → ${c.name}` : ""}`, detail: c.sub ?? "", where: whereOf(c.node) });
        break;
      case "archive_node":
        out.push({ mark: "remove", title: `Archive ${nameOf(c.node)}`, detail: "Hidden from home and Jarvis", where: whereOf(c.node) });
        break;
      case "add_media":
        out.push({ mark: "+", title: `${c.media.length} ${c.media.length === 1 ? "photo" : "photos and videos"}`, detail: "Photos and videos", where: whereOf(c.node) });
        break;
      case "remember":
        out.push({ mark: "+", title: `Remember · ${c.k}: ${c.v}`, detail: "Memory", where: whereOf(c.about) });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Only the ops a brain may ask for — the internal inverses stay internal. */
const PUBLIC_OPS = new Set(["add_node", "add_item", "set_item", "remove_item", "move_node", "link_node", "rename_node", "archive_node", "add_media", "remember"]);

/** Drop anything malformed a model sent, keep the rest in order. */
export function sanitizeChanges(raw: unknown): Change[] {
  if (!Array.isArray(raw)) return [];
  const out: Change[] = [];
  const str = (x: unknown) => (typeof x === "string" ? x : typeof x === "number" ? String(x) : "");
  // Models copy ids straight out of the outline, prefix and all.
  const id = (x: unknown) => str(x).trim().replace(/^[#@]/, "");
  for (const r of raw.slice(0, 40)) {
    if (!r || typeof r !== "object") continue;
    const c = r as Record<string, unknown>;
    const op = str(c.op);
    if (!PUBLIC_OPS.has(op)) continue;
    switch (op) {
      case "add_node":
        if (id(c.parent) && str(c.name)) out.push({ op, parent: id(c.parent), name: str(c.name), ref: str(c.ref) || undefined, kind: c.kind === "person" ? "person" : "thing", label: str(c.label) || undefined, sub: str(c.sub) || undefined, icon: str(c.icon) || undefined });
        break;
      case "add_item":
        if (id(c.node) && str(c.k)) out.push({ op, node: id(c.node), section: str(c.section) || "Notes", k: str(c.k), v: str(c.v), secret: c.secret === true || undefined, date: str(c.date) || undefined, money: typeof c.money === "number" ? c.money : undefined, meta: str(c.meta) || undefined });
        break;
      case "set_item":
        if (id(c.item)) out.push({ op, item: id(c.item), v: str(c.v), date: c.date === undefined ? undefined : str(c.date) });
        break;
      case "remove_item":
        if (id(c.item)) out.push({ op, item: id(c.item) });
        break;
      case "move_node":
        if (id(c.node) && id(c.parent)) out.push({ op, node: id(c.node), parent: id(c.parent) });
        break;
      case "link_node":
        if (id(c.node) && id(c.into)) out.push({ op, node: id(c.node), into: id(c.into) });
        break;
      case "rename_node":
        if (id(c.node)) out.push({ op, node: id(c.node), name: str(c.name) || undefined, sub: c.sub === undefined ? undefined : str(c.sub) });
        break;
      case "archive_node":
        if (id(c.node)) out.push({ op, node: id(c.node) });
        break;
      case "remember":
        if (id(c.about) && str(c.k)) out.push({ op, about: id(c.about), k: str(c.k), v: str(c.v) });
        break;
      default:
        break;
    }
  }
  return out;
}
