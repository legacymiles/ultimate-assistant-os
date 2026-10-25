import { ensureBucket, putBlob } from "@/lib/server/blobStore";
import { fail, readBody } from "@/lib/money-agents/server/ai";
import { readRequests } from "@/lib/new-jarvis/server/requestsStore";
import { browserUid } from "@/lib/new-jarvis/server/requestsAuth";
import { readVideo } from "@/lib/new-jarvis/server/requestVideo";
import { viewerUid } from "@/lib/social-personas/server/http";
import { MEDIA_BUCKET, mediaDir } from "@/lib/social-personas/server/publish";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST { requestId, name? } → { media: DraftMedia }
//
// The approved clip's video came back from the PC into In Queue's storage.
// Personas Studio posts from ITS media folder, so the file is copied there
// once, under the viewer's own folder (the only place its scheduler accepts).

export async function POST(req: Request) {
  const b = await readBody(req);
  const id = typeof b?.requestId === "string" ? b.requestId.slice(0, 40) : "";
  if (!id) return fail(400, "That clip has no finished video yet.");
  const uid = await browserUid();
  if (!uid) return fail(401, "Sign in to hand clips to Personas Studio.");
  const doc = await readRequests(uid);
  const done = doc.finished.find((f) => f.id === id);
  if (!done?.video?.key) return fail(404, "That video isn't back from your PC yet.");
  const bytes = await readVideo(done.video.key);
  if (!bytes?.length) return fail(404, "The finished video couldn't be read. Ask your PC to make it again.");

  const folder = (await viewerUid()).replace(/[^a-z0-9_-]/gi, "") || "local";
  const safe = (typeof b?.name === "string" ? b.name : id).replace(/[^a-z0-9._-]/gi, "_").slice(-60) || id;
  const key = `${folder}/${Date.now().toString(36)}-${id}-${safe}.mp4`;
  if (!(await ensureBucket(MEDIA_BUCKET))) return fail(503, "Storage isn't reachable right now. Try again in a minute.");
  const ok = await putBlob(MEDIA_BUCKET, key, mediaDir(), bytes, "video/mp4");
  if (!ok) return fail(500, "Couldn't copy the video to Personas Studio. Try again.");
  return Response.json({ media: { key, name: `${safe}.mp4`, size: bytes.length, type: "video/mp4" } });
}
