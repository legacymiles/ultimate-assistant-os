import { NextResponse } from "next/server";
import { probeViaOembed } from "@/lib/mp3-download/oembed";
import {
  isSupportedMediaUrl,
  probeLink,
  SUPPORTED_SITE_NAMES,
  ytdlpStatus,
} from "@/lib/mp3-download/ytdlp";

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

  const engine = await ytdlpStatus();

  // With yt-dlp here, it answers: duration and the stated licence come only
  // from it, and those are the two facts worth having.
  if (engine.ok) {
    try {
      return NextResponse.json({ probe: await probeLink(url) });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "That link could not be read." },
        { status: 422 },
      );
    }
  }

  // Without it — the deployed site — ask the host itself, so the paste box
  // still shows what the link is before the PC is asked to fetch it.
  if (!isSupportedMediaUrl(url)) {
    return NextResponse.json(
      { error: "That host is not on this app's list." },
      { status: 422 },
    );
  }
  const partial = await probeViaOembed(url);
  if (partial) return NextResponse.json({ probe: partial });

  return NextResponse.json(
    {
      error:
        "That link could not be read from here, and this server has no yt-dlp to ask. "
        + "Start the runner on your PC and try again.",
    },
    { status: 422 },
  );
}
