import "server-only";

// ---------------------------------------------------------------------------
// Where iPhone Notes keeps each account's notes: one server document per
// account in public.server_docs (service role only, no migration), or a file
// locally — the same pattern as Find My Life. Notes are personal, so the
// browser never reads the table; the routes hand each account its own copy.
//
//   .iphone-notes.<uid>.json      the account's notes, decisions and habits
//   .iphone-notes-keys.json       Shortcut key → account (Shortcuts has no session)
// ---------------------------------------------------------------------------

import { randomBytes } from "node:crypto";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import { dataDir } from "@/lib/recall/dataDir";
import { normalizeDoc, type NotesDoc } from "../engine";

const KEYS = ".iphone-notes-keys.json";
const NO_HOST = "Your notes couldn't be saved on this host. On the live site it needs SUPABASE_SERVICE_ROLE_KEY.";

const safe = (uid: string) => uid.replace(/[^a-zA-Z0-9-]/g, "");
const docName = (uid: string) => `.iphone-notes.${safe(uid)}.json`;

export async function readNotes(uid: string): Promise<NotesDoc> {
  return normalizeDoc(await readDoc<NotesDoc>(docName(uid), dataDir()));
}

/**
 * Read, change, write. Re-reads right before writing so two pushes landing
 * together (the Shortcut sends notes one after another) don't overwrite each
 * other's note — the change runs against the newest copy.
 */
export async function updateNotes<T>(uid: string, change: (doc: NotesDoc) => { doc: NotesDoc; out: T }): Promise<{ doc: NotesDoc; out: T }> {
  const { doc, out } = change(await readNotes(uid));
  if (!(await writeDoc(docName(uid), dataDir(), doc))) throw new Error(NO_HOST);
  return { doc, out };
}

type KeyIndex = { keys: Record<string, string> };

async function readKeys(): Promise<KeyIndex> {
  const raw = await readDoc<KeyIndex>(KEYS, dataDir());
  return { keys: raw && typeof raw.keys === "object" && raw.keys ? raw.keys : {} };
}

/** This account's Shortcut key, made the first time it's asked for. Rotating stops old Shortcuts. */
export async function pushKeyFor(uid: string, rotate = false): Promise<string> {
  const index = await readKeys();
  const existing = Object.entries(index.keys).find(([, owner]) => owner === uid)?.[0];
  if (existing && !rotate) return existing;
  const keys = Object.fromEntries(Object.entries(index.keys).filter(([, owner]) => owner !== uid));
  const key = randomBytes(18).toString("hex");
  keys[key] = uid;
  if (!(await writeDoc(KEYS, dataDir(), { keys }))) {
    throw new Error("Couldn't make your Shortcut link on this host. On the live site it needs SUPABASE_SERVICE_ROLE_KEY.");
  }
  return key;
}

export async function uidForPushKey(key: string): Promise<string | null> {
  if (!/^[a-f0-9]{24,64}$/.test(key)) return null;
  return (await readKeys()).keys[key] ?? null;
}
