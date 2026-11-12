import { requireUser } from "@/lib/buildflip-2/api";
import { listProjects, userAccuracy } from "@/lib/buildflip-2/db/projects";
import { entitlement } from "@/lib/buildflip-2/db/account";
import { withLogging } from "@/lib/buildflip-2/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/plan — every plan this user owns, newest first (U6). */
export const GET = withLogging("plan_list", async () => {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const projects = await listProjects(auth.ctx.user.id);
  return Response.json({
    projects,
    accuracy: userAccuracy(projects),
    entitlement: entitlement(auth.ctx.account),
    account: {
      plan: auth.ctx.account.plan,
      plansGenerated: auth.ctx.account.plansGenerated,
      hourlyTarget: auth.ctx.account.hourlyTarget,
      onboarded: auth.ctx.account.onboarded,
      role: auth.ctx.account.role,
    },
  });
});
