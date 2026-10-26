import { NextResponse } from "next/server";
import { mcpContext } from "@/lib/jarvis/server/mcpAuth";
import { recordBackfill, recordSkillUse } from "@/lib/skills/server/usageStore";
import type { UsageEvent } from "@/lib/skills/usage";
import type { SpendEvent } from "@/lib/skills/spend";
import { recordSpendNow } from "@/lib/skills/server/spendStore";
import { priceTurn } from "@/lib/skills/server/priceTokens";

// ---------------------------------------------------------------------------
// Skill calls from Claude Code on the PC and the VPS.
//
// scripts/skill-sync.mjs posts here from a hook every time Claude Code runs a
// skill (the Skill tool, or the owner typing /<skill>), and once per machine
// with the counts from its past sessions. Same token and pinned account as the
// jarvis-memory connector, verified in mcpContext — never a session.
//
//   POST { events: [{ skill, source: "claude-code", at?, id? }] }        -> { counted }
//   POST { backfill: { host, counts: { <skill>: { count, first, last } } }, force? } -> { added, already }
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = mcpContext(req);
  if (!ctx.available) return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  const body = (await req.json().catch(() => null)) as {
    events?: unknown;
    backfill?: { host?: unknown; counts?: unknown };
    force?: unknown;
    spend?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "Body was not JSON." }, { status: 400 });

  try {
    // Tokens each skill's turn used, from the Stop hook (`skill-sync.mjs usage-cost`).
    if (Array.isArray(body.spend)) {
      const events: SpendEvent[] = [];
      for (const raw of body.spend.slice(0, 50)) {
        const r = (raw ?? {}) as Record<string, unknown>;
        const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
        const priced = await priceTurn({ model: String(r.model ?? ""), input: n(r.input), output: n(r.output), cacheRead: n(r.cacheRead), cacheWrite: n(r.cacheWrite) });
        events.push({ skill: String(r.skill ?? ""), source: "claude-code", ...priced, at: typeof r.at === "string" ? r.at : undefined, id: typeof r.id === "string" ? r.id : undefined });
      }
      return NextResponse.json({ counted: await recordSpendNow(events) });
    }
    if (body.backfill) {
      const host = String(body.backfill.host ?? "").trim();
      const counts = body.backfill.counts;
      if (!host || !counts || typeof counts !== "object") {
        return NextResponse.json({ error: "A backfill needs a host and counts." }, { status: 400 });
      }
      const r = await recordBackfill(ctx, host, counts as Record<string, { count?: unknown }>, body.force === true);
      return NextResponse.json(r);
    }
    // Only Claude Code posts here; the other sources are counted where they happen.
    const events = (Array.isArray(body.events) ? body.events : [])
      .slice(0, 50)
      .map((e) => ({ ...(e as UsageEvent), source: "claude-code" as const }));
    return NextResponse.json({ counted: await recordSkillUse(ctx, events) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save the count." }, { status: 500 });
  }
}
