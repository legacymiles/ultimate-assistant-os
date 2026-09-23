import { NextResponse } from "next/server";
import { fileNameFrom } from "@/lib/mp3-download/match";
import {
  bridgeInfo,
  getJob,
  jobDownloadUrl,
  mintToken,
  queueJob,
} from "@/lib/mp3-download/server/bridge";
import { bad, sessionUid } from "@/lib/mp3-download/server/auth";
import { isSupportedMediaUrl } from "@/lib/mp3-download/ytdlp";

// The browser's half of the PC bridge. Session-authenticated like the rest of
// the app; only the /runner/* routes use a token.
//
//   GET  ?job=<id>   — how that job is going, and where to collect it
//   GET              — is a runner connected, and how many jobs are waiting
//   POST { op: "queue", url, mode, title, creator } — hand the PC a job
//   POST { op: "mint" }                             — a fresh runner token

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const uid = await sessionUid();
  const jobId = new URL(request.url).searchParams.get("job");

  if (!jobId) return NextResponse.json(await bridgeInfo(uid));

  const job = await getJob(uid, jobId);
  if (!job) return NextResponse.json({ error: "No such job." }, { status: 404 });

  return NextResponse.json({
    state: job.state,
    filename: job.filename,
    bytes: job.bytes ?? null,
    error: job.error ?? null,
    href: job.state === "done" ? await jobDownloadUrl(uid, jobId) : null,
  });
}

export async function POST(request: Request) {
  const uid = await sessionUid();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  if (body?.op === "mint") {
    const token = await mintToken(uid);
    return token
      ? NextResponse.json({ token })
      : NextResponse.json({ error: "Could not save the token." }, { status: 500 });
  }

  if (body?.op === "queue") {
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!isSupportedMediaUrl(url)) {
      return bad("That host is not one of the sites this app downloads from.");
    }

    const info = await bridgeInfo(uid);
    if (!info.hasToken) {
      return bad("No runner is set up yet. Open MP3 Download › Your PC to get a token.");
    }

    const mode = body.mode === "video" ? "video" : "audio";
    const title = typeof body.title === "string" ? body.title : "download";
    const creator = typeof body.creator === "string" ? body.creator : "";
    const job = await queueJob(uid, {
      url,
      mode,
      title,
      creator,
      filename: fileNameFrom(creator, title, mode === "video" ? "mp4" : "mp3"),
    });
    if (!job) return NextResponse.json({ error: "Could not queue that." }, { status: 500 });

    // `online` rides along so the page can say "your PC is asleep, this will
    // start when it wakes" instead of spinning silently.
    return NextResponse.json({ jobId: job.id, online: info.online });
  }

  return bad("Unknown op.");
}
