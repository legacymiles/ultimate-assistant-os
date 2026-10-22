import "server-only";

// ---------------------------------------------------------------------------
// Skill call counts — one app_state row per account (key USAGE_KEY).
//
// Written from three doors, all on the server: the token route Claude Code's
// hook posts to (/api/jarvis/skills/usage), the connector's get_skill, and the
// Jarvis chat when a Studio workflow runs. Read by the Skills Library through
// /api/skills/usage with the signed-in session.
//
// Read-modify-write with last write wins, like every app_state row. Two calls
// landing in the same instant can lose one increment; for a "which skills do I
// use most" view that is the right trade against a new table and migration.
// Every write is best-effort: counting must never break the call it rides on.
// ---------------------------------------------------------------------------

import type { MemoryContext } from "@/lib/jarvis/server/memory";
import { addBackfill, addEvents, cleanUsage, USAGE_KEY, type UsageData, type UsageEvent } from "../usage";

type Db = MemoryContext["db"];

export async function readUsage(db: Db, userId: string): Promise<UsageData> {
  const { data, error } = await db.from("app_state").select("data").eq("user_id", userId).eq("key", USAGE_KEY).maybeSingle();
  if (error) throw new Error(error.message);
  return cleanUsage(data?.data);
}

async function writeUsage(db: Db, userId: string, value: UsageData): Promise<void> {
  const { error } = await db
    .from("app_state")
    .upsert({ user_id: userId, key: USAGE_KEY, data: value as unknown as object }, { onConflict: "user_id,key" });
  if (error) throw new Error(error.message);
}

/** Count live calls. Returns how many were counted. */
export async function recordSkillUse(ctx: Pick<MemoryContext, "db" | "userId">, events: UsageEvent[]): Promise<number> {
  if (!events.length) return 0;
  const data = await readUsage(ctx.db, ctx.userId);
  const added = addEvents(data, events);
  if (added) await writeUsage(ctx.db, ctx.userId, data);
  return added;
}

/** Same, but swallows every error — for calls riding on another request. */
export async function noteSkillUse(ctx: Pick<MemoryContext, "db" | "userId">, events: UsageEvent[]): Promise<void> {
  try {
    await recordSkillUse(ctx, events);
  } catch {
    /* a count must never break the call it rides on */
  }
}

/** A machine's past calls, counted once per machine. */
export async function recordBackfill(
  ctx: Pick<MemoryContext, "db" | "userId">,
  host: string,
  counts: Record<string, { count?: unknown; first?: unknown; last?: unknown }>,
  force = false,
): Promise<{ added: number; already: boolean }> {
  const data = await readUsage(ctx.db, ctx.userId);
  if (force && data.backfilled) delete data.backfilled[String(host).trim().toLowerCase()];
  const r = addBackfill(data, host, counts);
  if (!r.already) await writeUsage(ctx.db, ctx.userId, data);
  return r;
}
