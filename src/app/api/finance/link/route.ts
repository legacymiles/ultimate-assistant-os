import { NextResponse } from "next/server";
import { financeContext } from "@/lib/finance/server/context";
import { listConnections, saveConnection } from "@/lib/finance/server/store";
import { configured } from "@/lib/finance/providers/plaid/client";
import { createLinkToken, exchangePublicToken } from "@/lib/finance/providers/plaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What is connected, and whether connecting more is possible at all.
 *
 * Never returns a token, or anything derived from one. With Plaid unconfigured
 * this answers with the reason rather than failing, so the Connect panel can
 * say which variable is missing while the rest of the folder keeps working from
 * the declared-bills ledger.
 */
export async function GET() {
  const ctx = await financeContext();
  const plaid = configured();
  if (!ctx.available) {
    return NextResponse.json({
      available: false,
      reason: ctx.reason,
      plaid: { ...plaid },
      connections: [],
    });
  }
  try {
    return NextResponse.json({
      available: true,
      reason: "",
      plaid: { ...plaid },
      connections: await listConnections(ctx),
    });
  } catch (e) {
    return NextResponse.json({
      available: false,
      reason: e instanceof Error ? e.message : "Could not read connections.",
      plaid: { ...plaid },
      connections: [],
    });
  }
}

/**
 * Two steps of Plaid Link, by `action`:
 *   "token"    — mint the link token that opens Plaid's own bank picker
 *   "exchange" — swap the public token Link hands back for the stored access
 *                token, encrypted on the way in
 */
export async function POST(req: Request) {
  const ctx = await financeContext();
  if (!ctx.available) {
    return NextResponse.json({ ok: false, reason: ctx.reason }, { status: 401 });
  }
  const plaid = configured();
  if (!plaid.ok) return NextResponse.json({ ok: false, reason: plaid.reason }, { status: 400 });

  let body: { action?: string; publicToken?: string; institutionName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "Body must be JSON." }, { status: 400 });
  }

  try {
    if (body.action === "token") {
      const webhook = process.env.PLAID_WEBHOOK_URL || undefined;
      return NextResponse.json({ ok: true, linkToken: await createLinkToken(ctx.userId, webhook) });
    }

    if (body.action === "exchange") {
      if (!body.publicToken) {
        return NextResponse.json({ ok: false, reason: "No public token." }, { status: 400 });
      }
      const { accessToken, itemId } = await exchangePublicToken(body.publicToken);
      const connectionId = await saveConnection(ctx, {
        provider: "plaid",
        accessToken,
        itemId,
        institutionName: body.institutionName ?? "",
      });
      // The token is now encrypted at rest and never leaves the server again.
      return NextResponse.json({ ok: true, connectionId });
    }

    return NextResponse.json({ ok: false, reason: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: e instanceof Error ? e.message : "Plaid refused the request." },
      { status: 502 },
    );
  }
}
