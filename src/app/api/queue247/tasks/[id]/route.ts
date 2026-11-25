// One task, everything about it: the row, its runs, its full log, what it
// found, its sub-tasks and the conversation about it.

import { NextResponse } from "next/server";
import { errorJson, signedIn } from "@/lib/queue247/server/auth";
import { queueDb } from "@/lib/queue247/server/db";
import { childrenOf, getTask, listEvents, listFindings, listMessages, listRuns } from "@/lib/queue247/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await signedIn();
  if ("error" in who) return who.error;
  const { id } = await params;
  try {
    const db = queueDb();
    const task = await getTask(db, who.uid, id);
    if (!task) return NextResponse.json({ error: "That task is not in your queue." }, { status: 404 });
    const [runs, events, findings, children, messages] = await Promise.all([
      listRuns(db, id, 50),
      listEvents(db, id, 300),
      listFindings(db, who.uid, { taskId: id, limit: 200, order: "score" }),
      childrenOf(db, who.uid, id),
      listMessages(db, who.uid, id, 60),
    ]);
    return NextResponse.json({ task, runs, events, findings, children, messages });
  } catch (e) {
    return errorJson(e);
  }
}
