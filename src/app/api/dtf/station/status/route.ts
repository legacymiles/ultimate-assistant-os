// POST /api/dtf/station/status — the station reports what happened to a job.
// Body: { orderId, jobId, status: "downloaded" | "opened" | "printed" | "failed", path?, error? }
// Bearer token only (exact path in TOKEN_AUTH_PATHS). "downloaded" is the
// station's own report once the file is on disk; opened / printed / failed are
// only ever sent because the operator clicked a button on the station page.

import { requireStation, errorResponse, HttpError } from "@/lib/dtf/server/access";
import { setJobStatus, stationJobView, STATION_REPORTABLE, type StationReportable } from "@/lib/dtf/server/jobs";

export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{4,80}$/;

function isReportable(s: unknown): s is StationReportable {
  return typeof s === "string" && (STATION_REPORTABLE as readonly string[]).includes(s);
}

export async function POST(req: Request): Promise<Response> {
  try {
    await requireStation(req);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "Send a JSON body.");
    }
    const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const orderId = typeof b.orderId === "string" ? b.orderId : "";
    const jobId = typeof b.jobId === "string" ? b.jobId : "";
    if (!ID.test(orderId) || !ID.test(jobId)) throw new HttpError(400, "orderId and jobId are required.");
    const status = b.status;
    if (!isReportable(status)) throw new HttpError(400, `status must be one of: ${STATION_REPORTABLE.join(", ")}.`);
    const path = typeof b.path === "string" ? b.path : undefined;
    const error = typeof b.error === "string" ? b.error : undefined;
    if (status === "failed" && !error?.trim()) throw new HttpError(400, "Say what went wrong when reporting a problem.");

    const { order, job } = await setJobStatus(orderId, jobId, status, "station", { path, error });
    return Response.json({ ok: true, job: stationJobView(order, job), orderStatus: order.status });
  } catch (err) {
    return errorResponse(err);
  }
}
