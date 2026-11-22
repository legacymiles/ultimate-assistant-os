// ---------------------------------------------------------------------------
// The shared shape of every /api/search route.
//
// Each route file is then four lines: name the kind, hand it here. That is
// what keeps six endpoints behaving identically — same auth, same errors, same
// headers, same logging — instead of drifting apart one copy-paste at a time.
// ---------------------------------------------------------------------------

import "server-only";

import { NextResponse } from "next/server";
import { resolveCaller, requireScope } from "./auth";
import { runSearch } from "./orchestrator";
import { SearchError, type SearchKind, type SearchRequest } from "./types";

/** Never cached by a CDN: the service's own cache is the one that counts, and a result set is per-caller. */
const HEADERS = { "Cache-Control": "no-store" } as const;

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof SearchError) {
    const body: Record<string, unknown> = { error: error.message, code: error.code };
    if (error.attempts.length > 0) body.attempts = error.attempts;
    const headers: Record<string, string> = { ...HEADERS };
    if (error.code === "rate_limited") {
      const seconds = /in (\d+)s/.exec(error.message)?.[1];
      if (seconds) headers["Retry-After"] = seconds;
    }
    if (error.code === "no_auth" || error.code === "bad_key") {
      headers["WWW-Authenticate"] = 'Bearer realm="jarvis-search"';
    }
    return NextResponse.json(body, { status: error.status, headers });
  }
  // Checklist S4: an unexpected throw is logged with enough to find it, and the
  // caller gets a sentence rather than a stack trace.
  console.error("[search] unhandled", error);
  return NextResponse.json(
    { error: "The search service hit an unexpected error. It's been logged.", code: "internal" },
    { status: 500, headers: HEADERS },
  );
}

/** Read a request body from JSON or from the query string, whichever came. */
export async function readRequest(request: Request, kind: SearchKind): Promise<SearchRequest> {
  const url = new URL(request.url);

  if (request.method === "GET") {
    const extract = url.searchParams.get("extract");
    return {
      query: url.searchParams.get("q") ?? url.searchParams.get("query") ?? "",
      kind,
      limit: numberParam(url.searchParams.get("limit")),
      freshness: (url.searchParams.get("freshness") as SearchRequest["freshness"]) ?? undefined,
      language: url.searchParams.get("language") ?? undefined,
      safe: url.searchParams.get("safe") === "false" ? false : undefined,
      extract: extract === null ? undefined : extract === "true" ? true : numberParam(extract),
      provider: url.searchParams.get("provider") ?? undefined,
      noCache: url.searchParams.get("noCache") === "true" || url.searchParams.get("fresh") === "true",
      label: url.searchParams.get("app") ?? url.searchParams.get("label") ?? undefined,
    };
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw new SearchError("Send a JSON body with a `query` field.", { status: 400, code: "bad_body" });
  }
  if (!body || typeof body !== "object") {
    throw new SearchError("Send a JSON body with a `query` field.", { status: 400, code: "bad_body" });
  }

  return {
    query: typeof body.query === "string" ? body.query : typeof body.q === "string" ? body.q : "",
    kind,
    limit: typeof body.limit === "number" ? body.limit : undefined,
    freshness: body.freshness as SearchRequest["freshness"],
    language: typeof body.language === "string" ? body.language : undefined,
    safe: typeof body.safe === "boolean" ? body.safe : undefined,
    extract:
      typeof body.extract === "boolean" || typeof body.extract === "number"
        ? (body.extract as boolean | number)
        : undefined,
    provider: typeof body.provider === "string" ? body.provider : undefined,
    noCache: body.noCache === true,
    label:
      typeof body.label === "string" ? body.label : typeof body.app === "string" ? body.app : undefined,
  };
}

function numberParam(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** The whole of a search endpoint. */
export async function handleSearch(request: Request, kind: SearchKind): Promise<NextResponse> {
  try {
    const caller = await resolveCaller(request);
    requireScope(caller, "search");
    const payload = await readRequest(request, kind);
    if (payload.extract) requireScope(caller, "extract");
    const response = await runSearch(payload, caller);
    return NextResponse.json(response, {
      headers: {
        ...HEADERS,
        // Useful enough in a terminal to be worth two headers: which provider
        // served it, and whether it came from cache.
        "X-Search-Provider": response.provider,
        "X-Search-Cached": String(response.cached),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
