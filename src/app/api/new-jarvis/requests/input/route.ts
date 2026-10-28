import { mcpContext } from "@/lib/jarvis/server/mcpAuth";
import { readRequests } from "@/lib/new-jarvis/server/requestsStore";
import { readVideo, videoWatchLink } from "@/lib/new-jarvis/server/requestVideo";

// ---------------------------------------------------------------------------
// The clip the owner attached to a queue request, for the agent working it:
//   GET /api/new-jarvis/requests/input?id=q-abc123
//   Authorization: Bearer <JARVIS_MCP_TOKEN>
//
// Custom Video Swap's driving video. Deployed: a redirect to an hour-long
// Storage link (follow redirects). Locally: the bytes. Same token and pinned
// account as the jarvis-memory connector; token-exempt in middleware by exact
// path, checked here.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = mcpContext(req);
  if (!ctx.available) return Response.json({ error: ctx.reason }, { status: ctx.status });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const doc = await readRequests(ctx.userId);
  const input = (doc.requests.find((r) => r.id === id) ?? doc.finished.find((f) => f.id === id))?.input;
  if (!input) return Response.json({ error: `No clip attached to request ${id}.` }, { status: 404 });

  const link = await videoWatchLink(input.key, `${id}-driving.mp4`);
  if (link) return Response.redirect(link, 302);
  const bytes = await readVideo(input.key);
  if (!bytes) return Response.json({ error: "The clip is missing from storage." }, { status: 404 });
  return new Response(new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="${id}-driving.mp4"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store",
    },
  });
}
