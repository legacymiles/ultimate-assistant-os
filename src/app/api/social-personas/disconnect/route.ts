import { deleteConnection, loadConnection } from "@/lib/social-personas/server/connectors";
import { body, fail, viewerUid } from "@/lib/social-personas/server/http";

export const runtime = "nodejs";

// POST { connectionId } — forgets the stored login. The persona keeps its posts.
export async function POST(req: Request) {
  const b = await body(req);
  const id = typeof b?.connectionId === "string" ? b.connectionId : "";
  if (!id) return fail(400, "Missing connectionId.");
  const conn = await loadConnection(id);
  if (conn && conn.ownerUid !== (await viewerUid())) return fail(403, "That connection belongs to another account.");
  if (conn) await deleteConnection(id);
  return Response.json({ ok: true });
}
