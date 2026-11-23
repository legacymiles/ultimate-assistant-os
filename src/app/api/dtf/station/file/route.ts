// GET /api/dtf/station/file?order=<id>&job=<id> — one print file's PNG bytes.
// Bearer token only (exact path in TOKEN_AUTH_PATHS). Only for jobs the owner
// has sent to the station (queued, downloaded, opened, printed). Fetching a
// file never changes its status; the station reports "downloaded" separately
// once the file is safely on disk.

import { requireStation, errorResponse, HttpError } from "@/lib/dtf/server/access";
import { STATION_FILE_OK, suggestedFilename } from "@/lib/dtf/server/jobs";
import { signedDownload } from "@/lib/dtf/server/ingest";
import { assetBytesByKey, getOrder } from "@/lib/dtf/server/store";

export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{4,80}$/;

export async function GET(req: Request): Promise<Response> {
  try {
    await requireStation(req);
    const url = new URL(req.url);
    const orderId = url.searchParams.get("order") ?? "";
    const jobId = url.searchParams.get("job") ?? "";
    if (!ID.test(orderId) || !ID.test(jobId)) throw new HttpError(400, "Pass ?order= and ?job= with valid ids.");

    const order = await getOrder(orderId);
    if (!order) throw new HttpError(404, "That order does not exist.");
    if (order.status === "cancelled") throw new HttpError(409, `Order ${order.number} was cancelled.`);
    const job = order.jobs.find((j) => j.id === jobId);
    if (!job) throw new HttpError(404, `Order ${order.number} has no print job with that id.`);
    if (!STATION_FILE_OK.includes(job.status)) {
      throw new HttpError(409, "That print job has not been sent to the print station.");
    }
    const key = job.file?.key ?? "";
    if (!key || key.includes("..") || /^[\\/]|^[A-Za-z]:/.test(key)) {
      throw new HttpError(404, "That print job has no print file.");
    }
    const name = suggestedFilename(order, job);
    // Cloud storage: redirect to a short-lived signed link. Print files are
    // often over the 4.5 MB a function may return; the station's fetch follows
    // the redirect (and drops its bearer token on the way, as it should).
    const signed = await signedDownload(key, name, 300);
    if (signed) return Response.redirect(signed, 302);

    const bytes = await assetBytesByKey(key);
    if (!bytes) throw new HttpError(404, "The print file is missing from storage. Re-export it from the production dashboard.");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
