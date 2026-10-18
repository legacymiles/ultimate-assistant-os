// ---------------------------------------------------------------------------
// Telling the client, even with the tab closed.
//
// Web Push, signed with this deploy's VAPID keys. Without the keys the client
// still gets every notice in-page (and a browser pop-up while their tab is
// open); push is only what reaches a phone in a pocket. On iPhone that needs
// the page added to the Home Screen first — Safari only delivers push to an
// installed web app — which the client's Settings panel says in so many words.
//
// Generate keys once with `npx web-push generate-vapid-keys` and set
// CLIENT_REVIEW_VAPID_PUBLIC_KEY / CLIENT_REVIEW_VAPID_PRIVATE_KEY.
// ---------------------------------------------------------------------------

import "server-only";

import webpush from "web-push";
import type { ClientProject } from "./types";

const PUBLIC = process.env.CLIENT_REVIEW_VAPID_PUBLIC_KEY ?? "";
const PRIVATE = process.env.CLIENT_REVIEW_VAPID_PRIVATE_KEY ?? "";
const SUBJECT = process.env.CLIENT_REVIEW_VAPID_SUBJECT || "mailto:notifications@ultimate-assistant-os.vercel.app";

let configured = false;
function ready(): boolean {
  if (!PUBLIC || !PRIVATE) return false;
  if (!configured) {
    try {
      webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
      configured = true;
    } catch {
      return false;
    }
  }
  return true;
}

export function vapidPublicKey(): string | null {
  return PUBLIC && PRIVATE ? PUBLIC : null;
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
  if (!p.settings.notify || !p.pushSubs.length || !ready()) return { sent: 0, gone: [] };
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
