import { loadConnection } from "@/lib/social-personas/server/connectors";
import { body, fail, viewerUid } from "@/lib/social-personas/server/http";
import { explain, readInbox, type InboxProblem } from "@/lib/social-personas/server/inbox";
import type { InboxThread } from "@/lib/social-personas/inbox";
import { hasInbox } from "@/lib/social-personas/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST { accounts: [{ accountId, connectionId }] } → { threads, problems }
// Reads every connected Instagram / Facebook Page / YouTube account of one
// persona at once. One account failing never hides the others: its problem
// comes back next to the threads that did load.
export async function POST(req: Request) {
  const b = await body(req);
  const list = (Array.isArray(b?.accounts) ? b.accounts : [])
    .filter((a: any) => typeof a?.accountId === "string" && typeof a?.connectionId === "string")
    .slice(0, 12) as { accountId: string; connectionId: string }[];
  if (!list.length) return Response.json({ threads: [], problems: [] });
  const uid = await viewerUid();

  const results = await Promise.all(
    list.map(async ({ accountId, connectionId }) => {
      const conn = await loadConnection(connectionId.slice(0, 64));
      if (!conn) return { accountId, problem: { error: "That login is gone — connect the account again.", reconnect: true } as InboxProblem };
      if (conn.ownerUid !== uid) return { accountId, problem: { error: "That account is connected to another login." } as InboxProblem };
      if (!hasInbox(conn.platform)) return { accountId, threads: [] as InboxThread[] };
      try {
        return { accountId, threads: await readInbox(conn, accountId) };
      } catch (err) {
        console.error(`[social-personas/inbox] ${conn.platform} read failed:`, err);
        const problem = explain(conn.platform, err);
        // A login made before the inbox existed simply lacks the permission.
        if (!conn.canInbox && !problem.reconnect) problem.needsInbox = true;
        return { accountId, platform: conn.platform, problem };
      }
    }),
  );

  return Response.json(
    {
      threads: results.flatMap((r) => r.threads ?? []),
      problems: results.filter((r) => r.problem).map((r) => ({ accountId: r.accountId, ...r.problem })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
