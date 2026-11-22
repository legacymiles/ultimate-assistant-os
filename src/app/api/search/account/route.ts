// GET /api/search/account — what the signed-in person has, as themselves.
//
// The member's half of the service. Deliberately NOT the owner's console:
// it answers "what am I allowed, and how much have I used", never "who else
// has a key" or "which providers are configured". A member has no business
// knowing the owner runs SearXNG on a VPS, and the provider list would leak
// the hostname.
//
// It also never returns a key. Keys are stored as hashes and shown once at
// creation, so there is nothing to return — the page shows the prefix and
// tells them to ask for a new one if they lost it, which is the only honest
// answer.
//
// Reachable by any signed-in account, not just the owner, which is why it is
// in middleware's session-exempt list and checks the session itself.
import { NextResponse } from "next/server";
import { requireSignedIn } from "@/lib/search/auth";
import { errorResponse } from "@/lib/search/route";
import { listKeysForEmail, usageSummary } from "@/lib/search/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const who = await requireSignedIn();
    const keys = await listKeysForEmail(who.email);
    const live = keys.filter((key) => !key.revokedAt);

    const raw = Number(new URL(request.url).searchParams.get("hours"));
    const hours = Number.isFinite(raw) && raw > 0 ? Math.min(168, Math.round(raw)) : 24;

    // The whole usage window is read and then filtered to this person. Fine at
    // this size, and it keeps one code path for the summary; if the service
    // ever carries enough members for that to hurt, this is the query to push
    // into Postgres.
    const all = await usageSummary(hours);
    const mine = all.byPerson.find((person) => person.email === who.email);

    return NextResponse.json(
      {
        email: who.email,
        isOwner: who.isOwner,
        hasAccess: live.length > 0,
        keys: live.map((key) => ({
          id: key.id,
          name: key.name,
          prefix: key.prefix,
          plan: key.plan,
          perMinute: key.perMinute,
          perDay: key.perDay,
          createdAt: key.createdAt,
          lastUsedAt: key.lastUsedAt,
          expiresAt: key.expiresAt,
          callsTotal: key.callsTotal,
          note: key.note,
        })),
        revokedCount: keys.length - live.length,
        used: {
          windowHours: hours,
          calls: mine?.count ?? 0,
          failed: mine?.failed ?? 0,
          lastAt: mine?.lastAt ?? null,
        },
        // What to actually do with the key, built for this deployment rather
        // than left as a docs link the member has no access to.
        endpoint: new URL("/api/search", request.url).toString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
