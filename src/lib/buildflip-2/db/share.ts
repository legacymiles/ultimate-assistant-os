import type { Project } from "../types";
import { findByKeyAnyUser, keys, serviceStore } from "./store";
import type { ShareRecord } from "@/app/api/buildflip-2/plan/[id]/share/route";

/**
 * Resolve a share token to a read-only plan.
 *
 * The token is the authorisation. It is looked up first; only if it exists AND
 * is enabled do we read the project, and then with the service role because an
 * anonymous visitor has no RLS identity. Switching the link off makes this
 * return null immediately (L2).
 *
 * The returned project is STRIPPED: no receipts, no owner id, no share token.
 * A shared plan is a plan, not a window into someone's spending.
 */
export interface SharedPlan {
  project: Project;
}

/**
 * An explicit allowlist of what a shared plan contains.
 *
 * Deliberately NOT `{...project, receipts: []}`: a spread-with-overrides makes
 * every field public by default, so the next field added to Project leaks
 * silently. This way a new field is private until someone adds it here.
 *
 * Notably excluded: `referenceImages` (the paths embed the owner's user id),
 * `receipts` (what they actually paid), `ownerId`, and the share token itself.
 */
function publicView(project: Project): Project {
  return {
    id: project.id,
    ownerId: "",
    title: project.title,
    summary: project.summary,
    prompt: project.prompt.slice(0, 400),
    sourceUrl: project.sourceUrl,
    sourceRead: project.sourceRead
      ? {
          ok: project.sourceRead.ok,
          title: project.sourceRead.title,
          platform: project.sourceRead.platform,
          reason: project.sourceRead.reason,
        }
      : null,
    referenceImages: [],
    stage: project.stage,
    dimensions: project.dimensions,
    materials: project.materials,
    steps: project.steps,
    tools: project.tools,
    safety: project.safety,
    skillLevel: project.skillLevel,
    estimatedHours: project.estimatedHours,
    hourlyTarget: project.hourlyTarget,
    resale: project.resale,
    askingPrice: project.askingPrice,
    receipts: [],
    shopping: [],
    share: null,
    fallbackReason: project.fallbackReason ?? null,
    buildType: project.buildType,
    calibration: project.calibration,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    error: null,
    generating: false,
  };
}

export async function resolveShare(token: string): Promise<SharedPlan | null> {
  if (!token || token.length < 8 || token.length > 64 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return null;
  }
  const record = await findByKeyAnyUser<ShareRecord>(keys.share(token));
  if (!record?.data?.enabled || !record.data.projectId) return null;

  const project = await serviceStore(record.data.ownerId ?? record.userId).get<Project>(
    keys.project(record.data.projectId),
  );
  if (!project) return null;
  if (!project.share?.enabled || project.share.token !== token) return null;

  return { project: publicView(project) };
}
