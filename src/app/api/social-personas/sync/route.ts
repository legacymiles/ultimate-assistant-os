import { loadConnection, syncConnection } from "@/lib/social-personas/server/connectors";
import { body, fail, viewerUid } from "@/lib/social-personas/server/http";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST { connectionId } → { platform, handle, displayName, url, followers, posts }
export async function POST(req: Request) {
  const b = await body(req);
  const id = typeof b?.connectionId === "string" ? b.connectionId : "";
  if (!id) return fail(400, "Missing connectionId.");
  const conn = await loadConnection(id);
  if (!conn) return fail(404, "That connection is gone — connect the account again.", { reconnect: true });
  if (conn.ownerUid !== (await viewerUid())) return fail(403, "That connection belongs to another account.");
  try {
    const got = await syncConnection(conn);
    return Response.json({ platform: conn.platform, ...got });
  } catch (err) {
    const msg = (err as Error).message;
    const expired = /expired|invalid.*token|access_token_invalid|OAuthException|\b190\b/i.test(msg);
    return fail(expired ? 401 : 502, expired ? "The login expired — connect the account again." : msg.slice(0, 400), { reconnect: expired });
  }
}
