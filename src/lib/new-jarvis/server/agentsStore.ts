import "server-only";

// ---------------------------------------------------------------------------
// Where 24/7 agents live: one server document per account in
// public.server_docs (service role only, no migration — the table already
// exists), or a file under the data directory locally. The same shape and the
// same reasoning as requestsStore.ts beside it.
//
// Per account, because an agent is a standing instruction to use the owner's
// own machines. Both callers resolve to the same account id — the browser
// through its Supabase session, a runner through the jarvis-memory connector
// token pinned to JARVIS_MCP_USER_ID — so an agent filed on the phone is the
// one the laptop picks up when it wakes, which is the entire feature.
// ---------------------------------------------------------------------------

import { readDoc, writeDoc } from "@/lib/server/docStore";
import { dataDir } from "@/lib/recall/dataDir";
import { normalizeDoc, prune, type AgentsDoc } from "../agents/agents";

function docName(uid: string): string {
  // The id goes into a key, so only the characters a Supabase uuid or "local" has.
  return `.agents-247.${uid.replace(/[^a-zA-Z0-9-]/g, "")}.json`;
}

export async function readAgents(uid: string): Promise<AgentsDoc> {
  return prune(normalizeDoc(await readDoc<AgentsDoc>(docName(uid), dataDir())), Date.now());
}

/**
 * Read, change, write.
 *
 * Last write wins between two simultaneous changes, the same guarantee every
 * server document here has. That is survivable for agents because the thing
 * two machines would actually race over — taking the same job twice — is
 * settled by the LEASE inside the document rather than by this write, so a
 * lost update costs a log line, never a duplicated render.
 */
export async function updateAgents(
  uid: string,
  change: (doc: AgentsDoc) => AgentsDoc,
): Promise<AgentsDoc> {
  const next = change(await readAgents(uid));
  const saved = await writeDoc(docName(uid), dataDir(), next);
  if (!saved) {
    throw new Error(
      "Your 24/7 agents could not be saved on this host. On a deployed site it needs SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return next;
}
