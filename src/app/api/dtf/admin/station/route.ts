// /api/dtf/admin/station — pair, check and unpair the Windows print station.
// Owner only (behind the hub's owner gate AND checked here).
//
//   GET    → { paired, pairedAt, lastSeenAt, host, exportDir, online }
//   POST   → mints a new token, stores only its SHA-256, returns it ONCE.
//            Any previously paired station stops working immediately.
//   DELETE → unpairs; the old token stops working.

import { randomBytes } from "node:crypto";
import { errorResponse, hashToken, requireOwner } from "@/lib/dtf/server/access";
import { getStation, putStation, type StationRecord } from "@/lib/dtf/server/store";

export const dynamic = "force-dynamic";

const ONLINE_MS = 2 * 60_000;
const NO_STORE = { "Cache-Control": "no-store" };

// Unpairing writes a record with an empty hash rather than null: the remote
// dtf_settings.data column is NOT NULL, and an empty hash can never match a
// presented token (requireStation compares 32-byte digests).
function isPaired(rec: StationRecord | null): rec is StationRecord {
  return Boolean(rec && /^[0-9a-f]{64}$/.test(rec.tokenHash));
}

function view(rec: StationRecord | null) {
  if (!isPaired(rec)) {
    return { paired: false, pairedAt: null, lastSeenAt: null, host: null, exportDir: null, online: false };
  }
  const seen = rec.lastSeenAt ? Date.parse(rec.lastSeenAt) : NaN;
  return {
    paired: true,
    pairedAt: rec.createdAt,
    lastSeenAt: rec.lastSeenAt ?? null,
    host: rec.lastSeenHost ?? null,
    exportDir: rec.exportDir ?? null,
    online: Number.isFinite(seen) && Date.now() - seen < ONLINE_MS,
  };
}

export async function GET(): Promise<Response> {
  try {
    await requireOwner();
    return Response.json(view(await getStation()), { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(): Promise<Response> {
  try {
    await requireOwner();
    const token = randomBytes(32).toString("base64url");
    const rec: StationRecord = { tokenHash: hashToken(token), createdAt: new Date().toISOString() };
    await putStation(rec);
    return Response.json(
      {
        ...view(rec),
        token,
        message: "Copy this token into station.config.json on the print PC now. It is shown once and cannot be recovered.",
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(): Promise<Response> {
  try {
    await requireOwner();
    await putStation({ tokenHash: "", createdAt: new Date().toISOString() });
    return Response.json(view(null), { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
