import { NextResponse } from "next/server";
import { isAllowedFileUrl } from "@/lib/mp3-download/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/mp3-download/file?url=…&name=…
 *
 * Streams a licensed audio file to the browser as an attachment.
 *
 * It exists for two reasons and neither is bandwidth. First, the sources set
 * no Content-Disposition, so a direct link opens a player tab instead of
 * saving, and Archive's filenames are item slugs rather than song titles —
 * going through here means the file lands as `Artist - Title.mp3`. Second, a
 * cross-origin `download` attribute is ignored by every browser, so a direct
 * link could not name the file even if the host allowed it.
 *
 * The URL comes from the client, so it is checked against the allowlist in
 * sources.ts before anything is fetched: otherwise this route is an open proxy
 * into the deployment's own network.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const target = params.get("url") ?? "";
  const name = (params.get("name") ?? "audio.mp3").replace(/[\r\n"\\]/g, "").slice(0, 180);

  if (!isAllowedFileUrl(target)) {
    return NextResponse.json(
      { error: "That host is not one of the licensed sources this app downloads from." },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: { "user-agent": "UltimateAssistantOS/1.0 (hub mp3-download)" },
      signal: AbortSignal.timeout(45_000),
      redirect: "follow",
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "The source did not respond." }, { status: 504 });
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `The source refused the file (${upstream.status}).` },
      { status: 502 },
    );
  }

  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
    // RFC 5987 as well as the plain form, so non-ASCII titles survive.
    "content-disposition":
      `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; ` +
      `filename*=UTF-8''${encodeURIComponent(name)}`,
    "cache-control": "no-store",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("content-length", length);

  return new Response(upstream.body, { headers });
}
