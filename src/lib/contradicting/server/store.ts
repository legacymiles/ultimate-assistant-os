import "server-only";

// ---------------------------------------------------------------------------
// Where Contradicting keeps its record: one server document per account in
// public.server_docs (service role only, no migration), or a file locally.
// Per account because the app is for other people too — nobody's record is
// anyone else's, and the browser never reads the table directly.
//
// The recorder (Omi) has no session, so each account gets a private webhook
// key. The index from key to account is its own small document.
// ---------------------------------------------------------------------------

import { randomBytes } from "node:crypto";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import { dataDir } from "@/lib/recall/dataDir";
import { normalizeDoc, prune, type Doc } from "../engine";

const KEYS = ".contradicting-keys.json";

function docName(uid: string): string {
  return `.contradicting.${uid.replace(/[^a-zA-Z0-9-]/g, "")}.json`;
}

export async function readRecord(uid: string): Promise<Doc> {
  return normalizeDoc(await readDoc<Doc>(docName(uid), dataDir()));
}

/** Read, change, write. Throws a plain-English error when the host keeps nothing. */
export async function updateRecord<T>(uid: string, change: (doc: Doc) => { doc: Doc; out: T }): Promise<{ doc: Doc; out: T }> {
  const { doc, out } = change(await readRecord(uid));
  const next = prune(doc, new Date());
  const saved = await writeDoc(docName(uid), dataDir(), next);
  if (!saved) {
    throw new Error("Your record couldn't be saved on this host. On the live site it needs SUPABASE_SERVICE_ROLE_KEY.");
  }
  return { doc: next, out };
}

type KeyIndex = { keys: Record<string, string> };

async function readKeys(): Promise<KeyIndex> {
  const raw = await readDoc<KeyIndex>(KEYS, dataDir());
  return { keys: raw && typeof raw.keys === "object" && raw.keys ? raw.keys : {} };
}

/** This account's recorder key, made the first time it's asked for. */
export async function keyFor(uid: string, rotate = false): Promise<string> {
  const index = await readKeys();
  const existing = Object.entries(index.keys).find(([, owner]) => owner === uid)?.[0];
  if (existing && !rotate) return existing;
  const keys = Object.fromEntries(Object.entries(index.keys).filter(([, owner]) => owner !== uid));
  const key = randomBytes(18).toString("hex");
  keys[key] = uid;
  const saved = await writeDoc(KEYS, dataDir(), { keys });
  if (!saved) throw new Error("Couldn't make your recorder link on this host. On the live site it needs SUPABASE_SERVICE_ROLE_KEY.");
  return key;
}

export async function uidForKey(key: string): Promise<string | null> {
  if (!/^[a-f0-9]{24,64}$/.test(key)) return null;
  return (await readKeys()).keys[key] ?? null;
}
