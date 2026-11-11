// ---------------------------------------------------------------------------
// Memory — the graph view of the same data the folder tree holds.
//
// The rule is one-way, deliberately:
//
//   every folder, item and profile becomes a memory node
//   a memory node is never a second copy of the data
//
// So the graph cannot drift. Reorganise a folder and the web moves with it;
// delete an item and its dot disappears. The extra edges (profile → note,
// profile → account, tag → entity) are relationships that already exist in the
// records — the graph just makes them visible.
// ---------------------------------------------------------------------------

import type { Folder, Item, Profile, RecallData } from "./types";
import { profileCompleteness, profileSearchText } from "./profiles";

export type MemoryNodeKind = "root" | "folder" | "item" | "profile" | "account" | "tag";

export interface MemoryNode {
  id: string;
  kind: MemoryNodeKind;
  label: string;
  /** One-line context shown in the inspector. */
  detail?: string;
  /** Lower-cased text used by memory search. */
  text?: string;
  folderId?: string | null;
  itemId?: string;
  profileId?: string;
  accountId?: string;
  tags?: string[];
  /** Relative drawing weight. */
  weight: number;
}

export type MemoryEdgeKind = "tree" | "profile" | "account" | "tag" | "link";

export interface MemoryEdge {
  id: string;
  from: string;
  to: string;
  kind: MemoryEdgeKind;
  label?: string;
}

export interface MemoryStats {
  folders: number;
  items: number;
  profiles: number;
  accounts: number;
  tags: number;
  connections: number;
  /** Items not drawn because the graph has a practical ceiling. */
  hiddenItems: number;
}

export interface MemoryGraph {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  stats: MemoryStats;
}

const MAX_ITEM_NODES = 420;
const MAX_TAGS = 12;

function pathOf(folders: Folder[], id: string | null | undefined): string {
  if (!id) return "Inbox";
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parts: string[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(" › ") || "Inbox";
}

function itemDetail(item: Item): string {
  return (item.summary || item.body || item.extract || "").replace(/\s+/g, " ").slice(0, 150);
}

function accountDetail(account: Profile["accounts"][number]): string {
  const bits = [
    account.provider,
    account.value ? `${account.currency ?? "USD"} ${account.value}` : "",
    account.renewalDate ? `renews ${account.renewalDate}` : "",
    account.openedDate ? `opened ${account.openedDate}` : "",
  ].filter(Boolean);
  return bits.join(" · ") || "No balance or dates yet";
}

function addEdge(edges: MemoryEdge[], seen: Set<string>, edge: MemoryEdge): void {
  const key = `${edge.from}|${edge.to}|${edge.kind}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push(edge);
}

/**
 * Build the web. Folders are the skeleton; profiles and their accounts hang
 * off their folder; tags cut across the tree so the result reads as a web
 * rather than a second folder browser.
 */
export function buildMemoryGraph(data: RecallData): MemoryGraph {
  const nodes: MemoryNode[] = [];
  const edges: MemoryEdge[] = [];
  const seen = new Set<string>();

  const root: MemoryNode = {
    id: "memory:root",
    kind: "root",
    label: "Memory",
    detail: "Everything Dashboard knows, in one web",
    weight: 30,
  };
  nodes.push(root);

  const folderById = new Map(data.folders.map((f) => [f.id, f]));
  const folderNodes = new Set<string>();
  for (const folder of [...data.folders].sort((a, b) => a.name.localeCompare(b.name))) {
    const id = `folder:${folder.id}`;
    folderNodes.add(folder.id);
    nodes.push({
      id,
      kind: "folder",
      label: folder.name,
      detail: pathOf(data.folders, folder.id),
      text: `${folder.name} ${folder.description ?? ""}`.toLowerCase(),
      folderId: folder.id,
      weight: folder.parentId ? 12 : 18,
    });
    const parent = folder.parentId && folderById.has(folder.parentId) ? `folder:${folder.parentId}` : root.id;
    addEdge(edges, seen, {
      id: `e:tree:${folder.id}`,
      from: parent,
      to: id,
      kind: "tree",
    });
  }

  // Profiles are subjects, not just another folder. Draw the card next to the
  // folder that owns it and give the accounts their own satellites.
  for (const profile of data.profiles) {
    const id = `profile:${profile.id}`;
    const completeness = profileCompleteness(profile);
    nodes.push({
      id,
      kind: "profile",
      label: profile.displayName,
      detail: `${profile.kind === "business" ? "Business" : "Person"} · ${completeness.known}/${completeness.total} details · ${profile.accounts.length} account${profile.accounts.length === 1 ? "" : "s"}`,
      text: profileSearchText(profile),
      folderId: profile.folderId,
      profileId: profile.id,
      tags: profile.tags,
      weight: 22,
    });
    const folderTarget =
      profile.folderId && folderNodes.has(profile.folderId) ? `folder:${profile.folderId}` : root.id;
    addEdge(edges, seen, {
      id: `e:profile:${profile.id}`,
      from: folderTarget,
      to: id,
      kind: "profile",
    });
    if (profile.itemId && data.items.some((it) => it.id === profile.itemId)) {
      addEdge(edges, seen, {
        id: `e:profile-note:${profile.id}`,
        from: id,
        to: `item:${profile.itemId}`,
        kind: "link",
        label: "record",
      });
    }
    for (const account of profile.accounts) {
      const aid = `account:${profile.id}:${account.id}`;
      nodes.push({
        id: aid,
        kind: "account",
        label: account.label,
        detail: accountDetail(account),
        text: [account.label, account.provider, account.kind, account.login, account.notes]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
        profileId: profile.id,
        accountId: account.id,
        weight: 9,
      });
      addEdge(edges, seen, {
        id: `e:account:${profile.id}:${account.id}`,
        from: id,
        to: aid,
        kind: "account",
      });
    }
  }

  const sortedItems = [...data.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const drawnItems = sortedItems.slice(0, MAX_ITEM_NODES);
  for (const item of drawnItems) {
    const id = `item:${item.id}`;
    nodes.push({
      id,
      kind: "item",
      label: item.title,
      detail: itemDetail(item),
      text: `${item.title} ${item.summary} ${item.body.slice(0, 1400)} ${item.extract?.slice(0, 1400) ?? ""} ${Object.values(item.fields ?? {}).join(" ")} ${item.tags.join(" ")} ${item.kind}`.toLowerCase(),
      folderId: item.folderId,
      itemId: item.id,
      tags: item.tags,
      weight: item.kind === "note" ? 7 : 6,
    });
    const target = item.folderId && folderNodes.has(item.folderId) ? `folder:${item.folderId}` : root.id;
    addEdge(edges, seen, {
      id: `e:item:${item.id}`,
      from: target,
      to: id,
      kind: "tree",
    });
  }

  // Tags are counted across every entity. Only recurring tags become hubs —
  // one-off tags would turn the outer ring into noise.
  const tagCount = new Map<string, number>();
  for (const item of data.items) for (const tag of item.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
  for (const profile of data.profiles)
    for (const tag of profile.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);

  const topTags = [...tagCount.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TAGS);

  const tagSet = new Set(topTags.map(([tag]) => tag));
  for (const [tag, count] of topTags) {
    const id = `tag:${tag}`;
    nodes.push({
      id,
      kind: "tag",
      label: tag,
      detail: `${count} linked record${count === 1 ? "" : "s"}`,
      text: tag.toLowerCase(),
      tags: [tag],
      weight: 8,
    });
    for (const item of drawnItems) {
      if (item.tags.includes(tag)) {
        addEdge(edges, seen, {
          id: `e:tag:${tag}:${item.id}`,
          from: id,
          to: `item:${item.id}`,
          kind: "tag",
        });
      }
    }
    for (const profile of data.profiles) {
      if (profile.tags.includes(tag)) {
        addEdge(edges, seen, {
          id: `e:tag:${tag}:p:${profile.id}`,
          from: id,
          to: `profile:${profile.id}`,
          kind: "tag",
        });
      }
    }
  }

  // A domain account points at the note or website that records the same
  // domain. That is the "how are these connected" edge the folder tree cannot
  // show on its own.
  for (const profile of data.profiles) {
    for (const account of profile.accounts) {
      if (account.kind !== "domain") continue;
      const needle = (account.url ?? account.label)
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0]
        .toLowerCase();
      if (!needle) continue;
      const match = drawnItems.find((it) => {
        const hay = `${it.title} ${it.url ?? ""} ${it.body} ${it.extract ?? ""}`.toLowerCase();
        return hay.includes(needle);
      });
      if (match) {
        addEdge(edges, seen, {
          id: `e:domain:${profile.id}:${account.id}:${match.id}`,
          from: `account:${profile.id}:${account.id}`,
          to: `item:${match.id}`,
          kind: "link",
          label: "domain",
        });
      }
    }
  }

  // Do not leave an edge pointing at a node that was capped away.
  const nodeIds = new Set(nodes.map((n) => n.id));
  const validEdges = edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  return {
    nodes,
    edges: validEdges,
    stats: {
      folders: data.folders.length,
      items: data.items.length,
      profiles: data.profiles.length,
      accounts: data.profiles.reduce((n, p) => n + p.accounts.length, 0),
      tags: tagSet.size,
      connections: validEdges.length,
      hiddenItems: Math.max(0, data.items.length - drawnItems.length),
    },
  };
}

export function memoryNeighbors(graph: MemoryGraph, id: string): { node: MemoryNode; edge: MemoryEdge }[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: { node: MemoryNode; edge: MemoryEdge }[] = [];
  for (const edge of graph.edges) {
    if (edge.from === id && byId.has(edge.to)) out.push({ node: byId.get(edge.to)!, edge });
    else if (edge.to === id && byId.has(edge.from)) out.push({ node: byId.get(edge.from)!, edge });
  }
  return out;
}

/** Search across labels, details and the pre-computed lower-case text. */
export function searchMemory(graph: MemoryGraph, query: string): MemoryNode[] {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];
  const scored: { node: MemoryNode; score: number }[] = [];
  for (const node of graph.nodes) {
    if (node.kind === "root") continue;
    const label = node.label.toLowerCase();
    const hay = `${label} ${node.detail ?? ""} ${node.text ?? ""}`;
    let score = 0;
    for (const token of tokens) {
      if (label.includes(token)) score += 6;
      else if (hay.includes(token)) score += 2;
    }
    if (score > 0) scored.push({ node, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.node.label.localeCompare(b.node.label))
    .slice(0, 12)
    .map((s) => s.node);
}
