import "server-only";

// ---------------------------------------------------------------------------
// Where In Queue requests live: one server document per account in
// public.server_docs (service role only, no migration — the table already
// exists), or a file under the data directory locally. Per account because
// Jarvis is for other people too: nobody's queue is anyone else's.
//
// Both callers resolve to the same account id — the browser through its
// Supabase session, Claude Code through the jarvis-memory connector token,
// which is pinned to JARVIS_MCP_USER_ID — so a request typed on the phone is
// the one the PC sees, and one completed on the PC is gone from the phone.
// ---------------------------------------------------------------------------

import { readDoc, writeDoc } from "@/lib/server/docStore";
import { dataDir } from "@/lib/recall/dataDir";
import { normalizeDoc, prune, type RequestsDoc } from "../requests";

function docName(uid: string): string {
  // The id goes into a key, so only the characters a Supabase uuid or "local" has.
  return `.queue-requests.${uid.replace(/[^a-zA-Z0-9-]/g, "")}.json`;
}

export async function readRequests(uid: string): Promise<RequestsDoc> {
  return prune(normalizeDoc(await readDoc<RequestsDoc>(docName(uid), dataDir())));
}

/**
 * Read, change, write. Last write wins between two simultaneous changes — the
 * same guarantee every server document here has, and fine for one person's
 * queue. Returns the doc as written, or throws when the host kept nothing.
 */
export async function updateRequests(
  uid: string,
  change: (doc: RequestsDoc) => RequestsDoc,
): Promise<RequestsDoc> {
  const next = change(await readRequests(uid));
  const saved = await writeDoc(docName(uid), dataDir(), next);
  if (!saved) {
    throw new Error("The queue could not be saved on this host. On a deployed site it needs SUPABASE_SERVICE_ROLE_KEY.");
  }
  return next;
}
