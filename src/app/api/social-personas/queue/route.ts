import { viewerUid } from "@/lib/social-personas/server/http";
import { readJobs, runDue } from "@/lib/social-personas/server/queue";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET [?run=1] — the viewer's posting queue. With run=1 it first sends
// anything that is due, so an open Studio page keeps the schedule moving even
// between scheduled ticks.
export async function GET(req: Request) {
  const uid = await viewerUid();
  if (new URL(req.url).searchParams.get("run") === "1") {
    try {
      await runDue(uid, { limit: 2, budgetMs: 40_000 });
    } catch (err) {
      console.error("[personas-studio] queue run failed:", err);
    }
  }
  const jobs = await readJobs(uid);
  return Response.json({ jobs: jobs.map(({ uid: _u, connectionId: _c, ...j }) => j) });
}
