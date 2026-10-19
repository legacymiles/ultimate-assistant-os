import { mcpContext } from "@/lib/jarvis/server/mcpAuth";
import { decodeImage } from "@/lib/new-jarvis/requests";
import { readRequests } from "@/lib/new-jarvis/server/requestsStore";

// ---------------------------------------------------------------------------
// One picture off a queue request, for an agent:
//   GET /api/new-jarvis/requests/image?id=q-abc123&n=0
//   Authorization: Bearer <JARVIS_MCP_TOKEN>
//
// Same token and pinned account as the jarvis-memory connector, because the
// caller is the Claude Code session that just read queue_list. Token-exempt in
// middleware by exact path; this route checks the token itself.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = mcpContext(req);
  if (!ctx.available) return Response.json({ error: ctx.reason }, { status: ctx.status });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const n = Number(url.searchParams.get("n") ?? 0);
  const doc = await readRequests(ctx.userId);
  const request = doc.requests.find((r) => r.id === id);
  const image = request?.images[Number.isInteger(n) ? n : 0];
  const decoded = image ? decodeImage(image) : null;
  if (!decoded) return Response.json({ error: `No picture ${n + 1} on request ${id}.` }, { status: 404 });
  const ext = decoded.type.split("/")[1]?.replace("jpeg", "jpg") ?? "img";
  return new Response(new Blob([decoded.bytes], { type: decoded.type }), {
    headers: {
      "Content-Type": decoded.type,
      "Content-Disposition": `attachment; filename="${id}-${n + 1}.${ext}"`,
      "Cache-Control": "no-store",
    },
  });
}
