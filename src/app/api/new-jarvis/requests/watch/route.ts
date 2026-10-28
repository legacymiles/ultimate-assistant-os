import { readRequests } from "@/lib/new-jarvis/server/requestsStore";
import { browserUid } from "@/lib/new-jarvis/server/requestsAuth";
import { readVideo, videoWatchLink } from "@/lib/new-jarvis/server/requestVideo";

// GET /api/new-jarvis/requests/watch?id=q-abc123[&download=1][&input=1]
// (input=1 = the clip the owner SENT with it — Custom Video Swap's "before")
// The signed-in owner's video for one of their requests: a redirect to an
// hour-long Storage link when deployed, the bytes themselves locally.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const uid = await browserUid();
  if (!uid) return Response.json({ error: "Sign in to watch it." }, { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const download = url.searchParams.has("download");
  const wantInput = url.searchParams.has("input");
  const doc = await readRequests(uid);
  const row = doc.requests.find((r) => r.id === id) ?? doc.finished.find((f) => f.id === id);
  const video = wantInput ? row?.input : row?.video;
  if (!video) return Response.json({ error: wantInput ? "No clip was sent with that request." : "No video for that request yet." }, { status: 404 });

  const link = await videoWatchLink(video.key, download ? `${id}.mp4` : undefined);
  if (link) return Response.redirect(link, 302);

  const bytes = await readVideo(video.key);
  if (!bytes) return Response.json({ error: "The video file is missing." }, { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=300",
    ...(download ? { "Content-Disposition": `attachment; filename="${id}.mp4"` } : {}),
  };
  // Ranges, so the player can seek (local hubs only — deployed ones redirect to Storage above).
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const size = bytes.length;
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new Response(new Blob([new Uint8Array(bytes.subarray(start, end + 1))], { type: "video/mp4" }), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), {
    headers: { ...headers, "Content-Length": String(bytes.length) },
  });
}
