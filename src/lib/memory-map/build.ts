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
// at the app it builds. Pure — tested without a browser.
// ---------------------------------------------------------------------------

export type MapType = "you" | "hub" | "group" | "app" | "skill" | "client" | "crash" | "task" | "memory" | "note";

export const TYPE_META: Record<Exclude<MapType, "you" | "hub" | "group">, { label: string; color: string }> = {
  app: { label: "Apps", color: "#47e8ff" },
  skill: { label: "Skills", color: "#b48cff" },
  client: { label: "Clients", color: "#5bf0a5" },
  crash: { label: "Crashes", color: "#ff5c7a" },
  task: { label: "Tasks", color: "#ffb547" },
  memory: { label: "Memories", color: "#7aa7ff" },
  note: { label: "Notes", color: "#e9ecf3" },
};

export type ItemType = keyof typeof TYPE_META;
export const ITEM_TYPES = Object.keys(TYPE_META) as ItemType[];

export interface MapNode {
  key: string;
  type: MapType;
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

export interface MapInputs {
  queue?: QueueRowIn[];
  skills?: SkillIn[];
  crashes?: CrashIn[];
  clients?: ClientIn[];
  memories?: MemoryIn[];
  notes?: NoteIn[];
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
    nodes.set(n.key, n);
    return true;
  };

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
      if (!add({ key, type: "app", title: r.name, subtitle: r.group, detail: r.note ? `${r.blurb}\nLeft to do: ${r.note}` : r.blurb, state: r.state, weight: r.state === "wip" ? 0.55 : 0.45, links: [], href: r.href, ref: r.id }))
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
