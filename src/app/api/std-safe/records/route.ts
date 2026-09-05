import { readJson, withCaller } from "@/lib/stdsafe/api";
import { addRecord, deleteRecord, mePayload, type RecordInput } from "@/lib/stdsafe/store";
import { deleteReport } from "@/lib/stdsafe/reports";

// Save a confirmed record, or delete one. Both answer with the whole dashboard
// so the status card and the timeline can never drift apart.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return withCaller(async (caller) => {
    const body = await readJson<RecordInput>(req);
    await addRecord(caller, body);
    return mePayload(caller);
  });
}

export async function DELETE(req: Request) {
  return withCaller(async (caller) => {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    // deleteRecord re-checks ownership and throws; the file only goes after it
    // has confirmed the record was this caller's to remove.
    const { fileId } = await deleteRecord(caller, id);
    if (fileId) await deleteReport(caller.userId, fileId);
    return mePayload(caller);
  });
}
