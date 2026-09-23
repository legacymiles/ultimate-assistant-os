import { NextResponse } from "next/server";
import { probeLink, SUPPORTED_SITE_NAMES, ytdlpStatus } from "@/lib/mp3-download/ytdlp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** GET — what the paste box can accept, and whether the engine is here at all. */
export async function GET() {
  const status = await ytdlpStatus();
  return NextResponse.json({ ...status, sites: SUPPORTED_SITE_NAMES });
}

/**
 * POST — read a pasted link and answer with what it is.
 *
 * Nothing is downloaded here. The paste box skips the song search, not the
 * confirmation: the owner still sees the real title, channel, runtime and
 * stated licence before a file is fetched.
 */
export async function POST(request: Request) {
  let url: string;
  try {
    url = (((await request.json()) as { url?: string }).url ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  if (!url) return NextResponse.json({ error: "Paste a link first." }, { status: 400 });

  try {
    return NextResponse.json({ probe: await probeLink(url) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "That link could not be read." },
      { status: 422 },
    );
  }
}
