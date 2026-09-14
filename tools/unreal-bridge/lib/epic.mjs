import { parseSse } from "./sse.mjs";

// A client for the MCP server Epic's ModelContextProtocol plugin runs inside
// the Unreal Editor (streamable HTTP, protocol 2025-11-25).
//
// What the server actually does, read from ModelContextProtocolServer.cpp and
// confirmed against a live editor:
//   * `initialize` needs no session; the session comes back in the
//     Mcp-Session-Id RESPONSE HEADER and every later request must send it.
//   * `tools/list`, `ping`: plain application/json.
//   * `tools/call`: text/event-stream. Progress notifications and the final
//     JSON-RPC result arrive as events, and the connection is kept alive
//     afterwards — so we must stop reading once our result is in, not wait for
//     the body to end.
//   * GET is not supported: there is no server-push channel.

const PROTOCOL = "2025-11-25";

export class EpicError extends Error {
  constructor(message, { code, data } = {}) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export class EpicClient {
  constructor(url, { clientName = "unreal-bridge", onProgress } = {}) {
    this.url = url;
    this.clientName = clientName;
    this.onProgress = onProgress;
    this.sessionId = null;
    this.nextId = 1;
  }

  headers() {
    const h = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) h["Mcp-Session-Id"] = this.sessionId;
    return h;
  }

  async initialize({ timeoutMs = 5000 } = {}) {
    this.sessionId = null;
    const res = await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL,
          capabilities: {},
          clientInfo: { name: this.clientName, version: "1.0.0" },
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json();
    if (body.error) throw new EpicError(body.error.message, body.error);
    this.sessionId = res.headers.get("mcp-session-id");
    if (!this.sessionId) throw new EpicError("Editor did not return an Mcp-Session-Id");
    await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    this.serverInfo = body.result;
    return body.result;
  }

  /**
   * One JSON-RPC request. Handles both reply shapes and re-initialises once if
   * the editor forgot our session (it does after a hot reload of the plugin).
   */
  async request(method, params = {}, { timeoutMs = 120_000 } = {}, retried = false) {
    if (!this.sessionId) await this.initialize();
    const id = this.nextId++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal,
      });

      const type = res.headers.get("content-type") ?? "";
      let message;
      if (type.includes("text/event-stream")) {
        message = await this.readStream(res, id, controller);
      } else {
        message = await res.json();
      }

      if (message?.error) {
        const sessionLost = /session/i.test(message.error.message ?? "");
        if (sessionLost && !retried) {
          this.sessionId = null;
          return this.request(method, params, { timeoutMs }, true);
        }
        throw new EpicError(message.error.message, message.error);
      }
      return message?.result;
    } catch (err) {
      if (err.name === "AbortError") {
        throw new EpicError(`Editor did not answer ${method} within ${Math.round(timeoutMs / 1000)}s`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async readStream(res, id, controller) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let seen = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      const events = parseSse(buffer);
      for (const ev of events.slice(seen)) {
        if (ev.method === "notifications/progress") this.onProgress?.(ev.params);
        if (ev.id === id && ("result" in ev || "error" in ev)) {
          controller.abort(); // the server keeps the stream open; we are done with it
          return ev;
        }
      }
      seen = events.length;
      if (done) throw new EpicError("Editor closed the stream before sending a result");
    }
  }

  async listTools() {
    const tools = [];
    let cursor;
    do {
      const result = await this.request("tools/list", cursor ? { cursor } : {});
      tools.push(...(result?.tools ?? []));
      cursor = result?.nextCursor;
    } while (cursor);
    return tools;
  }

  callTool(name, args = {}, opts) {
    return this.request("tools/call", { name, arguments: args }, opts);
  }

  /** Call one tool inside a toolset, through Epic's call_tool dispatcher. */
  callToolset(toolsetName, toolName, args = {}, opts) {
    return this.callTool("call_tool", { toolset_name: toolsetName, tool_name: toolName, arguments: args }, opts);
  }

  async close() {
    if (!this.sessionId) return;
    try {
      await fetch(this.url, { method: "DELETE", headers: this.headers(), signal: AbortSignal.timeout(3000) });
    } catch {
      /* editor may already be gone */
    }
    this.sessionId = null;
  }
}

/** Plain text of a tool result's content blocks. */
export function resultText(result) {
  return (result?.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

/** True when Epic's server at `url` answers initialize right now. */
export async function ping(url, timeoutMs = 3000) {
  try {
    const c = new EpicClient(url);
    await c.initialize({ timeoutMs });
    await c.close();
    return true;
  } catch {
    return false;
  }
}
