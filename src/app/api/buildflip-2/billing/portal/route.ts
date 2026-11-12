import { fail, requireUser } from "@/lib/buildflip-2/api";
import { stripe } from "@/lib/buildflip-2/billing/stripe";
import { saveAccount } from "@/lib/buildflip-2/db/account";
import { appUrl } from "@/lib/buildflip-2/flags";
import { withLogging, log } from "@/lib/buildflip-2/log";
import { templates, sendMail } from "@/lib/buildflip-2/email";

export const runtime = "nodejs";

/**
 * POST /api/billing/portal — Stripe's own billing portal: current plan, next
 * charge, invoices, change plan, cancel. Cancelling is as easy as signing up.
 *
 * In demo mode (no Stripe key) this cancels the simulated subscription
 * immediately and says so, rather than dead-ending.
 */
export const POST = withLogging("portal", async () => {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const s = stripe();
  if (!s || !auth.ctx.account.stripeCustomerId) {
    if (auth.ctx.account.subscription?.status === "simulated") {
      await saveAccount({ ...auth.ctx.account, plan: "free", subscription: null });
      void sendMail(templates.cancelled(auth.ctx.user.email, null));
      return Response.json({
        simulated: true,
        message:
          "Your simulated Pro subscription is cancelled. Nothing was ever charged. Every plan you made is still yours.",
      });
    }
    return fail(
      400,
      "There's no subscription to manage yet. Nothing has been charged to you.",
    );
  }

  try {
    const session = await s.billingPortal.sessions.create({
      customer: auth.ctx.account.stripeCustomerId,
      return_url: appUrl("/settings"),
    });
    return Response.json({ url: session.url });
  } catch (err) {
    await log({
      level: "error",
      event: "portal_failed",
      userId: auth.ctx.user.id,
      message: (err as Error)?.message,
    });
    return fail(502, "We couldn't open the billing portal. Try again in a moment.");
  }
});
