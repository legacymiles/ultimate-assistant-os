import "server-only";

// ---------------------------------------------------------------------------
// Who has actually connected — so Jarvis can say "set up" or "not yet" honestly.
//
// Environment variables only prove the SERVER is ready. Whether the phone has
// the connector, or the VPS ever ran the setup command, can only be known from
// them showing up. So the two doors they come through leave a note:
//
//   - the jarvis-memory connector (phone, claude.ai, Claude Code anywhere)
//     records which client called and when;
//   - the skill API (scripts/skill-sync.mjs on a PC/VPS) records each
//     computer by host name, OS, last pull/push and how many skills it has.
//
// One small JSON row in app_state (key "jarvis:sync-status") per owner. Writes
// are best-effort and never fail the request they ride on; the connector note
// is throttled so a busy session doesn't write on every tool call.
// ---------------------------------------------------------------------------

import type { MemoryContext } from "./memory";

export const STATUS_KEY = "jarvis:sync-status";

export interface DeviceNote {
  host: string;
  os: string;
  lastSeen: string;
  lastAction: string;
  version: string;
  skillCount: number | null;
}

export interface SyncStatusData {
  connector?: { lastSeen: string; clients: Record<string, string> };
  devices?: Record<string, DeviceNote>;
}

async function readRow(ctx: MemoryContext): Promise<SyncStatusData> {
  const { data } = await ctx.db.from("app_state").select("data").eq("user_id", ctx.userId).eq("key", STATUS_KEY).maybeSingle();
  return ((data?.data as SyncStatusData | undefined) ?? {}) as SyncStatusData;
}

async function writeRow(ctx: MemoryContext, value: SyncStatusData): Promise<void> {
  await ctx.db.from("app_state").upsert({ user_id: ctx.userId, key: STATUS_KEY, data: value }, { onConflict: "user_id,key" });
}

export async function readSyncStatus(ctx: MemoryContext): Promise<SyncStatusData> {
  try {
    return await readRow(ctx);
  } catch {
    return {};
  }
}

const clean = (s: unknown, max = 60) =>
  String(s ?? "")
    .replace(/[^\w .@:+()/-]/g, "")
    .trim()
    .slice(0, max);

/** Per warm server instance: when the connector note was last written, per client. */
const lastConnectorWrite = new Map<string, number>();
const CONNECTOR_THROTTLE_MS = 5 * 60_000;

/** Note that a connector client called. `client` is its name, e.g. "claude-ai", "claude-code". */
export async function noteConnector(ctx: MemoryContext, client: string, force = false): Promise<void> {
  const name = clean(client) || "connector";
  const now = Date.now();
  if (!force && now - (lastConnectorWrite.get(name) ?? 0) < CONNECTOR_THROTTLE_MS) return;
  lastConnectorWrite.set(name, now);
  try {
    const row = await readRow(ctx);
    const at = new Date(now).toISOString();
    row.connector = { lastSeen: at, clients: { ...(row.connector?.clients ?? {}), [name]: at } };
    await writeRow(ctx, row);
  } catch {
    /* a status note must never break the call it rides on */
  }
}

/** Note that a computer synced skills. Reads the X-Skill-Sync-* headers the script sends. */
export async function noteDevice(ctx: MemoryContext, req: Request, action: string): Promise<void> {
  const host = clean(req.headers.get("x-skill-sync-host"), 80);
  if (!host) return; // not the sync script (a manual curl, an old script) — nothing to note
  try {
    const row = await readRow(ctx);
    const count = Number(req.headers.get("x-skill-sync-count"));
    row.devices = {
      ...(row.devices ?? {}),
      [host.toLowerCase()]: {
        host,
        os: clean(req.headers.get("x-skill-sync-os"), 20) || "unknown",
        lastSeen: new Date().toISOString(),
        lastAction: clean(action, 20),
        version: clean(req.headers.get("x-skill-sync-version"), 20),
        skillCount: Number.isFinite(count) && count >= 0 ? count : null,
      },
    };
    await writeRow(ctx, row);
  } catch {
    /* best-effort */
  }
}
