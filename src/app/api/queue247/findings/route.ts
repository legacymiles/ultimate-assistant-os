// The research library: every finding, searchable.
// GET ?kind=mt4-bot&q=grid&order=score&app=trading-studio&taskId=&limit=

import { NextResponse } from "next/server";
import { errorJson, signedIn } from "@/lib/queue247/server/auth";
import { queueDb } from "@/lib/queue247/server/db";
import { listFindings } from "@/lib/queue247/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const who = await signedIn();
  if ("error" in who) return who.error;
  const p = new URL(req.url).searchParams;
  try {
    const findings = await listFindings(queueDb(), who.uid, {
      kind: p.get("kind") || undefined,
      app: p.get("app") || undefined,
      taskId: p.get("taskId") || undefined,
      q: p.get("q") || undefined,
      notableOnly: p.get("notable") === "1",
      order: p.get("order") === "score" ? "score" : "recent",
      limit: Math.max(1, Math.min(300, Number(p.get("limit")) || 100)),
    });
    return NextResponse.json({ findings });
  } catch (e) {
    return errorJson(e);
  }
}
