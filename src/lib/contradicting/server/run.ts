import "server-only";

// One path for every new line, whether it came from the pendant or was typed
// in the app: fold it in, let the word engine look for a contradiction, and
// ask Claude only for denials the words couldn't place.

import { detectDenial, ingest, makeReceipt, type Receipt, type Segment, type Line } from "../engine";
import { aiMatch } from "./ai";
import { readRecord, updateRecord } from "./store";

export async function addLines(uid: string, segs: Segment[], sessionId: string, source: Line["source"]) {
  const now = new Date();
  const first = await updateRecord(uid, (doc) => {
    const r = ingest(doc, segs, { sessionId, now, source });
    return { doc: r.doc, out: r };
  });
  const receipts: Receipt[] = [...first.out.receipts];
  const caught = new Set(receipts.map((r) => r.denialLineId));
  const open = first.out.added.filter((l) => l.personId && !caught.has(l.id) && detectDenial(l.text));
  if (open.length === 0) return { doc: first.doc, receipts };

  const snapshot = await readRecord(uid);
  const found: Receipt[] = [];
  for (const line of open.slice(0, 2)) {
    const m = await aiMatch(snapshot, line);
    if (m) found.push(makeReceipt(line, m, "ai", now));
  }
  if (found.length === 0) return { doc: first.doc, receipts };
  const second = await updateRecord(uid, (doc) => {
    const fresh = found.filter((r) => !doc.receipts.some((x) => x.denialLineId === r.denialLineId));
    return { doc: { ...doc, receipts: [...doc.receipts, ...fresh] }, out: fresh };
  });
  return { doc: second.doc, receipts: [...receipts, ...second.out] };
}
