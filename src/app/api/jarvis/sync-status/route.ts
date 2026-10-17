import { NextResponse } from "next/server";
import { mcpConfig, mcpReady } from "@/lib/jarvis/server/mcpAuth";
import { memoryContext } from "@/lib/jarvis/server/memory";
import { listSkills } from "@/lib/jarvis/server/skills";
import { readSyncStatus } from "@/lib/jarvis/server/syncStatus";
import type { SyncStatusReport } from "@/lib/jarvis/syncSteps";

// GET /api/jarvis/sync-status — is memory + skill sync set up, and who has
// connected? For the signed-in owner (session cookie). Never returns a secret:
// env vars come back as booleans, and the only id is the caller's own.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MISSING: { key: keyof ReturnType<typeof mcpConfig>; env: string; how: string }[] = [
  { key: "supabaseSet", env: "NEXT_PUBLIC_SUPABASE_URL", how: "Your Supabase project URL." },
  { key: "serviceKeySet", env: "SUPABASE_SERVICE_ROLE_KEY", how: "Supabase › Project settings › API." },
  { key: "userIdSet", env: "JARVIS_MCP_USER_ID", how: "Your Supabase user id (shown here once you sign in)." },
  { key: "tokenSet", env: "JARVIS_MCP_TOKEN", how: "A long random string — Generate one on the Skills everywhere card." },
];

export async function GET() {
  const cfg = mcpConfig();
  const report: SyncStatusReport = {
    server: { ready: mcpReady(), missing: MISSING.filter((m) => !cfg[m.key]).map(({ env, how }) => ({ env, how })) },
    account: { signedIn: false, userId: null, matchesConnector: null },
    skills: null,
    connector: null,
    devices: [],
  };

  const ctx = await memoryContext();
  if (ctx.available) {
    const pinned = process.env.JARVIS_MCP_USER_ID ?? "";
    report.account = { signedIn: true, userId: ctx.userId, matchesConnector: pinned ? pinned === ctx.userId : null };
    const [status, skills] = await Promise.all([readSyncStatus(ctx), listSkills(ctx).catch(() => null)]);
    report.skills = skills ? { count: skills.filter((s) => s.complete).length } : null;
    report.connector = status.connector ?? null;
    report.devices = Object.values(status.devices ?? {}).map((d) => ({
      host: d.host,
      os: d.os,
      lastSeen: d.lastSeen,
      lastAction: d.lastAction,
      skillCount: d.skillCount,
    }));
  }
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
