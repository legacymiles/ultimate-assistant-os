import "server-only";

// ---------------------------------------------------------------------------
// Where Text Inbox keeps each account's texts: one server document per account
// in public.server_docs (service role only, no migration), or a file locally —
// the same pattern as iPhone Notes and Find My Life. Other people's messages
// are private, so the browser never reads the table; the routes hand each
// account its own copy and nothing else.
//
//   .text-inbox.<uid>.json      the account's texts, drafts, style and push devices
//   .text-inbox-keys.json       Shortcut key → account (Shortcuts has no session)
// ---------------------------------------------------------------------------

import { randomBytes } from "node:crypto";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import { dataDir } from "@/lib/recall/dataDir";
import { normalizeDoc, prune, type TextDoc } from "../engine";

const KEYS = ".text-inbox-keys.json";
const NO_HOST = "Your texts couldn't be saved on this host. On the live site it needs SUPABASE_SERVICE_ROLE_KEY.";

const safe = (uid: string) => uid.replace(/[^a-zA-Z0-9-]/g, "");
const docName = (uid: string) => `.text-inbox.${safe(uid)}.json`;

export async function readTexts(uid: string): Promise<TextDoc> {
  return normalizeDoc(await readDoc<TextDoc>(docName(uid), dataDir()));
}

/**
 * Read, change, write. Re-reads right before the change so a text arriving
 * while the user approves another one doesn't overwrite it.
 */
export async function updateTexts<T>(uid: string, change: (doc: TextDoc) => { doc: TextDoc; out: T }): Promise<{ doc: TextDoc; out: T }> {
  const { doc, out } = change(await readTexts(uid));
  const next = prune(doc);
  if (!(await writeDoc(docName(uid), dataDir(), next))) throw new Error(NO_HOST);
  return { doc: next, out };
}

type KeyIndex = { keys: Record<string, string> };

async function readKeys(): Promise<KeyIndex> {
  const raw = await readDoc<KeyIndex>(KEYS, dataDir());
  return { keys: raw && typeof raw.keys === "object" && raw.keys ? raw.keys : {} };
}

/** This account's Shortcut key, made the first time it's asked for. Rotating stops old Shortcuts. */
export async function keyFor(uid: string, rotate = false): Promise<string> {
  const index = await readKeys();
  const existing = Object.entries(index.keys).find(([, owner]) => owner === uid)?.[0];
  if (existing && !rotate) return existing;
  const keys = Object.fromEntries(Object.entries(index.keys).filter(([, owner]) => owner !== uid));
  const key = randomBytes(18).toString("hex");
  keys[key] = uid;
  if (!(await writeDoc(KEYS, dataDir(), { keys }))) {
    throw new Error("Couldn't make your Shortcut links on this host. On the live site it needs SUPABASE_SERVICE_ROLE_KEY.");
  }
  return key;
}

export async function uidForKey(key: string): Promise<string | null> {
  if (!/^[a-f0-9]{24,64}$/.test(key)) return null;
  return (await readKeys()).keys[key] ?? null;
}
