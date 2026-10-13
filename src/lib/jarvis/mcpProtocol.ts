// ---------------------------------------------------------------------------
// The MCP wire protocol, by hand.
//
// MCP is JSON-RPC 2.0 over HTTP POST. The official SDK would bring a
// dependency and an adapter layer for roughly a hundred lines of dispatch, and
// a Next.js route handler already returns JSON — so this is the dispatch, and
// nothing in here touches the database or a secret. That is deliberate: it
// keeps the protocol unit-testable without Supabase, which is where the bugs
// that silently break a connector actually live (a wrong shape for
// tools/list, a response body returned for a notification).
// ---------------------------------------------------------------------------

/** Versions this server speaks. The first is what we answer with when the
 *  client asks for something we do not recognise. */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export const SERVER_INFO = { name: "jarvis-memory", version: "1.0.0" };

export const INSTRUCTIONS =
  "The owner's long-term memory, shared across Jarvis, claude.ai and Claude Code. " +
  "Call search_memory at the start of a task and whenever the owner refers to something from earlier. " +
  "Call save_memory when they state a durable fact, preference, decision or project detail — one short fact per memory. " +
  "Never save passwords, API keys or card numbers.";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOLS: ToolDef[] = [
  {
    name: "search_memory",
    description:
      "Search the owner's long-term memory by meaning and by words. Call this at the start of a task and whenever they refer to something from earlier. An empty query returns the most recent memories.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for, in plain words." },
        limit: { type: "number", description: "How many memories to return (default 8, max 50)." },
      },
      required: ["query"],
    },
  },
  {
    name: "save_memory",
    description:
      "Save one durable fact, preference, decision or project detail. Write it as a single short self-contained sentence. Do not save passwords, keys or card numbers.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The fact, as one short sentence." },
        title: { type: "string", description: "Optional short title; the first line is used when omitted." },
        tags: { type: "array", items: { type: "string" }, description: "Optional labels, e.g. [\"project\",\"jarvis\"]." },
        origin: {
          type: "string",
          description: 'Where this is being saved from, e.g. "claude.ai", "claude-code-vps", "jarvis".',
        },
        source: {
          type: "string",
          enum: ["note", "chat", "profile"],
          description:
            'What kind of memory this is. Defaults to "chat". Sources that mirror a real file on disk cannot be written from here.',
        },
      },
      required: ["content"],
    },
  },
  {
    name: "list_recent",
    description: "List the most recently captured memories, newest first.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "How many to return (default 20, max 100)." } },
    },
  },
  {
    name: "delete_memory",
    description:
      "Delete one memory by id. Only do this when the owner asks to forget something. Memories that mirror a real file (vault notes, master-folder files) cannot be deleted here.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The memory's id, as returned by search or list." } },
      required: ["id"],
    },
  },
];

export interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export type ToolRunner = (name: string, args: Record<string, unknown>) => Promise<string>;

function ok(id: string | number | null, result: unknown): RpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function err(id: string | number | null, code: number, message: string): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function negotiateVersion(asked: unknown): string {
  return typeof asked === "string" && (PROTOCOL_VERSIONS as readonly string[]).includes(asked)
    ? asked
    : PROTOCOL_VERSIONS[0];
}

/**
 * Handle one JSON-RPC message.
 *
 * Returns null for a notification (a message with no id). Returning a body for
 * one is the single most common way a hand-written MCP server appears to work
 * in curl and then hangs a real client, so it is explicit here and covered by
 * a test.
 */
export async function handleRpc(msg: RpcRequest, run: ToolRunner): Promise<RpcResponse | null> {
  const id = msg.id ?? null;
  const isNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: negotiateVersion(msg.params?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return isNotification ? null : ok(id, {});

    case "tools/list":
      return ok(id, { tools: TOOLS });

    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (!TOOLS.some((t) => t.name === name)) {
        return err(id, -32602, `No tool named ${name}.`);
      }
      try {
        const text = await run(name, args);
        return ok(id, { content: [{ type: "text", text }] });
      } catch (e) {
        // A failed tool is reported INSIDE the result with isError, not as a
        // JSON-RPC error: the model is meant to see what went wrong and adapt,
        // and a protocol-level error is not shown to it.
        return ok(id, {
          content: [{ type: "text", text: e instanceof Error ? e.message : "The tool failed." }],
          isError: true,
        });
      }
    }

    default:
      if (isNotification) return null;
      return err(id, -32601, `Unknown method ${msg.method ?? "(none)"}.`);
  }
}
