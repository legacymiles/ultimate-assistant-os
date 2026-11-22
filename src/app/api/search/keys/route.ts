// Service keys — the credentials agents and other repos use.
//
//   GET    /api/search/keys            list them (prefixes only, never the key)
//   POST   /api/search/keys            mint one; the plaintext is in the
//                                      response and is never retrievable again
//   DELETE /api/search/keys?id=…       revoke one
//
// Owner session only, deliberately: a service key cannot mint another service
// key. That is why this path is NOT in middleware's token-auth list while the
// search endpoints are — a leaked agent key can spend quota, not issue new
// credentials.
import { NextResponse } from "next/server";
import { createServiceKey, requireAdmin } from "@/lib/search/auth";
import { SEARCH_LIMITS } from "@/lib/search/config";
import { errorResponse } from "@/lib/search/route";
import { listKeys, revokeKey, storageMode } from "@/lib/search/store";
import { ALL_SCOPES, SearchError, type Scope } from "@/lib/search/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      { keys: await listKeys(), storage: storageMode(), defaults: { perMinute: SEARCH_LIMITS.perMinute, perDay: SEARCH_LIMITS.perDay } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      /* An empty body means "a default key" — fine. */
    }

    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "";
    if (!name) {
      throw new SearchError("Give the key a name, so you can tell later what it was for.", {
        status: 400,
        code: "no_name",
      });
    }

    const requested = Array.isArray(body.scopes)
      ? body.scopes.filter((s): s is Scope => typeof s === "string" && (ALL_SCOPES as string[]).includes(s))
      : undefined;
    // `admin` is never grantable to a key, whatever was asked for — see the
    // header comment. Silently dropping it would be worse than saying so.
    if (requested?.includes("admin")) {
      throw new SearchError("A service key can't be given the admin permission — that's owner-session only.", {
        status: 400,
        code: "bad_scope",
      });
    }

    const { key, row } = await createServiceKey({
      name,
      scopes: requested,
      perMinute: typeof body.perMinute === "number" ? Math.max(1, Math.round(body.perMinute)) : undefined,
      perDay: typeof body.perDay === "number" ? Math.max(1, Math.round(body.perDay)) : undefined,
    });

    return NextResponse.json(
      {
        key,
        row,
        note: "Copy this now — it's stored as a hash and can't be shown again. Revoke and re-issue if you lose it.",
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new SearchError("Pass the key's id as ?id=…", { status: 400, code: "no_id" });
    const done = await revokeKey(id);
    if (!done) {
      throw new SearchError("That key wasn't found, or was already revoked.", { status: 404, code: "not_found" });
    }
    return NextResponse.json({ revoked: id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
