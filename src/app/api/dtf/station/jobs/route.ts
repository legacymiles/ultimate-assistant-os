// GET /api/dtf/station/jobs — the print station's poll.
// Bearer token only (exact path in TOKEN_AUTH_PATHS). Lists jobs that are
// queued, downloaded or opened, oldest order first, plus the active printer's
// "the RIP owns these" checklist for PRODUCTION.txt. Read-only.

import { requireStation, errorResponse } from "@/lib/dtf/server/access";
import { listStationJobs } from "@/lib/dtf/server/jobs";
import { getSettings } from "@/lib/dtf/server/store";
import { getPrinter } from "@/lib/dtf/printers";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    await requireStation(req);
    const [jobs, settings] = await Promise.all([listStationJobs(), getSettings()]);
    const p = getPrinter(settings.printerId);
    return Response.json(
      {
        jobs,
        serverTime: new Date().toISOString(),
        printer: { id: p.id, name: p.name, rip: p.rip, ripOwns: p.ripOwns },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
