import { NextResponse } from "next/server";
import { organizerFromUrl } from "@/lib/friends-night-out/sources/organizers";
import {
  extractFromImage,
  extractFromUrl,
} from "@/lib/friends-night-out/sources/social";

export const runtime = "nodejs";
export const maxDuration = 60;

// Comfortably above a phone photo, well below anything that would stall the
// route. A flyer does not need to be a 20 MP original to be readable.
const MAX_IMAGE_BYTES = 6_000_000;

// ---------------------------------------------------------------------------
// POST /api/fno/extract   { url }  or  { image: "data:image/jpeg;base64,..." }
//
// The Inbox. Turns the artefact a person actually has — a link someone sent
// them, or a photo of a flyer in a window — into a draft event they confirm.
//
// This is the app's honest answer to "search Instagram, TikTok and Facebook".
// None of those platforms has a public event-search endpoint and scraping them
// breaches their terms, so the app never crawls them; it accepts what the user
// brings instead. A flyer photo is also the only path that can reach an event
// with no web footprint at all.
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  let body: { url?: string; image?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.image) {
    if (body.image.length > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "That image is too large — try a photo under about 4 MB." },
        { status: 413 },
      );
    }
    if (!process.env.AI_GATEWAY_API_KEY) {
      return NextResponse.json({
        draft: null,
        reason:
          "Reading a flyer needs AI_GATEWAY_API_KEY. Without it you can still add the event by hand.",
      });
    }
    const draft = await extractFromImage(body.image);
    return NextResponse.json({
      draft,
      reason: draft ? undefined : "Could not read an event off that image.",
    });
  }

  const url = body.url?.trim();
  if (!url) {
    return NextResponse.json({ error: "url or image required" }, { status: 400 });
  }

  const { draft, body: pageBody } = await extractFromUrl(url);

  // A pasted link may also reveal a publisher worth following permanently —
  // one paste turns into that organizer's entire future calendar.
  const organizer = organizerFromUrl(url, pageBody ?? undefined);

  if (!draft) {
    return NextResponse.json({
      draft: null,
      organizer,
      reason: reasonForFailure(url, pageBody),
    });
  }

  return NextResponse.json({ draft, organizer });
}

/**
 * Say what actually went wrong.
 *
 * Instagram, TikTok and Facebook serve a login wall to any request without a
 * session, so a failure there is expected rather than a bug — and telling the
 * user to photograph the flyer instead is a real path forward, whereas
 * "extraction failed" is not.
 */
function reasonForFailure(url: string, body: string | null): string {
  let host = "";
  try {
    host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return "That does not look like a URL.";
  }

  if (/instagram\.com|tiktok\.com|facebook\.com|fb\.com/i.test(host)) {
    return "Instagram, TikTok and Facebook hide their posts behind a login, so the page can't be read from here. Screenshot the post or the flyer and drop the image in instead — that works.";
  }
  if (!body) {
    return "That page could not be reached — it may be down, or blocking automated requests.";
  }
  return "That page loaded, but no event details could be found on it. Add the event by hand below.";
}
