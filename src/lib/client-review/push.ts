// ---------------------------------------------------------------------------
// Telling the client, even with the tab closed.
//
// Web Push, signed with VAPID keys. Nobody has to make those keys: the first
// time push is needed this deploy generates a pair itself (free — it is just a
// key pair, the same thing `npx web-push generate-vapid-keys` prints) and keeps
// it in the server's own store, so every later request signs with the same
// pair. Env vars CLIENT_REVIEW_VAPID_PUBLIC_KEY / _PRIVATE_KEY still win when
// set, for anyone who wants to pin them.
//
// Never use a website that hands you a private key: whoever made it has it too.
//
// On iPhone push needs the link added to the Home Screen first — Safari only
// delivers push to an installed web app — which the client's Settings says.
// ---------------------------------------------------------------------------

import "server-only";

import path from "node:path";
import webpush from "web-push";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import type { ClientProject } from "./types";

const KEY_DOC = ".client-review-vapid.json";
const SUBJECT = process.env.CLIENT_REVIEW_VAPID_SUBJECT || "mailto:notifications@ultimate-assistant-os.vercel.app";

interface Keys {
  publicKey: string;
  privateKey: string;
}

let cached: Keys | null = null;
let configuredFor = "";

async function keys(): Promise<Keys | null> {
  if (cached) return cached;
  const envPub = process.env.CLIENT_REVIEW_VAPID_PUBLIC_KEY ?? "";
  const envPriv = process.env.CLIENT_REVIEW_VAPID_PRIVATE_KEY ?? "";
  if (envPub && envPriv) return (cached = { publicKey: envPub, privateKey: envPriv });

  const dir = path.join(process.cwd(), ".data", "client-review");
  const stored = await readDoc<Keys>(KEY_DOC, dir);
  if (stored?.publicKey && stored.privateKey) return (cached = stored);

  const fresh = webpush.generateVAPIDKeys();
  // Only use a pair that was actually kept: a pair that vanishes on the next
  // request would orphan every subscription made with it.
  if (!(await writeDoc(KEY_DOC, dir, fresh))) return null;
  const again = await readDoc<Keys>(KEY_DOC, dir);
  return (cached = again?.publicKey ? again : fresh);
}

/** The public half, for the browser to subscribe with. Null when push can't work on this host. */
export async function vapidPublicKey(): Promise<string | null> {
  try {
    return (await keys())?.publicKey ?? null;
  } catch {
    return null;
  }
}

async function ready(): Promise<boolean> {
  const k = await keys().catch(() => null);
  if (!k) return false;
  if (configuredFor !== k.publicKey) {
    try {
      webpush.setVapidDetails(SUBJECT, k.publicKey, k.privateKey);
      configuredFor = k.publicKey;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Push one message to every device the client allowed. Returns the endpoints
 * the push service says are gone (unsubscribed, expired), so the caller can
 * drop them. Never throws: a failed push must not undo the owner's approval.
 */
export async function pushToClient(
  p: ClientProject,
  message: { title: string; body: string; url: string; tag?: string },
): Promise<{ sent: number; gone: string[] }> {
  if (!p.settings.notify || !p.pushSubs.length || !(await ready())) return { sent: 0, gone: [] };
  const payload = JSON.stringify(message);
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    p.pushSubs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 60 * 60 * 24 * 3 });
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(s.endpoint);
      }
    }),
  );
  return { sent, gone };
}
