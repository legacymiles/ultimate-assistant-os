import { NextResponse } from "next/server";
import { mcpContext } from "@/lib/jarvis/server/mcpAuth";
import { vaultFiles } from "@/lib/memory-rules/rules";
import { readRules, routersFor } from "@/lib/memory-rules/server/store";

// ---------------------------------------------------------------------------
// The memory rules as a folder of markdown files, for the PC and the VPS.
//
// `node scripts/skill-sync.mjs rules` (run on SessionStart with pull) writes
// these into ~/Jarvis Vault/jarvis-memory, so Claude Code reads the same area
// routers, daily log and findings as plain text. Same bearer token as the
// jarvis-memory connector. Read-only: the database stays the source of truth.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const ctx = mcpContext(req);
  if (!ctx.available) return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  const [doc, routers] = await Promise.all([readRules(ctx.userId), routersFor(ctx)]);
  return NextResponse.json({ files: vaultFiles(doc, routers), at: new Date().toISOString() });
}
