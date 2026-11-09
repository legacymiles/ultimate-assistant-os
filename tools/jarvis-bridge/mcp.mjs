// ---------------------------------------------------------------------------
// MCP servers, managed and called from the bridge.
//
// The hub already SPEAKS MCP — /api/jarvis/memory/mcp is a server Claude Code
// and claude.ai connectors read. What it could not do is BE a client: add
// someone else's MCP server, look at the tools it offers, and call one. That is
// the difference between "Jarvis has memory" and "Jarvis can use any tool
// anybody has written an MCP server for", which is the whole promise of the
// protocol.
//
// So this is a small, real client. Each configured server is a child process
// speaking JSON-RPC over stdio; `initialize` then `tools/list` once, and
// `tools/call` per use. The process is kept alive between calls because a
// server that re-initialises on every click is a server nobody uses, and it is
// killed when the bridge goes down.
//
// The config is `out/mcp.json` — beside the bridge, not in the repository, so a
// server that holds a token holds it on this machine and nowhere else. Adding
// one is gated as grave by the page: an MCP server is an arbitrary executable,
// which is exactly as powerful as that sounds.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { refuseReason } from "./guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const CONFIG = join(OUT, "mcp.json");

const INIT_TIMEOUT = 20_000;
const CALL_TIMEOUT = 90_000;
const MAX_TEXT = 24_000;

/** Live clients, by server name. */
const clients = new Map();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function emptyConfig() {
  return { servers: [] };
}

export function readConfig() {
  try {
    if (!existsSync(CONFIG)) return emptyConfig();
    const raw = JSON.parse(readFileSync(CONFIG, "utf8"));
    const servers = Array.isArray(raw?.servers) ? raw.servers : [];
    return {
      servers: servers
        .map((s) => ({
          name: String(s.name ?? "").trim(),
          command: String(s.command ?? "").trim(),
          args: Array.isArray(s.args) ? s.args.map(String) : [],
          env: s.env && typeof s.env === "object" ? Object.fromEntries(Object.entries(s.env).map(([k, v]) => [k, String(v)])) : {},
          cwd: String(s.cwd ?? ""),
          enabled: s.enabled !== false,
          note: String(s.note ?? ""),
        }))
        .filter((s) => s.name && s.command),
    };
  } catch {
    return emptyConfig();
  }
}

function writeConfig(config) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function find(name) {
  return readConfig().servers.find((s) => s.name === name) ?? null;
}

// ---------------------------------------------------------------------------
// One stdio client
// ---------------------------------------------------------------------------

function quote(arg) {
  const s = String(arg);
  return /[\s"&|<>^()]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

class StdioClient {
  constructor(spec) {
    this.spec = spec;
    this.child = null;
    this.pending = new Map();
    this.nextId = 0;
    this.buffer = "";
    this.tools = [];
    this.ready = false;
    this.error = "";
    this.stderr = "";
  }

  async start() {
    if (this.ready && this.child && this.child.exitCode === null) return;
    if (this.child) this.kill();

    const line = [this.spec.command, ...this.spec.args].map(quote).join(" ");
    this.child = spawn(line, {
      cwd: this.spec.cwd || undefined,
      env: { ...process.env, ...this.spec.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32",
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.onData(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4_000);
    });
    this.child.on("exit", (code) => {
      this.fail(new Error(`The MCP server "${this.spec.name}" exited (code ${code ?? "?"}).${this.stderr ? ` ${this.stderr.trim().split(/\r?\n/).slice(-3).join(" ")}` : ""}`));
    });
    this.child.on("error", (e) => this.fail(e));

    const init = await this.request(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "jarvis-bridge", version: "1.0.0" },
      },
      INIT_TIMEOUT,
    );
    this.notify("notifications/initialized", {});
    this.tools = await this.loadTools();
    this.ready = true;
    this.error = "";
    return init;
  }

  onData(chunk) {
    this.buffer += chunk;
    let at;
    while ((at = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      if (!line || line.startsWith("Content-Length:") || line.startsWith("Content-Type:")) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // A server that prints a banner is not a server that is broken.
      }
      if (message && typeof message.id === "number" && this.pending.has(message.id)) {
        const parked = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(parked.timer);
        if (message.error) parked.reject(new Error(String(message.error.message ?? "The MCP server refused that.")));
        else parked.resolve(message.result ?? {});
      }
      // A notification (no id) needs no answer; none of the ones defined today
      // change what the page shows.
    }
  }

  send(message) {
    if (!this.child?.stdin?.writable) throw new Error(`The MCP server "${this.spec.name}" is not running.`);
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params, timeout = CALL_TIMEOUT) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The MCP server "${this.spec.name}" did not answer ${method} in ${Math.round(timeout / 1000)}s.`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  async loadTools() {
    const out = [];
    let cursor = "";
    for (let page = 0; page < 10; page++) {
      const result = await this.request("tools/list", cursor ? { cursor } : {}, INIT_TIMEOUT);
      for (const tool of result.tools ?? []) {
        out.push({
          name: String(tool.name ?? ""),
          description: String(tool.description ?? "").slice(0, 800),
          inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
        });
      }
      cursor = String(result.nextCursor ?? "");
      if (!cursor) break;
    }
    return out;
  }

  async call(tool, args) {
    await this.start();
    const result = await this.request("tools/call", { name: tool, arguments: args ?? {} }, CALL_TIMEOUT);
    const parts = Array.isArray(result.content) ? result.content : [];
    const text = parts
      .map((p) => {
        if (p?.type === "text") return String(p.text ?? "");
        if (p?.type === "image") return `[image ${String(p.mimeType ?? "")}]`;
        if (p?.type === "resource") return String(p.resource?.text ?? p.resource?.uri ?? "[resource]");
        return "";
      })
      .filter(Boolean)
      .join("\n");
    return {
      text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text,
      isError: Boolean(result.isError),
      structured: result.structuredContent ?? null,
    };
  }

  fail(error) {
    this.error = String(error?.message ?? error);
    this.ready = false;
    for (const [id, parked] of this.pending) {
      clearTimeout(parked.timer);
      parked.reject(error);
      this.pending.delete(id);
    }
  }

  kill() {
    try {
      this.child?.stdin?.end();
      this.child?.kill();
    } catch {
      /* it was already gone. */
    }
    this.child = null;
    this.ready = false;
    this.pending.clear();
    this.buffer = "";
  }
}

function clientFor(spec) {
  let client = clients.get(spec.name);
  if (!client) {
    client = new StdioClient(spec);
    clients.set(spec.name, client);
  }
  return client;
}

function disconnect(name) {
  const client = clients.get(name);
  if (client) client.kill();
  clients.delete(name);
}

// ---------------------------------------------------------------------------
// What the page asks for
// ---------------------------------------------------------------------------

export async function listServers() {
  return {
    servers: readConfig().servers.map((s) => {
      const live = clients.get(s.name);
      return {
        name: s.name,
        command: s.command,
        args: s.args,
        enabled: s.enabled,
        connected: Boolean(live?.ready),
        tools: live?.tools.length ?? 0,
        error: live?.error ?? "",
      };
    }),
    configPath: CONFIG,
  };
}

export async function listTools(body = {}) {
  const name = String(body.server ?? body.name ?? "").trim();
  const specs = name ? [find(name)].filter(Boolean) : readConfig().servers;
  if (name && !specs.length) throw Object.assign(new Error(`There is no MCP server called "${name}".`), { status: 404 });

  const out = [];
  for (const spec of specs) {
    if (!spec.enabled) {
      out.push({ server: spec.name, enabled: false, tools: [], error: "Switched off." });
      continue;
    }
    const client = clientFor(spec);
    try {
      await client.start();
      out.push({ server: spec.name, enabled: true, tools: client.tools, error: "" });
    } catch (e) {
      out.push({ server: spec.name, enabled: true, tools: [], error: String(e?.message ?? e) });
    }
  }
  return { servers: out };
}

export async function callTool(body = {}) {
  const server = String(body.server ?? "").trim();
  const tool = String(body.tool ?? body.name ?? "").trim();
  if (!server || !tool) throw Object.assign(new Error("An MCP call needs the server and the tool."), { status: 400 });
  const spec = find(server);
  if (!spec) throw Object.assign(new Error(`There is no MCP server called "${server}".`), { status: 404 });
  if (!spec.enabled) throw Object.assign(new Error(`"${server}" is switched off.`), { status: 409 });

  const client = clientFor(spec);
  await client.start();
  const args = body.args && typeof body.args === "object" ? body.args : {};
  const result = await client.call(tool, args);
  return { server, tool, ...result };
}

export async function saveServer(body = {}) {
  const input = body.server && typeof body.server === "object" ? body.server : body;
  const name = String(input.name ?? "").trim();
  const command = String(input.command ?? "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,48}$/i.test(name)) {
    throw Object.assign(new Error("Give the server a short name: letters, numbers, dots, dashes."), { status: 400 });
  }
  if (!command) throw Object.assign(new Error("Which command starts it? e.g. npx, uvx, node."), { status: 400 });
  const why = refuseReason(`${command} ${(input.args ?? []).join(" ")}`);
  if (why) throw Object.assign(new Error(`Refused: that command ${why}.`), { status: 403 });

  const spec = {
    name,
    command,
    args: Array.isArray(input.args) ? input.args.map(String) : [],
    env: input.env && typeof input.env === "object" ? input.env : {},
    cwd: String(input.cwd ?? ""),
    enabled: input.enabled !== false,
    note: String(input.note ?? ""),
  };
  const config = readConfig();
  const at = config.servers.findIndex((s) => s.name === name);
  if (at >= 0) config.servers[at] = spec;
  else config.servers.push(spec);
  writeConfig(config);
  disconnect(name);
  return { saved: spec, note: "Saved. Call mcp with action=tools to read what it offers." };
}

export async function removeServer(body = {}) {
  const name = String(body.name ?? body.server ?? "").trim();
  if (!name) throw Object.assign(new Error("Which server?"), { status: 400 });
  const config = readConfig();
  const before = config.servers.length;
  config.servers = config.servers.filter((s) => s.name !== name);
  writeConfig(config);
  disconnect(name);
  return { removed: before !== config.servers.length, name };
}

export async function setEnabled(body = {}) {
  const name = String(body.name ?? body.server ?? "").trim();
  if (!name) throw Object.assign(new Error("Which server?"), { status: 400 });
  const config = readConfig();
  const spec = config.servers.find((s) => s.name === name);
  if (!spec) throw Object.assign(new Error(`There is no MCP server called "${name}".`), { status: 404 });
  spec.enabled = body.enabled !== false;
  writeConfig(config);
  if (!spec.enabled) disconnect(name);
  return { name, enabled: spec.enabled };
}

export async function restartServer(body = {}) {
  const name = String(body.name ?? body.server ?? "").trim();
  const spec = find(name);
  if (!spec) throw Object.assign(new Error(`There is no MCP server called "${name}".`), { status: 404 });
  disconnect(name);
  const client = clientFor(spec);
  await client.start();
  return { name, restarted: true, tools: client.tools.length };
}

/** The bridge is going down; no MCP child should outlive it. */
export function shutdown() {
  for (const name of [...clients.keys()]) disconnect(name);
}
