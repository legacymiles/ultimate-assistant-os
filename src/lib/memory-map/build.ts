// ---------------------------------------------------------------------------
// The Memory map — everything Jarvis knows about your world, as one web.
//
// It replaces the old Brain tab, which only drew an Obsidian vault and was
// empty for anyone without one. This draws what the owner actually has, so it
// is never empty:
//
//   you ── hubs ── Apps · Skills · Clients · Crashes · Tasks · Memories · Notes
//   apps     every app in the hub, clustered by catalog category, amber when unfinished
//   skills   every skill, clustered by its library category
//   clients  client sites (Client Review), plus any site that has sent a crash
//   crashes  open entries in the site-error log, wired to the app or client they hit
//   tasks    the pinned priorities from In Queue
//   memories recent memories, wired to every app / skill / client they mention
//   notes    the Obsidian vault, when there is one, with its own [[links]]
//
// Cross-links are what make it a web rather than a tree: a crash points at the
// app it happened on, a memory points at the client it's about, a skill points
// at the app it builds.
//
// FOUR LAYERS (Oct 2026, owner's ask — the RoboNuggets-style second brain):
//   0  core       you
//   1  areas      the routers: hubs and category groups (what an agent reads first)
//   2  abilities  apps, skills, client sites — what can do things
//   3  memories   memories, notes, tasks, crashes, the daily log, findings
// Every node carries its layer; the renderer pulls each layer onto its own
// shell (3D) or ring (flat), and the links are what cross between them.
//
// Also: the daily log and the findings per workflow (lib/memory-rules), and
// `timelineOf` — who changed what, newest first.
// Pure — tested without a browser.
// ---------------------------------------------------------------------------

export type MapType = "you" | "hub" | "group" | "app" | "skill" | "client" | "crash" | "task" | "memory" | "note" | "log" | "finding";

export const TYPE_META: Record<Exclude<MapType, "you" | "hub" | "group">, { label: string; color: string }> = {
  app: { label: "Apps", color: "#47e8ff" },
  skill: { label: "Skills", color: "#b48cff" },
  client: { label: "Clients", color: "#5bf0a5" },
  crash: { label: "Crashes", color: "#ff5c7a" },
  task: { label: "Tasks", color: "#ffb547" },
  memory: { label: "Memories", color: "#7aa7ff" },
  note: { label: "Notes", color: "#e9ecf3" },
  log: { label: "Daily log", color: "#ffd27a" },
  finding: { label: "Findings", color: "#ff8fd8" },
};

export type Layer = 0 | 1 | 2 | 3;

export const LAYERS: { layer: Layer; label: string; what: string }[] = [
  { layer: 0, label: "Core", what: "You" },
  { layer: 1, label: "Areas", what: "The routers an agent reads first" },
  { layer: 2, label: "Abilities", what: "Apps, skills and client sites" },
  { layer: 3, label: "Memories", what: "Memories, notes, tasks, crashes, the daily log, findings" },
];

export function layerOf(type: MapType): Layer {
  if (type === "you") return 0;
  if (type === "hub" || type === "group") return 1;
  if (type === "app" || type === "skill" || type === "client") return 2;
  return 3;
}

export type ItemType = keyof typeof TYPE_META;
export const ITEM_TYPES = Object.keys(TYPE_META) as ItemType[];

export interface MapNode {
  key: string;
  type: MapType;
  /** 0 core · 1 areas · 2 abilities · 3 memories. Set by the builder from the type. */
  layer?: Layer;
  /** Who last changed it, when known ("claude-code", "jarvis", "owner", "git"). */
  by?: string;
  /** For hubs and groups: which item type they gather. */
  of?: ItemType;
  title: string;
  /** One line under the title in the inspector. */
  subtitle?: string;
  /** Longer text for the inspector. */
  detail?: string;
  /** Unfinished (amber ring) or finished — apps, skills and tasks from In Queue. */
  state?: "wip" | "done";
  /** 0..1 — drives size and glow. */
  weight: number;
  /** Keys of nodes this one connects to. */
  links: string[];
  /** Where "Open" goes. */
  href?: string;
  /** Skills: how to call it. */
  command?: string;
  /** The id of the underlying record, for actions (queue row id, crash id, memory id). */
  ref?: string;
  /** When it last changed, for "newest" glow. */
  at?: string;
}

export interface MapGraph {
  nodes: MapNode[];
  /** Undirected, de-duplicated. */
  edges: [string, string][];
  counts: Record<ItemType, number>;
}

// ----- inputs (structural, so the builder needs none of the real modules) ----------

export interface QueueRowIn {
  id: string;
  kind: "task" | "app" | "skill" | "workflow";
  name: string;
  blurb: string;
  group: string;
  href?: string;
  state: "wip" | "done";
  note?: string;
}

export interface SkillIn {
  slug: string;
  title: string;
  overview: string;
  categories: string[];
  nicknames: string[];
  command: string;
}

export interface CrashIn {
  id: string;
  site: string;
  message: string;
  count: number;
  urls: string[];
  lastSeen: string;
}

export interface ClientIn {
  id: string;
  name: string;
  clientName?: string;
}

export interface MemoryIn {
  id: string;
  title: string;
  content: string;
  source: string;
  capturedAt: string;
}

export interface NoteIn {
  key: string;
  title: string;
  links: string[];
  kind: string;
  strength: number;
}

export interface LogEntryIn {
  at: string;
  by: string;
  text: string;
  about?: string;
}

export interface FindingIn {
  at: string;
  by: string;
  text: string;
  kind: "win" | "miss" | "note";
}

export interface AppEditIn {
  slug: string;
  /** YYYY-MM-DD. */
  date: string;
  title: string;
}

export interface MapInputs {
  queue?: QueueRowIn[];
  skills?: SkillIn[];
  crashes?: CrashIn[];
  clients?: ClientIn[];
  memories?: MemoryIn[];
  notes?: NoteIn[];
  /** The daily log, newest day first (lib/memory-rules recentLog). */
  logs?: { day: string; entries: LogEntryIn[] }[];
  /** Findings per workflow key. */
  findings?: Record<string, FindingIn[]>;
  /** Every commit that touched an app (Projects Timeline's feature log). */
  appEdits?: AppEditIn[];
}

/** Hard ceilings so a huge vault or log can never make the map unusable. */
export const LIMITS = { memories: 120, notes: 250, crashes: 60, total: 700 };

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Words worth matching a mention on: ≥4 chars, not a filler word. */
const STOP = new Set(["with", "your", "this", "that", "from", "into", "jarvis", "skill", "skills", "apps", "studio", "the", "and", "for", "site", "website", "page", "tool"]);

function needles(...names: (string | undefined)[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    if (!n) continue;
    const t = n.toLowerCase().trim();
    if (t.length >= 4 && !STOP.has(t)) out.add(t);
    const dashed = t.replace(/-/g, " ");
    if (dashed !== t && dashed.length >= 4) out.add(dashed);
  }
  return [...out];
}

function mentions(haystack: string, words: string[]): boolean {
  for (const w of words) {
    const at = haystack.indexOf(w);
    if (at < 0) continue;
    const before = at === 0 ? " " : haystack[at - 1];
    const after = haystack[at + w.length] ?? " ";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
  }
  return false;
}

export function buildMap(input: MapInputs): MapGraph {
  const nodes = new Map<string, MapNode>();
  const edges = new Map<string, [string, string]>();
  const link = (a: string, b: string) => {
    if (a === b || !nodes.has(a) || !nodes.has(b)) return;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!edges.has(k)) edges.set(k, a < b ? [a, b] : [b, a]);
  };
  const add = (n: MapNode) => {
    if (nodes.size >= LIMITS.total && n.type !== "you" && n.type !== "hub") return false;
    n.layer = layerOf(n.type);
    nodes.set(n.key, n);
    return true;
  };
  // The newest edit per app, so an app glows when it was just worked on.
  const lastEdit = new Map<string, AppEditIn>();
  for (const e of input.appEdits ?? []) {
    const cur = lastEdit.get(e.slug);
    if (!cur || e.date > cur.date) lastEdit.set(e.slug, e);
  }

  add({ key: "you", type: "you", title: "You", weight: 1, links: [] });
  const hub = (of: ItemType) => {
    const key = `hub:${of}`;
    if (!nodes.has(key)) {
      add({ key, type: "hub", of, title: TYPE_META[of].label, weight: 0.85, links: [] });
      link("you", key);
    }
    return key;
  };
  const group = (of: ItemType, name: string) => {
    // A group named like its hub ("Apps" under Apps) would just be a second dot with the same label.
    if (slugify(name) === slugify(TYPE_META[of].label)) return hub(of);
    const key = `group:${of}:${slugify(name)}`;
    if (!nodes.has(key)) {
      add({ key, type: "group", of, title: name, weight: 0.5, links: [] });
      link(hub(of), key);
    }
    return key;
  };

  // --- apps and tasks (In Queue rows) -----------------------------------------
  const appNeedles: [string, string[]][] = [];
  for (const r of input.queue ?? []) {
    if (r.kind === "app") {
      const slug = r.id.replace(/^app:/, "");
      const key = `app:${slug}`;
      const edit = lastEdit.get(slug);
      if (!add({ key, type: "app", title: r.name, subtitle: r.group, detail: r.note ? `${r.blurb}\nLeft to do: ${r.note}` : r.blurb, state: r.state, weight: r.state === "wip" ? 0.55 : 0.45, links: [], href: r.href, ref: r.id, ...(edit ? { at: `${edit.date}T12:00:00.000Z`, by: "git" } : {}) }))
        continue;
      link(key, r.group ? group("app", r.group) : hub("app"));
      appNeedles.push([key, needles(r.name, slug)]);
    } else if (r.kind === "task") {
      const key = `task:${r.id}`;
      if (!add({ key, type: "task", title: r.name, subtitle: r.state === "wip" ? "Unfinished" : "Done", detail: r.note || r.blurb, state: r.state, weight: 0.6, links: [], href: r.href, ref: r.id })) continue;
      link(key, hub("task"));
    }
  }

  // --- skills ---------------------------------------------------------------------------
  const queueSkill = new Map((input.queue ?? []).filter((r) => r.kind === "skill").map((r) => [r.id.replace(/^skill:/, ""), r]));
  const skillNeedles: [string, string[]][] = [];
  for (const s of input.skills ?? []) {
    const key = `skill:${s.slug}`;
    const q = queueSkill.get(s.slug);
    if (!add({ key, type: "skill", title: s.title || s.slug, subtitle: s.categories.join(" · "), detail: s.overview, state: q?.state, weight: 0.45, links: [], command: s.command, ref: q?.id }))
      continue;
    // One category per skill (its main one): two would pull it into empty space between clusters.
    if (s.categories[0]) link(key, group("skill", s.categories[0]));
    if (!s.categories.length) link(key, hub("skill"));
    skillNeedles.push([key, needles(s.slug, s.title, ...s.nicknames.filter((n) => n.split(" ").length <= 3))]);
  }
  // A skill that names an app is wired to it ("unreal-game-builder" → the game creator, etc.).
  for (const s of input.skills ?? []) {
    const text = `${s.title} ${s.overview}`.toLowerCase();
    for (const [appKey, words] of appNeedles) if (mentions(text, words)) link(`skill:${s.slug}`, appKey);
  }

  // --- clients ----------------------------------------------------------------------------
  const clientNeedles: [string, string[]][] = [];
  const clientBySite = new Map<string, string>();
  const addClient = (id: string, name: string, clientName?: string) => {
    const key = `client:${slugify(id || name)}`;
    if (nodes.has(key)) return key;
    if (!add({ key, type: "client", title: name, subtitle: clientName ? `for ${clientName}` : "Client site", weight: 0.55, links: [], href: "/apps/client-review" })) return key;
    link(key, hub("client"));
    clientNeedles.push([key, needles(name, clientName)]);
    clientBySite.set(slugify(name), key);
    if (clientName) clientBySite.set(slugify(clientName), key);
    return key;
  };
  for (const c of input.clients ?? []) addClient(c.id, c.name, c.clientName);

  // --- crashes ------------------------------------------------------------------------------
  const crashes = [...(input.crashes ?? [])].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)).slice(0, LIMITS.crashes);
  for (const e of crashes) {
    const key = `crash:${e.id}`;
    if (!add({ key, type: "crash", title: e.message, subtitle: `${e.site} · ${e.count}×`, detail: e.urls.length ? `Pages: ${e.urls.join(", ")}` : undefined, weight: Math.min(1, 0.45 + Math.log10(1 + e.count) / 3), links: [], href: "/apps/jarvis#site-errors", ref: e.id, at: e.lastSeen }))
      continue;
    link(key, hub("crash"));
    if (e.site !== "hub") link(key, clientBySite.get(slugify(e.site)) ?? addClient(e.site, e.site));
    for (const u of e.urls) {
      const m = u.match(/\/apps\/([a-z0-9-]+)/);
      if (m) link(key, `app:${m[1]}`);
    }
  }

  // --- memories -------------------------------------------------------------------------------
  const memories = [...(input.memories ?? [])].filter((m) => m.source !== "skill" && m.source !== "vault").sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, LIMITS.memories);
  const targets = [...appNeedles, ...skillNeedles, ...clientNeedles];
  for (const m of memories) {
    const key = `memory:${m.id}`;
    if (!add({ key, type: "memory", title: m.title || m.content.slice(0, 60), subtitle: `${m.source} · ${m.capturedAt.slice(0, 10)}`, detail: m.content.slice(0, 600), weight: 0.35, links: [], ref: m.id, at: m.capturedAt })) continue;
    const text = `${m.title} ${m.content}`.toLowerCase();
    let wired = 0;
    for (const [k, words] of targets) {
      if (wired >= 4) break;
      if (mentions(text, words)) {
        link(key, k);
        wired += 1;
      }
    }
    // Only memories that touch nothing else hang off the hub, so the hub isn't a hairball.
    if (!wired) link(key, hub("memory"));
  }

  // --- vault notes --------------------------------------------------------------------------------
  const notes = (input.notes ?? []).filter((n) => n.kind === "note").sort((a, b) => b.strength - a.strength).slice(0, LIMITS.notes);
  for (const n of notes) add({ key: `note:${n.key}`, type: "note", title: n.title, subtitle: "Vault note", weight: 0.3 + n.strength * 0.4, links: [] });
  for (const n of notes) {
    let linked = 0;
    for (const l of n.links) if (nodes.has(`note:${l}`)) {
      link(`note:${n.key}`, `note:${l}`);
      linked += 1;
    }
    if (!linked) link(`note:${n.key}`, hub("note"));
  }
  // A note cluster with no path to "you" still needs one, or it drifts off alone.
  if (notes.length) link(hub("note"), `note:${notes[0].key}`);

  // --- the daily log: one node per day, wired to what it touched ------------------------
  const target = (about?: string): string | null => {
    if (!about) return null;
    const bare = about.replace(/^studio:/, "").replace(/^app:/, "").replace(/^skill:/, "");
    for (const k of [`app:${bare}`, `skill:${bare}`, `skill:${about}`, `client:${slugify(bare)}`]) if (nodes.has(k)) return k;
    return null;
  };
  for (const { day, entries } of (input.logs ?? []).slice(0, 14)) {
    if (!entries.length) continue;
    const key = `log:${day}`;
    const last = entries[entries.length - 1];
    const who = [...new Set(entries.map((e) => e.by))].join(", ");
    const label = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    if (!add({ key, type: "log", title: `Daily log · ${label}`, subtitle: `${entries.length} ${entries.length === 1 ? "entry" : "entries"} · ${who}`, detail: entries.slice(-12).map((e) => `${e.at.slice(11, 16)} ${e.by}: ${e.text}`).join("\n"), weight: Math.min(0.75, 0.35 + entries.length / 40), links: [], at: last.at, by: last.by }))
      continue;
    link(key, hub("log"));
    let wired = 0;
    for (const e of entries) {
      const t = target(e.about);
      if (t && wired < 6) {
        link(key, t);
        wired += 1;
      }
    }
  }

  // --- findings: one node per workflow, wired to its skill or app ---------------------------
  for (const [wf, list] of Object.entries(input.findings ?? {})) {
    if (!list.length) continue;
    const key = `finding:${wf}`;
    const last = list[list.length - 1];
    const misses = list.filter((f) => f.kind === "miss").length;
    if (!add({ key, type: "finding", title: `Findings · ${wf.replace(/^studio:/, "")}`, subtitle: `${list.length} lessons${misses ? ` · ${misses} to avoid` : ""}`, detail: list.slice(-10).map((f) => `${f.kind === "miss" ? "Avoid" : f.kind === "win" ? "Worked" : "Note"}: ${f.text}`).join("\n"), weight: Math.min(0.7, 0.35 + list.length / 30), links: [], at: last.at, by: last.by }))
      continue;
    link(key, hub("finding"));
    const t = target(wf);
    if (t) link(key, t);
  }

  // links on each node, for the inspector and the layout
  for (const [a, b] of edges.values()) {
    nodes.get(a)!.links.push(b);
    nodes.get(b)!.links.push(a);
  }
  // Hubs and groups grow with what they gather.
  for (const n of nodes.values()) {
    if (n.type === "hub" || n.type === "group") n.weight = Math.min(1, (n.type === "hub" ? 0.7 : 0.4) + n.links.length / 120);
  }

  const counts = Object.fromEntries(ITEM_TYPES.map((t) => [t, 0])) as Record<ItemType, number>;
  for (const n of nodes.values()) if (n.type in counts) counts[n.type as ItemType] += 1;

  return { nodes: [...nodes.values()], edges: [...edges.values()], counts };
}

/** Every node within `hops` of `key` — the web a click lights up. */
export function neighbourhood(graph: Pick<MapGraph, "nodes">, key: string, hops = 1): Set<string> {
  const by = new Map(graph.nodes.map((n) => [n.key, n]));
  const seen = new Set([key]);
  let frontier = [key];
  for (let h = 0; h < hops; h++) {
    const next: string[] = [];
    for (const k of frontier) for (const l of by.get(k)?.links ?? []) if (!seen.has(l)) {
      seen.add(l);
      next.push(l);
    }
    frontier = next;
  }
  return seen;
}

// ----- the timeline ------------------------------------------------------------------

export interface TimelineEvent {
  /** ISO. */
  at: string;
  /** The map node it points at, so a click flies there. */
  key: string;
  title: string;
  /** What changed, in a line. */
  what: string;
  type: MapType;
  by: string;
}

/**
 * Who changed what, newest first: app edits (git), what agents logged,
 * findings, memories saved, crashes seen. Every event points at a node that
 * is on the map, so clicking one flies to it.
 */
export function timelineOf(graph: Pick<MapGraph, "nodes">, input: MapInputs, limit = 150): TimelineEvent[] {
  const by = new Map(graph.nodes.map((n) => [n.key, n]));
  const out: TimelineEvent[] = [];
  const push = (key: string, at: string, what: string, who: string) => {
    const n = by.get(key);
    if (!n || !at) return;
    out.push({ at, key, title: n.title, what, type: n.type, by: who });
  };
  for (const e of input.appEdits ?? []) push(`app:${e.slug}`, `${e.date}T12:00:00.000Z`, e.title, "Claude Code (git)");
  for (const { day, entries } of input.logs ?? []) {
    for (const e of entries) {
      const bare = (e.about ?? "").replace(/^(studio|app|skill):/, "");
      const key = [`app:${bare}`, `skill:${bare}`].find((k) => bare && by.has(k)) ?? `log:${day}`;
      push(key, e.at, e.text, e.by);
    }
  }
  for (const [wf, list] of Object.entries(input.findings ?? {})) for (const f of list) push(`finding:${wf}`, f.at, `${f.kind === "miss" ? "Avoid" : f.kind === "win" ? "Worked" : "Note"}: ${f.text}`, f.by);
  for (const m of input.memories ?? []) push(`memory:${m.id}`, m.capturedAt, "Remembered", m.source);
  for (const c of input.crashes ?? []) push(`crash:${c.id}`, c.lastSeen, `Crashed (${c.count}×)`, c.site);
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** Keys of nodes changed within `days` of `now` — what the "since" filter lights up. */
export function changedSince(graph: Pick<MapGraph, "nodes">, events: TimelineEvent[], days: number, now = Date.now()): Set<string> {
  const cutoff = new Date(now - days * 86_400_000).toISOString();
  const out = new Set<string>();
  for (const e of events) if (e.at >= cutoff) out.add(e.key);
  for (const n of graph.nodes) if (n.at && n.at >= cutoff) out.add(n.key);
  return out;
}

/** Search across titles, subtitles, commands and detail. */
export function searchMap(graph: Pick<MapGraph, "nodes">, q: string): Set<string> {
  const words = q.toLowerCase().trim().replace(/^\//, "").split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  if (!words.length) return out;
  for (const n of graph.nodes) {
    const hay = `${n.title} ${n.subtitle ?? ""} ${n.command ?? ""} ${n.detail ?? ""}`.toLowerCase();
    if (words.every((w) => hay.includes(w))) out.add(n.key);
  }
  return out;
}
