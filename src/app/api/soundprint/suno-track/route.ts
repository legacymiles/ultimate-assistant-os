import { NextResponse } from "next/server";
import { cdnCandidates, parseSunoRef, songPageUrl } from "@/lib/soundprint/suno";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/soundprint/suno-track
// Body: { url: string }  — a Suno song or share link the user pasted.
// Resolves it to the public CDN audio URL so the app can play the real track.
export async function POST(req: Request) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const ref = parseSunoRef(body.url ?? "");
  if (!ref) {
    return NextResponse.json(
      { error: "That doesn't look like a Suno link. Paste a suno.com/song/… or suno.com/s/… URL." },
      { status: 400 },
    );
  }

  let songId = ref.value;

  // Short links (/s/<code>) 307-redirect to /song/<uuid>?sh=… — follow it
  // server-side (a browser fetch would be blocked by CORS).
  if (ref.kind === "short") {
    const resolved = await resolveShortLink(ref.value);
    if (!resolved) {
      return NextResponse.json(
        { error: "Couldn't resolve that short link. Open it in Suno and copy the full song URL instead." },
        { status: 502 },
      );
    }
    songId = resolved;
  }

  // Probe every CDN shard and use the one that actually serves the audio.
  // A private or still-rendering song won't be on any of them yet.
  const found = await findAudio(cdnCandidates(songId));
  if (!found.url) {
    return NextResponse.json(
      {
        error:
          found.anyForbidden || found.any404
            ? "Couldn't find that song's public audio. In Suno, open the song → Share and set it to " +
              "“Public” or “Anyone with the link”, then paste the link again. (Brand-new songs can take " +
              "a minute to publish.)"
            : "Couldn't reach Suno's audio servers. Try again in a moment.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    songId,
    audioUrl: found.url,
    sunoUrl: songPageUrl(songId),
  });
}

async function resolveShortLink(code: string): Promise<string | null> {
  try {
    // `manual` so we read the Location header instead of following it.
    const res = await fetch(`https://suno.com/s/${code}`, {
      method: "HEAD",
      redirect: "manual",
    });
    const loc = res.headers.get("location") ?? "";
    const uuid = loc.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return uuid ? uuid[0].toLowerCase() : null;
  } catch {
    return null;
  }
}

interface AudioProbe {
  url: string | null;
  any404: boolean;
  anyForbidden: boolean;
}

/** Return the first candidate URL that serves real audio, probing in parallel. */
async function findAudio(urls: string[]): Promise<AudioProbe> {
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { method: "HEAD" });
        const type = res.headers.get("content-type") ?? "";
        return { url, ok: res.ok && type.includes("audio"), status: res.status };
      } catch {
        return { url, ok: false, status: 0 };
      }
    }),
  );

  const hit = results.find((r) => r.ok);
  return {
    url: hit?.url ?? null,
    any404: results.some((r) => r.status === 404),
    anyForbidden: results.some((r) => r.status === 403),
  };
}
