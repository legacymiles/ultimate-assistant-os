// ---------------------------------------------------------------------------
// Folders — what a folder card says about itself.
//
// Pure, so the cards, the tree and the tests read the same numbers: how many
// things live in a folder and everything nested under it, by kind; its direct
// sub-folders; the newest thing inside; and the library's size and depth.
// ---------------------------------------------------------------------------

import type { Folder, Item, ItemKind } from "./types";

export type KindBucket = "notes" | "files" | "logins" | "links" | "to-dos" | "websites";

const BUCKET: Record<ItemKind, KindBucket> = {
  note: "notes",
  file: "files",
  image: "files",
  drive: "files",
  credential: "logins",
  link: "links",
  todo: "to-dos",
  website: "websites",
};

/** The order a card lists kinds in when it has room for only a few. */
const ORDER: KindBucket[] = ["notes", "files", "logins", "links", "to-dos", "websites"];

/** Every folder id under (and including) `rootId`, any depth. */
export function subtreeIds(folders: Folder[], rootId: string): Set<string> {
  const kids = new Map<string | null, string[]>();
  for (const f of folders) kids.set(f.parentId, [...(kids.get(f.parentId) ?? []), f.id]);
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(kids.get(id) ?? []));
  }
  return out;
}

export interface FolderSummary {
  total: number;
  kinds: { bucket: KindBucket; count: number }[];
  /** Direct sub-folders, A–Z. */
  subs: Folder[];
  latest: Item | null;
  /** The newest change inside — an item's update, else the folder's own creation. */
  updatedAt: string | null;
}

export function folderSummary(folders: Folder[], items: Item[], folderId: string): FolderSummary {
  const ids = subtreeIds(folders, folderId);
  const inside = items.filter((i) => i.folderId && ids.has(i.folderId));
  const counts = new Map<KindBucket, number>();
  let latest: Item | null = null;
  for (const it of inside) {
    const b = BUCKET[it.kind] ?? "notes";
    counts.set(b, (counts.get(b) ?? 0) + 1);
    if (!latest || (it.updatedAt || it.createdAt) > (latest.updatedAt || latest.createdAt)) latest = it;
  }
  const self = folders.find((f) => f.id === folderId);
  return {
    total: inside.length,
    kinds: ORDER.filter((b) => counts.get(b)).map((bucket) => ({ bucket, count: counts.get(bucket)! })),
    subs: folders.filter((f) => f.parentId === folderId).sort((a, b) => a.name.localeCompare(b.name)),
    latest,
    updatedAt: latest ? latest.updatedAt || latest.createdAt : (self?.createdAt ?? null),
  };
}

/** "248 items · 14 folders · 3 levels deep" — the library at a glance. */
export function libraryStats(folders: Folder[], items: Item[]): { items: number; folders: number; depth: number } {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let depth = 0;
  for (const f of folders) {
    let d = 1;
    let cur = f.parentId ? byId.get(f.parentId) : undefined;
    for (let guard = 0; cur && guard < 64; guard += 1) {
      d += 1;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    depth = Math.max(depth, d);
  }
  return { items: items.length, folders: folders.length, depth };
}

/** "just now", "18 min ago", "3 h ago", "yesterday", "4 days ago", "Nov 12". */
export function relTime(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((now - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
