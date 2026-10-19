import { body, fail, viewerUid } from "@/lib/social-personas/server/http";
import { unschedule } from "@/lib/social-personas/server/queue";

export const runtime = "nodejs";

// POST { draftId, accountIds? } — takes a draft's waiting posts off the queue.
export async function POST(req: Request) {
  const b = await body(req);
  const draftId = typeof b?.draftId === "string" ? b.draftId.slice(0, 64) : "";
  if (!draftId) return fail(400, "Which post? (missing draftId)");
  const ids = Array.isArray(b?.accountIds) ? b!.accountIds.filter((x: unknown) => typeof x === "string").slice(0, 20) : undefined;
  const jobs = await unschedule(await viewerUid(), draftId, ids);
  return Response.json({ jobs: jobs.filter((j) => j.draftId === draftId) });
}
