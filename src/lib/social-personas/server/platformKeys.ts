// ---------------------------------------------------------------------------
// The developer-app keys each platform's login needs, saved from inside the
// app instead of the hosting dashboard.
//
// Connecting TikTok/Instagram/Facebook needs a developer app per platform —
// that's the platforms' rule, not ours. What we can remove is everything
// after: no environment variables, no redeploy. The owner pastes the two keys
// into Personas Studio › Connect setup once, they're kept server-side
// (server_docs: RLS on, no policy, service role only), and every person's
// Connect button works straight away. Env vars still win when set.
//
// The secret never goes back to the browser — only the last 4 characters of
// the public id, so the setup screen can show which key is in use.
// ---------------------------------------------------------------------------

import "server-only";

import path from "node:path";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import type { ConnectablePlatform } from "../types";

const DOC = "social-personas-platform-keys";
const dir = () => process.env.SOCIAL_PERSONAS_DATA_DIR || path.resolve(".data");

export interface SavedKey {
  id: string;
  secret: string;
  updatedAt: string;
}
type KeyDoc = Partial<Record<ConnectablePlatform, SavedKey>>;

let cache: { at: number; doc: KeyDoc } | null = null;

export async function savedKeys(): Promise<KeyDoc> {
  if (cache && Date.now() - cache.at < 30_000) return cache.doc;
  const doc = (await readDoc<KeyDoc>(DOC, dir())) ?? {};
  cache = { at: Date.now(), doc };
  return doc;
}

export async function saveKey(p: ConnectablePlatform, id: string, secret: string): Promise<boolean> {
  const doc = { ...(await savedKeys()), [p]: { id, secret, updatedAt: new Date().toISOString() } };
  const ok = await writeDoc(DOC, dir(), doc);
  if (ok) cache = { at: Date.now(), doc };
  return ok;
}

export async function clearKey(p: ConnectablePlatform): Promise<boolean> {
  const { [p]: _gone, ...rest } = await savedKeys();
  const ok = await writeDoc(DOC, dir(), rest);
  if (ok) cache = { at: Date.now(), doc: rest };
  return ok;
}

/** Plain checks before saving, so a pasted label or a swapped field is caught here, not at login. */
export function checkKey(p: ConnectablePlatform, id: string, secret: string): string | null {
  if (!id || !secret) return "Paste both keys.";
  if (id === secret) return "The two keys are the same — the second box needs the secret, not the id again.";
  if (/\s/.test(id) || /\s/.test(secret)) return "Keys have no spaces in them — check nothing extra was copied.";
  if (id.length < 8 || id.length > 120 || secret.length < 16 || secret.length > 200) return "Those don't look like the right keys — copy them from the app's Basic settings page.";
  if ((p === "instagram" || p === "facebook") && !/^\d+$/.test(id)) return "A Meta app id is all numbers. Copy the App ID from App settings › Basic.";
  if (p === "youtube" && !id.endsWith(".apps.googleusercontent.com")) return "A Google client ID ends in .apps.googleusercontent.com — copy the Client ID from your OAuth client.";
  return null;
}
