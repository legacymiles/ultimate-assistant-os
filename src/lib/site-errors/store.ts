import "server-only";

// The site-error log, kept as one server-owned document (public.server_docs,
// RLS on with no policy — only the service role reads it). No migration to
// run: the table already exists for Tap Safe and the Lists board. Locally it
// is a file under the data directory, like the other server documents.

import { readDoc, writeDoc } from "@/lib/server/docStore";
import { dataDir } from "@/lib/recall/dataDir";
import { record, resolve, type ErrorEntry, type ErrorLog, type ErrorReport } from "./log";

const DOC = ".site-errors.json";

export async function readLog(): Promise<ErrorLog> {
  const doc = await readDoc<ErrorLog>(DOC, dataDir());
  return { entries: Array.isArray(doc?.entries) ? doc.entries : [] };
}

/** Fold one report in. Last write wins between two simultaneous reports, which can only undercount. */
export async function saveReport(report: ErrorReport): Promise<{ entry: ErrorEntry; saved: boolean }> {
  const { log, entry } = record(await readLog(), report, new Date());
  const saved = await writeDoc(DOC, dataDir(), log);
  return { entry, saved };
}

export async function setResolved(id: string, reopen: boolean): Promise<ErrorLog> {
  const log = resolve(await readLog(), id, new Date(), reopen);
  await writeDoc(DOC, dataDir(), log);
  return log;
}
