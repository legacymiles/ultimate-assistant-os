import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { noteConnector, noteDevice, readSyncStatus } from "./syncStatus";

function fakeCtx() {
  let row: Record<string, unknown> | null = null;
  const writes: unknown[] = [];
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: row ? { data: row } : null, error: null }),
    upsert: async (r: { data: Record<string, unknown> }) => {
      row = r.data;
      writes.push(r);
      return { error: null };
    },
  });
  return { ctx: { available: true as const, userId: "u1", profileId: "owner", db: { from: () => q } }, writes };
}

const req = (h: Record<string, string>) => new Request("http://x/api/jarvis/skills", { headers: h });

describe("who has connected", () => {
  it("notes a computer from the sync script's headers, sanitised", async () => {
    const { ctx } = fakeCtx();
    await noteDevice(ctx, req({ "x-skill-sync-host": "HONEYSUITES<script>", "x-skill-sync-os": "Windows", "x-skill-sync-count": "107", "x-skill-sync-version": "3" }), "pull");
    const s = await readSyncStatus(ctx);
    const d = Object.values(s.devices ?? {})[0];
    expect(d).toMatchObject({ host: "HONEYSUITESscript", os: "Windows", lastAction: "pull", skillCount: 107, version: "3" });
  });

  it("ignores calls that aren't the sync script", async () => {
    const { ctx, writes } = fakeCtx();
    await noteDevice(ctx, req({}), "pull");
    expect(writes).toHaveLength(0);
  });

  it("notes connector clients, throttled per client, forced on initialize", async () => {
    const { ctx, writes } = fakeCtx();
    await noteConnector(ctx, "claude-ai-test");
    await noteConnector(ctx, "claude-ai-test"); // throttled
    expect(writes).toHaveLength(1);
    await noteConnector(ctx, "claude-ai-test", true); // initialize always notes
    await noteConnector(ctx, "claude-code-test"); // a different client is its own note
    expect(writes).toHaveLength(3);
    const s = await readSyncStatus(ctx);
    expect(Object.keys(s.connector?.clients ?? {}).sort()).toEqual(["claude-ai-test", "claude-code-test"]);
  });
});
