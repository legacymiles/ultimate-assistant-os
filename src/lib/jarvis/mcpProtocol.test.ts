import { describe, expect, it, vi } from "vitest";
import { handleRpc, negotiateVersion, PROTOCOL_VERSIONS, TOOLS } from "./mcpProtocol";

const noop = async () => "";

describe("mcp protocol", () => {
  it("answers initialize with a version the client asked for", async () => {
    const res = await handleRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
      noop,
    );
    expect(res?.result).toMatchObject({ protocolVersion: "2024-11-05" });
    expect((res?.result as { serverInfo: { name: string } }).serverInfo.name).toBe("jarvis-memory");
  });

  it("falls back to its newest version when the client asks for an unknown one", () => {
    expect(negotiateVersion("1999-01-01")).toBe(PROTOCOL_VERSIONS[0]);
    expect(negotiateVersion(undefined)).toBe(PROTOCOL_VERSIONS[0]);
  });

  // The bug this guards: returning a body for a notification is what makes a
  // hand-written server work in curl and hang a real client.
  it("returns nothing for notifications", async () => {
    expect(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, noop)).toBeNull();
    expect(await handleRpc({ jsonrpc: "2.0", method: "ping" }, noop)).toBeNull();
  });

  it("lists every tool with a schema", async () => {
    const res = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, noop);
    const tools = (res?.result as { tools: typeof TOOLS }).tools;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_finding",
      "client_review_preview",
      "delete_memory",
      "get_findings",
      "get_router",
      "get_skill",
      "list_recent",
      "list_skills",
      "log_activity",
      "queue_add",
      "queue_complete",
      "queue_list",
      "queue_note",
      "queue_start",
      "queue_video_link",
      "save_memory",
      "save_skill",
      "search_memory",
    ]);
    for (const t of tools) expect(t.inputSchema).toHaveProperty("type", "object");
  });

  it("runs a tool and wraps the text as content", async () => {
    const run = vi.fn(async () => "two memories");
    const res = await handleRpc(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_memory", arguments: { query: "vps" } } },
      run,
    );
    expect(run).toHaveBeenCalledWith("search_memory", { query: "vps" });
    expect(res?.result).toEqual({ content: [{ type: "text", text: "two memories" }] });
  });

  it("reports a failed tool inside the result, not as a protocol error", async () => {
    const res = await handleRpc(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "save_memory", arguments: {} },
      },
      async () => {
        throw new Error("Supabase is unreachable");
      },
    );
    expect(res?.error).toBeUndefined();
    expect(res?.result).toMatchObject({ isError: true });
  });

  it("refuses an unknown tool and an unknown method", async () => {
    const tool = await handleRpc(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "drop_everything" } },
      noop,
    );
    expect(tool?.error?.code).toBe(-32602);
    const method = await handleRpc({ jsonrpc: "2.0", id: 6, method: "resources/list" }, noop);
    expect(method?.error?.code).toBe(-32601);
  });
});
