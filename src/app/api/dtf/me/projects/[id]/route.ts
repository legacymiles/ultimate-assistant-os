import { errorResponse, HttpError, requireUser } from "@/lib/dtf/server/access";
import { deleteProject, getProject } from "@/lib/dtf/server/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const project = await getProject(user.id, id);
    if (!project) throw new HttpError(404, "That design isn't in your account.");
    return Response.json({ project });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    await deleteProject(user.id, id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
