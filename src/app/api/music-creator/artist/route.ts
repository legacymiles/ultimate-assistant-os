import { NextResponse } from "next/server";

// GET /api/music-creator/artist?q=<artist or song>   → { tracks: [...] }
// GET /api/music-creator/artist?preview=<url>        → the 30s clip's bytes
//
// Artist search for the Voice Library, against Apple's public iTunes Search
// API. Chosen because it needs no key, no account and no card, returns the
// artwork and — the part that matters here — a 30-second preview clip for most
// recordings, which is the raw material a reference clip is cut from.
//
// The second mode exists because those previews are served without permissive
// CORS headers, so the browser cannot read the bytes itself even though it can
// play them. Fetching them here keeps the "audition it, then cut a clip from
// it" flow possible. The host allow-list keeps this from being a general-purpose
// fetch proxy for anything on the internet.

export const runtime = "nodejs";
export const maxDuration = 60;

const PREVIEW_HOSTS = /(^|\.)(mzstatic\.com|apple\.com)$/i;

interface ITunesResult {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  releaseDate?: string;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const preview = url.searchParams.get("preview");
  if (preview) return streamPreview(preview);

  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ error: "Type an artist or a song to search for." }, { status: 400 });
  if (q.length > 120) return NextResponse.json({ error: "That search is too long." }, { status: 400 });

  const search = new URL("https://itunes.apple.com/search");
  search.searchParams.set("term", q);
  search.searchParams.set("entity", "song");
  search.searchParams.set("limit", "24");

  try {
    const res = await fetch(search, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`the catalogue returned ${res.status}`);
    // iTunes answers text/javascript, so res.json() is not safe to assume.
    const data = JSON.parse(await res.text()) as { results?: ITunesResult[] };
    const tracks = (data.results ?? []).map((r) => ({
      id: String(r.trackId ?? `${r.artistName}-${r.trackName}`),
      title: r.trackName ?? "Untitled",
      artist: r.artistName ?? "Unknown",
      album: r.collectionName,
      // The 100px art is what the API returns; ask for a bigger one.
      artwork: r.artworkUrl100?.replace("100x100", "300x300"),
      previewUrl: r.previewUrl ?? null,
      releaseYear: r.releaseDate ? Number(r.releaseDate.slice(0, 4)) || undefined : undefined,
    }));
    return NextResponse.json({ tracks });
  } catch (err) {
    return NextResponse.json({ error: `Could not reach the music catalogue: ${(err as Error).message}` }, { status: 502 });
  }
}

async function streamPreview(raw: string) {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return NextResponse.json({ error: "That is not a valid preview address." }, { status: 400 });
  }
  if (parsed.protocol !== "https:" || !PREVIEW_HOSTS.test(parsed.hostname)) {
    return NextResponse.json({ error: "Previews can only be fetched from the music catalogue." }, { status: 400 });
  }
  try {
    const res = await fetch(parsed, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return NextResponse.json({ error: `The preview returned ${res.status}.` }, { status: 502 });
    return new NextResponse(res.body, {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") ?? "audio/m4a",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: `Could not fetch the preview: ${(err as Error).message}` }, { status: 502 });
  }
}
