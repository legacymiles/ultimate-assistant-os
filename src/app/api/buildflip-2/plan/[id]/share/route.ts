import { nanoid } from "nanoid";
import { fail, guardRate, requireUser } from "@/lib/buildflip-2/api";
import { getProject, saveProject } from "@/lib/buildflip-2/db/projects";
import { keys, userStore } from "@/lib/buildflip-2/db/store";
import { appUrl } from "@/lib/buildflip-2/flags";
import { withLogging } from "@/lib/buildflip-2/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export interface ShareRecord {
  projectId: string;
  ownerId: string;
  enabled: boolean;
  createdAt: string;
}

/**
 * POST — create (or re-enable) this plan's own share link (L2).
 * Each plan gets its own token, and it can be switched off at any time, which
 * revokes that link without touching any other.
 */
export const POST = withLogging("share_create", async (_req: Request, ctx: Params) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const limited = await guardRate(auth.ctx.user.id, "write");
  if (limited) return limited;

  const { id } = await ctx.params;
  const project = await getProject(auth.ctx.user.id, id);
  if (!project) return fail(404, "That plan doesn't exist, or isn't yours.");

  const store = await userStore(auth.ctx.user.id);
  if (!store) return fail(503, "Sharing needs a database connection.");

  // Reuse the existing token so the same plan keeps one stable link (D5).
  const token = project.share?.token ?? nanoid(18);
  const record: ShareRecord = {
    projectId: project.id,
    ownerId: auth.ctx.user.id,
    enabled: true,
    createdAt: project.share?.createdAt ?? new Date().toISOString(),
  };
  await store.set(keys.share(token), record);

  const saved = await saveProject({
    ...project,
    share: { token, enabled: true, createdAt: record.createdAt },
  });

  return Response.json({
    url: appUrl(`/share/${token}`),
    token,
    project: saved,
  });
});

/** DELETE — switch the link off. The URL stops working immediately. */
export const DELETE = withLogging("share_revoke", async (_req: Request, ctx: Params) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const project = await getProject(auth.ctx.user.id, id);
  if (!project) return fail(404, "That plan doesn't exist, or isn't yours.");
  if (!project.share) return Response.json({ project });

  const store = await userStore(auth.ctx.user.id);
  if (store) {
    await store.set(keys.share(project.share.token), {
      projectId: project.id,
      ownerId: auth.ctx.user.id,
      enabled: false,
      createdAt: project.share.createdAt,
    } satisfies ShareRecord);
  }

  const saved = await saveProject({
    ...project,
    share: { ...project.share, enabled: false },
  });
  return Response.json({ project: saved });
});
