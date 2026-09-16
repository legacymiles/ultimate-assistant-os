import type { Folder, Item } from "@/lib/recall/types";

// ---------------------------------------------------------------------------
// Google Drive backup — what goes where.
//
// The shape on Drive mirrors the Folders tab:
//
//   Ultimate Assistant OS/
//     Photos/      the photo albums, sub-folders as they are in the app
//     Folders/     every other folder, nested exactly as it is in the app
//       Unfiled/   items that sit in no folder (only when there are some)
//
// Three decisions shape this file:
//
// 1. Identity, not names. Every Drive file and folder carries the Dashboard id
//    it came from (appProperties.dashboardKey). Matching on that — never on the
//    name — is what makes a renamed or moved folder move on Drive instead of
//    appearing twice, and what stops a second device re-uploading everything.
//
// 2. Never delete. The user chose a backup, not a mirror: something deleted in
//    Dashboard stays on Drive as a safety copy. So a plan has no delete step at
//    all; there is nothing here that could remove a file.
//
// 3. Never a password. Saved logins go into a per-folder list by site and
//    username, and every field that looks like a secret is dropped before the
//    text is built. The password itself never leaves the device.
//
// Pure, so the rules that decide what is uploaded — and what is not — are
// tested directly.
// ---------------------------------------------------------------------------

/** Marks Drive files as this app's, so a listing never touches anything else. */
export const APP_VALUE = "ultimate-assistant-os";
export const ROOT_NAME = "Ultimate Assistant OS";
export const PHOTOS_NAME = "Photos";
export const FOLDERS_NAME = "Folders";
export const UNFILED_NAME = "Unfiled";
export const SUMMARY_NAME = "Links, to-dos & logins";
export const GOOGLE_DOC = "application/vnd.google-apps.document";

/** What a Drive listing returns for one of this app's files or folders. */
export interface DriveEntry {
  id: string;
  name: string;
  parents?: string[];
  mimeType?: string;
  appProperties?: Record<string, string>;
}

/** A place in the plan before it has a Drive id: "root", "photos", "folder:<id>"… */
export type NodeKey = string;

export interface FolderStep {
  key: NodeKey;
  name: string;
  /** null only for the root. */
  parentKey: NodeKey | null;
  /** Already on Drive, found by its Dashboard id. */
  existing?: DriveEntry;
  props: Record<string, string>;
}

export type FileSource =
  /** An uploaded photo or file, read from this device's storage at run time. */
  | { type: "blob"; fileId: string; mime: string }
  /** Text that becomes a Google Doc. */
  | { type: "doc"; text: string };

export interface FileStep {
  key: string;
  name: string;
  parentKey: NodeKey;
  existing?: DriveEntry;
  /** Changes whenever the content does; stored on Drive to skip unchanged files. */
  version: string;
  /** True when Drive does not have this version yet. */
  changed: boolean;
  source: FileSource;
  props: Record<string, string>;
}

export interface BackupPlan {
  /** Parents always come before their children. */
  folders: FolderStep[];
  files: FileStep[];
  /** Items that cannot be backed up at all, with why. */
  notBackedUp: { title: string; reason: string }[];
}

/** Kinds that are a line in a folder's list rather than a file of their own. */
const LIST_KINDS = new Set<Item["kind"]>(["link", "website", "todo", "credential", "drive"]);

/** Field names that may hold a secret. Dropped before any text is built. */
const SECRET_FIELD = /pass|secret|token|pin|key|otp|2fa/i;

/** Safe as a Drive file name: no slashes, no runs of whitespace, not too long. */
export function cleanName(name: string): string {
  const out = name.replace(/[\\/]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
  return out || "Untitled";
}

/** A short, stable fingerprint of some text, so unchanged lists are not re-uploaded. */
export function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return `h${h.toString(36)}-${text.length}`;
}

/** A note as a readable document. */
export function noteText(item: Item): string {
  return [
    item.title,
    item.tags.length ? `Tags: ${item.tags.join(", ")}` : "",
    item.body || item.summary || "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * One folder's links, websites, to-dos and saved logins as readable text.
 * Logins are listed by site and username only — never a password.
 */
export function folderListText(items: readonly Item[]): string {
  const byTitle = (a: Item, b: Item) => a.title.localeCompare(b.title);
  const links = items.filter((i) => i.kind === "link" || i.kind === "website").sort(byTitle);
  const todos = items.filter((i) => i.kind === "todo").sort(byTitle);
  const logins = items.filter((i) => i.kind === "credential").sort(byTitle);
  const drive = items.filter((i) => i.kind === "drive").sort(byTitle);

  const safeFields = (i: Item) =>
    Object.entries(i.fields ?? {})
      .filter(([k, v]) => v && !SECRET_FIELD.test(k))
      .map(([k, v]) => `${k}: ${v}`);

  const sections: string[] = [];
  if (links.length) {
    sections.push(
      ["Links & websites", ...links.map((i) => `- ${i.title}${i.url ? ` — ${i.url}` : ""}`)].join("\n"),
    );
  }
  if (todos.length) {
    sections.push(["To-dos", ...todos.map((i) => `- [${i.done ? "x" : " "}] ${i.title}`)].join("\n"));
  }
  if (logins.length) {
    sections.push(
      [
        "Logins (passwords are not backed up)",
        ...logins.map((i) => {
          const bits = [i.url ? `site: ${i.url}` : "", ...safeFields(i)].filter(Boolean);
          return `- ${i.title}${bits.length ? ` — ${bits.join(" — ")}` : ""}`;
        }),
      ].join("\n"),
    );
  }
  if (drive.length) {
    sections.push(
      ["From Google Drive", ...drive.map((i) => `- ${i.title}${i.url ? ` — ${i.url}` : ""}`)].join("\n"),
    );
  }
  return sections.join("\n\n");
}

/** Everything that should exist on Drive, and which of it Drive already has. */
export function buildPlan(
  folders: readonly Folder[],
  items: readonly Item[],
  index: readonly DriveEntry[],
): BackupPlan {
  const byKey = new Map<string, DriveEntry>();
  for (const e of index) {
    const key = e.appProperties?.dashboardKey;
    if (key && e.appProperties?.dashboardApp === APP_VALUE && !byKey.has(key)) byKey.set(key, e);
  }

  // Matched by role first, then by name — the same two-step the app itself
  // uses. A Photos folder made before the role existed is still the photo root,
  // and backing it up as an ordinary folder would put the albums in the wrong
  // half of the Drive tree.
  const photosRoot =
    folders.find((f) => f.parentId === null && f.role === "photos") ??
    folders.find((f) => f.parentId === null && f.name.toLowerCase() === PHOTOS_NAME.toLowerCase());
  const keyOf = (folderId: string | null): NodeKey =>
    folderId === null ? "unfiled" : photosRoot && folderId === photosRoot.id ? "photos" : `folder:${folderId}`;

  const folderSteps: FolderStep[] = [];
  const addFolder = (key: NodeKey, name: string, parentKey: NodeKey | null) =>
    folderSteps.push({
      key,
      name: cleanName(name),
      parentKey,
      existing: byKey.get(key),
      props: { dashboardApp: APP_VALUE, dashboardKey: key },
    });

  addFolder("root", ROOT_NAME, null);
  addFolder("photos", PHOTOS_NAME, "root");
  addFolder("folders", FOLDERS_NAME, "root");

  const childrenOf = (parentId: string | null) =>
    folders.filter((f) => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));

  // Depth-first from the top, so a parent is always created before its child.
  // The visited set is belt and braces: the app refuses to create a cycle, but
  // a backup must never loop forever on data it did not write.
  const visited = new Set<string>();
  const walk = (parentId: string, parentKey: NodeKey) => {
    for (const f of childrenOf(parentId)) {
      if (visited.has(f.id)) continue;
      visited.add(f.id);
      addFolder(`folder:${f.id}`, f.name, parentKey);
      walk(f.id, `folder:${f.id}`);
    }
  };
  if (photosRoot) {
    visited.add(photosRoot.id);
    walk(photosRoot.id, "photos");
  }
  for (const f of childrenOf(null)) {
    if (visited.has(f.id)) continue;
    visited.add(f.id);
    addFolder(`folder:${f.id}`, f.name, "folders");
    walk(f.id, `folder:${f.id}`);
  }

  const known = new Set(folderSteps.map((s) => s.key));
  const files: FileStep[] = [];
  const notBackedUp: BackupPlan["notBackedUp"] = [];
  const lists = new Map<NodeKey, Item[]>();
  let needUnfiled = false;

  const fileStep = (key: string, name: string, parentKey: NodeKey, version: string, source: FileSource) => {
    const existing = byKey.get(key);
    files.push({
      key,
      name: cleanName(name),
      parentKey,
      existing,
      version,
      changed: !existing || existing.appProperties?.dashboardVersion !== version,
      source,
      props: { dashboardApp: APP_VALUE, dashboardKey: key, dashboardVersion: version },
    });
  };

  for (const item of items) {
    // An item whose folder no longer exists still gets backed up, in Unfiled.
    let parentKey = keyOf(item.folderId);
    if (parentKey !== "unfiled" && !known.has(parentKey)) parentKey = "unfiled";
    if (parentKey === "unfiled") needUnfiled = true;

    if (LIST_KINDS.has(item.kind)) {
      const list = lists.get(parentKey) ?? [];
      list.push(item);
      lists.set(parentKey, list);
      continue;
    }

    const fileId = item.attachment?.fileId;
    if (fileId) {
      fileStep(`item:${item.id}`, item.attachment?.name || item.title, parentKey, item.updatedAt, {
        type: "blob",
        fileId,
        mime: item.attachment?.type || "application/octet-stream",
      });
      continue;
    }

    if (item.kind === "image" || item.kind === "file") {
      notBackedUp.push({ title: item.title, reason: "only a preview was ever saved, not the file itself" });
      continue;
    }

    fileStep(`item:${item.id}`, item.title, parentKey, item.updatedAt, { type: "doc", text: noteText(item) });
  }

  if (needUnfiled) {
    folderSteps.splice(3, 0, {
      key: "unfiled",
      name: UNFILED_NAME,
      parentKey: "folders",
      existing: byKey.get("unfiled"),
      props: { dashboardApp: APP_VALUE, dashboardKey: "unfiled" },
    });
  }

  for (const [folderKey, list] of lists) {
    const text = folderListText(list);
    if (text) fileStep(`list:${folderKey}`, SUMMARY_NAME, folderKey, hashText(text), { type: "doc", text });
  }

  return { folders: folderSteps, files, notBackedUp };
}
