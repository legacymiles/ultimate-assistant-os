import { errorResponse, requireOwner } from "@/lib/dtf/server/access";
import { getSettings, putSettings } from "@/lib/dtf/server/store";
import { PRINTERS } from "@/lib/dtf/printers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireOwner();
    return Response.json({ settings: await getSettings(), printers: PRINTERS });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Safe width, gang-sheet spacing, shop name, pickup note. Clamped to what the printer can do. */
export async function PUT(req: Request) {
  try {
    await requireOwner();
    const body = await req.json().catch(() => ({}));
    return Response.json({ settings: await putSettings(body) });
  } catch (e) {
    return errorResponse(e);
  }
}
