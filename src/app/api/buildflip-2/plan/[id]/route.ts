import { fail, guardRate, requireUser } from "@/lib/buildflip-2/api";
import { deleteProject, getProject, saveProject } from "@/lib/buildflip-2/db/projects";
import { z } from "zod";
import { withLogging } from "@/lib/buildflip-2/log";
import { projectPatch, readJson } from "@/lib/buildflip-2/validate";
import type { Project } from "@/lib/buildflip-2/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withLogging("plan_get", async (_req: Request, ctx: Params) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const project = await getProject(auth.ctx.user.id, id);
  if (!project) return fail(404, "That plan doesn't exist, or isn't yours.");
  return Response.json({ project });
});

/**
 * PATCH /api/plan/[id] — the one write path for every in-plan edit: dimensions,
 * stage, asking price, checked steps, the shopping list, a hand-corrected price.
 * Ownership comes from the session, never from the body (S4).
 */
export const PATCH = withLogging("plan_patch", async (req: Request, ctx: Params) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const limited = await guardRate(auth.ctx.user.id, "write");
  if (limited) return limited;

  const { id } = await ctx.params;
  const parsed = await readJson(req, projectPatch);
  if (!parsed.ok) return fail(400, parsed.error);
  const patch = parsed.data;

  /**
   * Read-modify-write with a revision check, retried once.
   *
   * Two PATCHes land at the same time routinely: the dimension slider saves
   * after 450ms and the shopping list after 700ms, and a phone and a laptop
   * can both be open. Without the check, whichever lands second wins the whole
   * record and the other's change vanishes on the next refresh.
   */
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await applyPatch(auth.ctx.user.id, id, patch);
    if (result.status === "ok") return Response.json({ project: result.project });
    if (result.status === "missing") {
      return fail(404, "That plan doesn't exist, or isn't yours.");
    }
    // stale — loop and replay against the record as it now stands
  }
  return fail(
    409,
    "That plan was being changed in another tab at the same time. Nothing was lost — open it again and redo that one change.",
  );
});

type PatchResult =
  | { status: "ok"; project: Project }
  | { status: "missing" }
  | { status: "stale" };

async function applyPatch(
  userId: string,
  id: string,
  patch: z.infer<typeof projectPatch>,
): Promise<PatchResult> {
  const project = await getProject(userId, id);
  if (!project) return { status: "missing" };

  const next: Project = { ...project };

  if (patch.title !== undefined) next.title = patch.title;
  if (patch.stage !== undefined) next.stage = patch.stage;
  if (patch.askingPrice !== undefined) next.askingPrice = patch.askingPrice;
  if (patch.hourlyTarget !== undefined) next.hourlyTarget = patch.hourlyTarget;
  if (patch.estimatedHours !== undefined) next.estimatedHours = patch.estimatedHours;

  if (patch.dimensions) {
    next.dimensions = next.dimensions.map((d) => {
      const hit = patch.dimensions!.find((p) => p.key === d.key);
      if (!hit) return d;
      return { ...d, value: Math.min(Math.max(hit.value, d.min), d.max) };
    });
  }

  if (patch.stepDone) {
    next.steps = next.steps.map((s) =>
      s.id === patch.stepDone!.id ? { ...s, done: patch.stepDone!.done } : s,
    );
  }

  if (patch.shopping) {
    const valid = new Set(next.materials.map((m) => m.id));
    // Dedupe by materialId so a double-tap can never produce two rows (D5).
    const byId = new Map<string, boolean>();
    for (const item of patch.shopping) {
      if (valid.has(item.materialId)) byId.set(item.materialId, item.checked);
    }
    next.shopping = next.materials.map((m) => ({
      materialId: m.id,
      checked: byId.get(m.id) ?? false,
    }));
  }

  if (patch.materialPrice) {
    next.materials = next.materials.map((m) =>
      m.id === patch.materialPrice!.id
        ? {
            ...m,
            unitPrice: patch.materialPrice!.unitPrice,
            userOverride: true,
            provenance: {
              ...m.provenance,
              source: "You set this price",
              url: null,
              checkedAt: new Date().toISOString(),
              confidence: "high",
              note: "Your own price, which beats anything we found.",
              demo: false,
            },
          }
        : m,
    );
  }

  try {
    const saved = await saveProject(next, project.rev ?? 0);
    return { status: "ok", project: saved };
  } catch (err) {
    if ((err as Error)?.name === "StaleWriteError") return { status: "stale" };
    throw err;
  }
}

/** DELETE /api/plan/[id] — gone, with its share link (D4). */
export const DELETE = withLogging("plan_delete", async (_req: Request, ctx: Params) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const project = await getProject(auth.ctx.user.id, id);
  if (!project) return Response.json({ deleted: true }); // idempotent (D5)
  await deleteProject(auth.ctx.user.id, id);
  return Response.json({ deleted: true });
});
