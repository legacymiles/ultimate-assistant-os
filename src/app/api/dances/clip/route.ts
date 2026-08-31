// ---------------------------------------------------------------------------
// POST /api/dances/clip   { ref }   — the optional local-mp4 upgrade.
//
// Downloads a short muted preview to public/dances/<ref>.mp4 with yt-dlp, which
// promotes that tile from rung 2 of the playback ladder (a YouTube iframe) to
// rung 1 (a local <video>): instant, no network on hover, no third-party
// branding.
//
// yt-dlp is NOT a dependency of this app. It is not installed on many machines
// and the wall works fully without it, so a missing binary returns a clear,
// actionable message and a 200 — not a 500 and not a stack trace.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { NextResponse } from "next/server";

const run = promisify(execFile);

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const OUT_DIR = path.join(process.cwd(), "public", "dances");

export async function POST(req: Request) {
  let ref: string;
  try {
    ref = String((await req.json()).ref ?? "");
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request body." }, { status: 400 });
  }

  // The ref goes into a shell argument and a file path. Anything but a real
  // YouTube id is rejected outright rather than sanitised.
  if (!/^[A-Za-z0-9_-]{11}$/.test(ref)) {
    return NextResponse.json({ ok: false, error: "Not a YouTube video id." }, { status: 400 });
  }

  const out = path.join(OUT_DIR, `${ref}.mp4`);
  try {
    await fs.access(out);
    return NextResponse.json({ ok: true, path: `/dances/${ref}.mp4`, cached: true });
  } catch {
    // Not cached yet — fall through and fetch it.
  }

  try {
    await fs.mkdir(OUT_DIR, { recursive: true });
  } catch {
    return NextResponse.json({
      ok: false,
      error: "Cannot write to public/dances — the filesystem is read-only here.",
    });
  }

  try {
    await run(
      "yt-dlp",
      [
        "-f",
        "mp4[height<=720]/best[height<=720]",
        "--no-playlist",
        "--quiet",
        "-o",
        out,
        `https://www.youtube.com/watch?v=${ref}`,
      ],
      { timeout: 110_000 }
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return NextResponse.json({
        ok: false,
        error: "yt-dlp is not installed. Install it to cache clips locally: pip install yt-dlp",
      });
    }
    return NextResponse.json({ ok: false, error: "yt-dlp could not fetch that video." });
  }

  return NextResponse.json({ ok: true, path: `/dances/${ref}.mp4` });
}
