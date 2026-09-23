import { NextResponse } from "next/server";
import { getBlob } from "@/lib/server/blobStore";
import {
  bridgeDataDir,
  discardJobFile,
  getJob,
  jobBlobKey,
  BRIDGE_BUCKET,
} from "@/lib/mp3-download/server/bridge";
import { sessionUid } from "@/lib/mp3-download/server/auth";

// GET /api/mp3-download/bridge/file?job=<id>
//
// Collect a finished job from a hub with no Supabase Storage, where the runner
// put the bytes on local disk instead of behind a signed link. On a deployed
// hub the browser never reaches this route — jobDownloadUrl hands it a
// Storage URL and the file goes straight from Supabase to the browser without
// passing through a function body.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const uid = await sessionUid();
  const jobId = new URL(request.url).searchParams.get("job") ?? "";
  if (!jobId) return NextResponse.json({ error: "job is required." }, { status: 400 });

  // Scoped to the session's own uid, so a job id alone reaches nobody's file.
  const key = await jobBlobKey(uid, jobId);
  const job = await getJob(uid, jobId);
  if (!key || !job) return NextResponse.json({ error: "Not ready." }, { status: 404 });

  const bytes = await getBlob(BRIDGE_BUCKET, key, bridgeDataDir());
  if (!bytes) return NextResponse.json({ error: "That file is gone." }, { status: 404 });

  const ascii = job.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  const type = job.filename.endsWith(".mp4") ? "video/mp4" : "audio/mpeg";

  // Collected once. The PC already has the original, and leaving copies in the
  // hub's data directory turns a download tool into a disk leak.
  void discardJobFile(uid, jobId);

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": type,
      "content-length": String(bytes.length),
      "content-disposition":
        `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(job.filename)}`,
      "cache-control": "no-store",
    },
  });
}
