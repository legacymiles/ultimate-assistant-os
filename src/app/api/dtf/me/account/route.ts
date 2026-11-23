import { errorResponse, requireUser } from "@/lib/dtf/server/access";
import { deleteAsset, deleteProject, listAssets, listOrders, listProjects } from "@/lib/dtf/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Delete everything this customer stored in DTF Studio: saved designs and
 * uploads. Files that belong to an order the shop still has to make or
 * account for are kept (they are part of that order's record) and the reply
 * says how many.
 */
export async function DELETE() {
  try {
    const user = await requireUser();
    const orders = await listOrders({ userId: user.id, limit: 1000 });
    const keep = new Set<string>();
    for (const o of orders) {
      for (const it of o.items) {
        for (const l of it.project.layers) if (l.kind === "image") keep.add(l.assetId), l.sourceAssetId && keep.add(l.sourceAssetId);
        for (const r of it.project.references) keep.add(r.id);
        for (const m of Object.values(it.mockups)) if (m) keep.add(m);
      }
    }
    const projects = await listProjects(user.id);
    for (const p of projects) await deleteProject(user.id, p.id);
    const assets = await listAssets(user.id);
    let kept = 0;
    let removed = 0;
    for (const a of assets) {
      if (keep.has(a.id)) {
        kept++;
        continue;
      }
      await deleteAsset(a);
      removed++;
    }
    return Response.json({ ok: true, projects: projects.length, files: removed, keptForOrders: kept });
  } catch (e) {
    return errorResponse(e);
  }
}
