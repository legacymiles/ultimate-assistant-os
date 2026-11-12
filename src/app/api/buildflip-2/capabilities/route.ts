import { CAPABILITY_COPY, capabilities } from "@/lib/buildflip-2/flags";
import { isTestMode } from "@/lib/buildflip-2/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/capabilities — what is actually connected, so the UI can tell the
 * truth about demo mode instead of guessing. No secrets are returned: only
 * booleans and the names of the variables that would switch each thing on.
 */
export async function GET() {
  const caps = capabilities();
  const missing = (Object.keys(CAPABILITY_COPY) as (keyof typeof CAPABILITY_COPY)[])
    .filter((k) => !caps[k])
    .map((k) => ({ id: k, ...CAPABILITY_COPY[k] }));

  return Response.json(
    { capabilities: caps, missing, stripeTestMode: isTestMode() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
