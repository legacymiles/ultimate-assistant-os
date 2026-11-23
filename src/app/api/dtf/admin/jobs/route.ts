import { errorResponse, HttpError, requireOwner } from "@/lib/dtf/server/access";
import { setJobStatus } from "@/lib/dtf/server/jobs";
import type { PrintJobStatus } from "@/lib/dtf/types";

export const dynamic = "force-dynamic";

/** The moves the OWNER makes on a print job. "printed" is the operator's click at the station. */
const OWNER_MOVES: PrintJobStatus[] = ["queued", "file_ready", "failed", "printed"];

/**
 * Batch-move print jobs: send to the station queue, take back out, mark failed
 * (re-print), or mark printed (when the operator printed without the station).
 * Body: { moves: [{ orderId, jobId, to, error? }] }. Each move is validated on
 * its own; the reply lists what happened to each.
 */
export async function POST(req: Request) {
  try {
    await requireOwner();
    const body = (await req.json().catch(() => null)) as { moves?: { orderId: string; jobId: string; to: PrintJobStatus; error?: string }[] } | null;
    const moves = body?.moves ?? [];
    if (!moves.length || moves.length > 100) throw new HttpError(400, "Send between 1 and 100 moves.");
    const results = [];
    for (const m of moves) {
      if (!OWNER_MOVES.includes(m.to)) {
        results.push({ jobId: m.jobId, ok: false, error: "That move isn't allowed from the dashboard." });
        continue;
      }
      try {
        await setJobStatus(m.orderId, m.jobId, m.to, "owner", m.to === "failed" ? { error: (m.error || "Marked for re-print by the shop.").slice(0, 300) } : undefined);
        results.push({ jobId: m.jobId, ok: true });
      } catch (e) {
        results.push({ jobId: m.jobId, ok: false, error: e instanceof Error ? e.message : "Failed." });
      }
    }
    return Response.json({ results });
  } catch (e) {
    return errorResponse(e);
  }
}
