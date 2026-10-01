import { NextResponse } from "next/server";
import { plaidFetch } from "@/lib/finance/providers/plaid/client";
import { plaidKeyFetcher, verifyWebhook } from "@/lib/finance/providers/plaid/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Plaid's webhook endpoint.
//
// This is the ONLY route in the feature reachable without signing in, and it
// writes into the ledger every duplicate-charge alert is computed from. So
// nothing here trusts the request until the signature has verified.
//
// Two details that are easy to get wrong and both silently fatal:
//
// 1. THE RAW BODY IS READ BEFORE PARSING. The signature covers the exact bytes
//    Plaid sent; re-serializing the parsed JSON changes the whitespace and the
//    digest never matches again.
//
// 2. A VERIFICATION FAILURE RETURNS 200, not 401. Plaid retries non-2xx, so a
//    forged or malformed request answered with an error becomes a retry storm
//    pointed at this endpoint. It is logged and dropped instead.
//
// What this route does NOT do is sync inline. A webhook says "there is news";
// acting on it with the owner's own credentials is the signed-in /api/finance/
// sync route's job. That keeps every database write behind RLS as the owner,
// and means a flood of webhooks cannot trigger a flood of Plaid calls.
// ---------------------------------------------------------------------------

interface WebhookBody {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  error?: { error_code?: string } | null;
}

export async function POST(req: Request) {
  // 1 — the bytes exactly as sent, before anything parses them.
  const rawBody = await req.text();

  const verification = await verifyWebhook(
    req.headers.get("plaid-verification"),
    rawBody,
    plaidKeyFetcher((path, body) => plaidFetch(path, body)),
  ).catch((e) => ({ ok: false as const, reason: e instanceof Error ? e.message : "key lookup failed" }));

  if (!verification.ok) {
    // 2 — 200, deliberately. See the note above about retry storms.
    console.warn(`[finance] rejected an unverified Plaid webhook: ${verification.reason}`);
    return NextResponse.json({ received: true });
  }

  let body: WebhookBody = {};
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    return NextResponse.json({ received: true });
  }

  // Verified, so this is Plaid. Record what it said; the signed-in sync route
  // acts on it. Nothing here writes to the ledger.
  const code = `${body.webhook_type ?? "?"}/${body.webhook_code ?? "?"}`;
  console.info(`[finance] Plaid webhook ${code} for item ${body.item_id ?? "?"}`);

  return NextResponse.json({ received: true, code });
}

/** Plaid sends a GET when you configure the URL; answer it plainly. */
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "plaid-webhook" });
}
