import "server-only";

// ---------------------------------------------------------------------------
// Where Find My Life keeps each account's things: one server document per
// account in public.server_docs (service role only, no migration), or a file
// locally. Locations are personal, so the browser never reads the table; the
// route layer hands each account its own copy and nothing else.
//
// Three documents:
//   .find-my-life.<uid>.json        the account's devices, history and places
//   .find-my-life-keys.json         ping key → account (Shortcuts has no session)
//   .find-my-life-car.<uid>.json    Smartcar tokens — server only, never sent out
// ---------------------------------------------------------------------------

import { randomBytes } from "node:crypto";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import { dataDir } from "@/lib/recall/dataDir";
import { normalizeDoc, prune, type Doc } from "../engine";

const KEYS = ".find-my-life-keys.json";
const NO_HOST = "Your devices couldn't be saved on this host. On the live site it needs SUPABASE_SERVICE_ROLE_KEY.";

const safe = (uid: string) => uid.replace(/[^a-zA-Z0-9-]/g, "");
const docName = (uid: string) => `.find-my-life.${safe(uid)}.json`;
const carName = (uid: string) => `.find-my-life-car.${safe(uid)}.json`;

export async function readFind(uid: string): Promise<Doc> {
  return normalizeDoc(await readDoc<Doc>(docName(uid), dataDir()));
}

/** Read, change, write — one place, so every change is pruned the same way. */
export async function updateFind<T>(uid: string, change: (doc: Doc) => { doc: Doc; out: T }): Promise<{ doc: Doc; out: T }> {
  const { doc, out } = change(await readFind(uid));
  const next = prune(doc, new Date());
  if (!(await writeDoc(docName(uid), dataDir(), next))) throw new Error(NO_HOST);
  return { doc: next, out };
}

export async function wipeFind(uid: string): Promise<void> {
  if (!(await writeDoc(docName(uid), dataDir(), normalizeDoc(null)))) throw new Error(NO_HOST);
  await writeDoc(carName(uid), dataDir(), {});
}

// --- ping keys ---------------------------------------------------------------

type KeyIndex = { keys: Record<string, string> };

async function readKeys(): Promise<KeyIndex> {
  const raw = await readDoc<KeyIndex>(KEYS, dataDir());
  return { keys: raw && typeof raw.keys === "object" && raw.keys ? raw.keys : {} };
}

/** This account's ping key, made the first time it's asked for. Rotating kills old Shortcuts. */
export async function pingKeyFor(uid: string, rotate = false): Promise<string> {
  const index = await readKeys();
  const existing = Object.entries(index.keys).find(([, owner]) => owner === uid)?.[0];
  if (existing && !rotate) return existing;
  const keys = Object.fromEntries(Object.entries(index.keys).filter(([, owner]) => owner !== uid));
  const key = randomBytes(18).toString("hex");
  keys[key] = uid;
  if (!(await writeDoc(KEYS, dataDir(), { keys }))) throw new Error("Couldn't make your Shortcut link on this host. On the live site it needs SUPABASE_SERVICE_ROLE_KEY.");
  return key;
}

export async function uidForPingKey(key: string): Promise<string | null> {
  if (!/^[a-f0-9]{24,64}$/.test(key)) return null;
  return (await readKeys()).keys[key] ?? null;
}

// --- car tokens (server only) --------------------------------------------------

export interface CarTokens {
  /** Smartcar's id for the person who connected their car (sent as sc-user-id). */
  scUserId?: string;
  /** When we last asked the cars where they are, so we don't hammer the API. */
  lastFetch?: number;
  /** One-time Connect state, to match the callback to this account (and stop forgery). */
  state?: string;
  stateAt?: number;
}

export async function readCar(uid: string): Promise<CarTokens> {
  return (await readDoc<CarTokens>(carName(uid), dataDir())) ?? {};
}

export async function writeCar(uid: string, tokens: CarTokens): Promise<void> {
  await writeDoc(carName(uid), dataDir(), tokens);
}
