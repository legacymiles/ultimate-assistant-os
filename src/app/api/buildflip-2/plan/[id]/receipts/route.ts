import { nanoid } from "nanoid";
import { fail, guardRate, requireUser } from "@/lib/buildflip-2/api";
import { getProject, saveProject } from "@/lib/buildflip-2/db/projects";
import { withLogging } from "@/lib/buildflip-2/log";
import { readJson, receiptInput } from "@/lib/buildflip-2/validate";
import { UPGRADE_MOMENTS } from "@/lib/buildflip-2/billing/plans";
import { MONETIZATION_ENABLED } from "@/lib/buildflip-2/flags";
import { estimateAccuracy } from "@/lib/buildflip-2/calc";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST — log what you actually paid. This is the feature that closes the loop:
 * these receipts are what sharpen future estimates for this build type.
 */
export const POST = withLogging("receipt_add", async (req: Request, ctx: Params) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  // Pro gate, enforced on the server (S3).
  if (MONETIZATION_ENABLED && auth.ctx.account.plan !== "pro") {
    return fail(402, UPGRADE_MOMENTS.receipts.body, {
      paywall: true,
      moment: "receipts",
    });
  }

  const limited = await guardRate(auth.ctx.user.id, "write");
  if (limited) return limited;

  const { id } = await ctx.params;
  const parsed = await readJson(req, receiptInput);
  if (!parsed.ok) return fail(400, parsed.error);

  const project = await getProject(auth.ctx.user.id, id);
  if (!project) return fail(404, "That plan doesn't exist, or isn't yours.");

  if (parsed.data.materialId) {
    const known = project.materials.some((m) => m.id === parsed.data.materialId);
    if (!known) return fail(400, "That item isn't on this plan's materials list.");
  }

  if (project.receipts.length >= 300) {
    return fail(400, "That's 300 receipts on one plan — start a new plan for the next build.");
  }

  const receipt = {
    id: nanoid(10),
    materialId: parsed.data.materialId ?? null,
    label: parsed.data.label,
    amount: Math.round(parsed.data.amount * 100) / 100,
    paidAt: parsed.data.paidAt ?? new Date().toISOString().slice(0, 10),
    store: parsed.data.store,
    note: parsed.data.note,
  };

  const saved = await saveProject({
    ...project,
    receipts: [receipt, ...project.receipts], // newest first (U6)
    stage: project.stage === "priced" || project.stage === "idea" ? "shopping" : project.stage,
  });

  return Response.json({ project: saved, accuracy: estimateAccuracy(saved) });
});

/** DELETE — remove one receipt. Idempotent. */
export const DELETE = withLogging("receipt_delete", async (req: Request, ctx: Params) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const parsed = await readJson(req, z.object({ receiptId: z.string().max(60) }));
  if (!parsed.ok) return fail(400, parsed.error);

  const project = await getProject(auth.ctx.user.id, id);
  if (!project) return fail(404, "That plan doesn't exist, or isn't yours.");

  const saved = await saveProject({
    ...project,
    receipts: project.receipts.filter((r) => r.id !== parsed.data.receiptId),
  });
  return Response.json({ project: saved, accuracy: estimateAccuracy(saved) });
});
