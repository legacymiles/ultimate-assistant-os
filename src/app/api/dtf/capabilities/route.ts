import { aiConfigured } from "@/lib/ai/provider";
import { caller } from "@/lib/dtf/server/access";
import { emailConfigured } from "@/lib/dtf/server/mail";
import { stripe, stripeTestMode } from "@/lib/dtf/server/orders";
import { getSettings, remoteConfigured } from "@/lib/dtf/server/store";

export const dynamic = "force-dynamic";

/** What is actually connected, said plainly — the studio shows these instead of guessing. */
export async function GET() {
  const who = await caller();
  const settings = await getSettings().catch(() => null);
  return Response.json({
    signedIn: Boolean(who),
    email: who?.email ?? null,
    owner: Boolean(who?.owner),
    local: Boolean(who?.local),
    payments: stripe() ? (stripeTestMode() ? "stripe-test" : "stripe") : "manual",
    ai: aiConfigured() ? "live" : "offline",
    email_sending: emailConfigured(),
    storage: remoteConfigured() ? "cloud" : "local",
    shopName: settings?.shopName ?? "DTF Studio",
    pickupNote: settings?.pickupNote ?? "",
    safeWidthMm: settings?.safeWidthMm ?? 290,
  });
}
