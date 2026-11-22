// POST /api/search/extract — read pages, no search.
//
//   POST { "urls": ["https://…", "https://…"], "app": "jarvis-agent" }
//   GET  /api/search/extract?url=https://…
//
// This is the endpoint an agent uses when it already has a URL — from a search
// it ran a minute ago, or from something a person pasted. Up to 10 URLs per
// call, read concurrently, each one capped and timed out on its own so one
// slow page cannot hold the others.
//
// Private network addresses are refused (see lib/search/extract.ts): this
// takes a URL from a caller and fetches it server-side, so it is SSRF-shaped
// by nature and the address check is the thing that makes it safe.
import { NextResponse } from "next/server";
import { requireScope, resolveCaller } from "@/lib/search/auth";
import { extractPages } from "@/lib/search/extract";
import { errorResponse } from "@/lib/search/route";
import { rateCheck, recordUsage } from "@/lib/search/store";
import { SearchError } from "@/lib/search/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_URLS = 10;

async function run(request: Request, urls: string[], app: string | null): Promise<NextResponse> {
  const started = Date.now();
  const caller = await resolveCaller(request);
  requireScope(caller, "extract");

  if (urls.length === 0) {
    throw new SearchError("Send one or more URLs in `urls`.", { status: 400, code: "no_urls" });
  }
  if (urls.length > MAX_URLS) {
    throw new SearchError(`That's ${urls.length} URLs; ${MAX_URLS} is the most per call.`, {
      status: 400,
      code: "too_many_urls",
    });
  }

  // Reading ten pages costs more than one search, so it counts as one call
  // against the same bucket rather than being free.
  const verdict = await rateCheck(caller);
  if (!verdict.allowed) {
    throw new SearchError(verdict.message ?? "Rate limit reached.", { status: 429, code: "rate_limited" });
  }

  const pages = await extractPages(urls);
  const ms = Date.now() - started;
  const ok = pages.filter((page) => !page.error).length;

  recordUsage({
    callerId: caller.id,
    callerKind: caller.kind,
    callerLabel: caller.label,
    ownerEmail: caller.ownerEmail,
    plan: caller.plan,
    app,
    kind: "extract",
    query: urls[0],
    provider: "extract",
    location: null,
    cached: false,
    degraded: false,
    ms,
    resultCount: pages.length,
    extracted: ok,
    ok: ok > 0,
    error: ok === 0 ? (pages[0]?.error ?? "every page failed") : null,
  });

  return NextResponse.json(
    { pages, ms, read: ok, failed: pages.length - ok },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new SearchError("Send a JSON body with a `urls` array.", { status: 400, code: "bad_body" });
    }
    const raw = Array.isArray(body.urls)
      ? body.urls
      : typeof body.url === "string"
        ? [body.url]
        : [];
    const urls = raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    const app = typeof body.app === "string" ? body.app : typeof body.label === "string" ? body.label : null;
    return await run(request, urls, app);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const target = url.searchParams.get("url");
    return await run(request, target ? [target] : [], url.searchParams.get("app"));
  } catch (error) {
    return errorResponse(error);
  }
}
