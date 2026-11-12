import { fail, guardRate, requireUser } from "@/lib/buildflip-2/api";
import { entitlement, saveAccount } from "@/lib/buildflip-2/db/account";
import { capabilities } from "@/lib/buildflip-2/flags";
import { withLogging } from "@/lib/buildflip-2/log";
import { accountPatch, readJson } from "@/lib/buildflip-2/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLogging("account_get", async () => {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  return Response.json({
    account: auth.ctx.account,
    entitlement: entitlement(auth.ctx.account),
    capabilities: capabilities(),
  });
});

export const PATCH = withLogging("account_patch", async (req: Request) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const limited = await guardRate(auth.ctx.user.id, "write");
  if (limited) return limited;

  const parsed = await readJson(req, accountPatch);
  if (!parsed.ok) return fail(400, parsed.error);

  // Only these fields are writable. plan, role, plansGenerated and the Stripe
  // ids are set by the server alone — a crafted body cannot grant itself Pro.
  const next = {
    ...auth.ctx.account,
    ...(parsed.data.hourlyTarget !== undefined
      ? { hourlyTarget: parsed.data.hourlyTarget }
      : {}),
    ...(parsed.data.theme !== undefined ? { theme: parsed.data.theme } : {}),
    ...(parsed.data.emailOptIn !== undefined
      ? { emailOptIn: parsed.data.emailOptIn }
      : {}),
    ...(parsed.data.onboarded !== undefined ? { onboarded: parsed.data.onboarded } : {}),
  };
  await saveAccount(next);
  return Response.json({ account: next });
});
