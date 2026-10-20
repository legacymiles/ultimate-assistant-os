import { loadConnection } from "@/lib/social-personas/server/connectors";
import { body, fail, viewerUid } from "@/lib/social-personas/server/http";
import { explain, sendReply } from "@/lib/social-personas/server/inbox";
import { hasInbox } from "@/lib/social-personas/types";

export const runtime = "nodejs";

// POST { connectionId, kind: "dm" | "comment", replyTo, text } → { id }
// Sends one reply as the persona, through the account's own login.
export async function POST(req: Request) {
  const b = await body(req);
  const connectionId = typeof b?.connectionId === "string" ? b.connectionId.slice(0, 64) : "";
  const kind = b?.kind === "dm" ? "dm" : b?.kind === "comment" ? "comment" : null;
  const replyTo = typeof b?.replyTo === "string" ? b.replyTo : "";
  const text = typeof b?.text === "string" ? b.text.trim() : "";
  if (!connectionId || !kind || !/^[A-Za-z0-9_.:-]{1,200}$/.test(replyTo)) return fail(400, "That message can't be answered from here — open it on the platform.");
  if (!text) return fail(400, "Write a reply first.");
  if (text.length > 10_000) return fail(400, "That reply is too long.");

  const conn = await loadConnection(connectionId);
  if (!conn) return fail(404, "That login is gone — connect the account again.", { reconnect: true });
  if (conn.ownerUid !== (await viewerUid())) return fail(403, "That account is connected to another login.");
  if (!hasInbox(conn.platform)) return fail(400, "Replies from here work on Instagram, Facebook and YouTube.");

  try {
    const r = await sendReply(conn, { kind, replyTo, text });
    return Response.json({ id: r.id, at: new Date().toISOString() });
  } catch (err) {
    console.error(`[social-personas/inbox] ${conn.platform} reply failed:`, err);
    const p = explain(conn.platform, err);
    if (!conn.canInbox && !p.reconnect) p.needsInbox = true;
    return fail(p.reconnect ? 401 : 502, p.error, { reconnect: p.reconnect, needsInbox: p.needsInbox });
  }
}
