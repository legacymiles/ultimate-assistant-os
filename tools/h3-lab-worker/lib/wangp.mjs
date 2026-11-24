// ---------------------------------------------------------------------------
// WanGP (MiniMax H3) over its MCP server — the same protocol the studio bridge
// uses (tools/studio-bridge/server.mjs): raw node:http POSTs to /mcp with
// `Accept: application/json, text/event-stream`, the Mcp-Session-Id echoed
// back, `initialize` then `notifications/initialized`, then tools/call.
//
// node:http rather than fetch, because a render holds ONE request open for
// 5-15 minutes and fetch's (undici's) default timeouts would cut it off. A
// generation gets no socket timeout at all; every probe gets a short one, so
// "are you there?" never hangs on a wedged server.
//
// Only ever one wgp.py. If Pinokio's own WanGP web UI is up (it holds the GPU)
// or another wgp.py is already loading, this reports "busy" and never starts
// a second one.
// ---------------------------------------------------------------------------

import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, promises as fs } from "node:fs";
import { run } from "./proc.mjs";

const PROBE_MS = 8000;
const START_WAIT_MS = 8 * 60_000;

export class WanGP {
  constructor(cfg, log = () => {}) {
    this.cfg = cfg;
    this.log = log;
    this.sessionId = null;
    this.rpcId = 0;
    this.server = null; // { name, version }
    this.generateShape = null; // "settings" | "action"
    this.starting = null;
    this.rendering = null; // { id, since }
    this.modelCache = { at: 0, list: [] };
  }

  rpc(method, params, { notify = false, timeoutMs = PROBE_MS } = {}) {
    const body = JSON.stringify(notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++this.rpcId, method, params });
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Content-Length": Buffer.byteLength(body),
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    return new Promise((ok, fail) => {
      const req = http.request(
        { host: this.cfg.mcpHost, port: this.cfg.mcpPort, path: this.cfg.mcpPath, method: "POST", headers },
        (res) => {
          if (res.headers["mcp-session-id"]) this.sessionId = res.headers["mcp-session-id"];
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            if (notify) return ok(null);
            if (res.statusCode && res.statusCode >= 400 && !data.includes("jsonrpc")) {
              return fail(Object.assign(new Error(`WanGP MCP answered ${res.statusCode}: ${data.slice(0, 200)}`), { status: res.statusCode }));
            }
            // Streamable HTTP may answer as SSE: take the last `data:` line.
            const line = data.split(/\r?\n/).filter((l) => l.startsWith("data:")).pop();
            try {
              ok(JSON.parse(line ? line.slice(5) : data));
            } catch {
              ok({ raw: data.slice(0, 800) });
            }
          });
          res.on("error", fail);
        },
      );
      // 0 = no timeout: a render holds the request open for many minutes.
      req.setTimeout(timeoutMs);
      if (timeoutMs) {
        req.on("timeout", () => req.destroy(new Error(`WanGP didn't answer ${method} within ${Math.round(timeoutMs / 1000)}s.`)));
      }
      req.on("error", fail);
      req.end(body);
    });
  }

  async #initialize() {
    this.sessionId = null;
    const r = await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "h3-lab-worker", version: "1" },
    });
    if (!r?.result) throw new Error(`WanGP MCP did not initialize: ${JSON.stringify(r).slice(0, 200)}`);
    this.server = r.result.serverInfo ?? null;
    await this.rpc("notifications/initialized", {}, { notify: true });
  }

  /** tools/list on the current session, re-initializing once if the session is gone. Throws when WanGP is not answering. */
  async tools() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!this.sessionId || attempt > 0) await this.#initialize();
      try {
        const r = await this.rpc("tools/list", {});
        const tools = r?.result?.tools;
        if (Array.isArray(tools)) {
          const gen = tools.find((t) => t.name === "wangp_generate");
          const props = gen?.inputSchema?.properties ?? {};
          this.generateShape = props.settings ? "settings" : "action";
          return tools;
        }
      } catch (err) {
        if (attempt > 0) throw err;
      }
      this.sessionId = null;
    }
    throw new Error("WanGP MCP did not list its tools.");
  }

  async up() {
    try {
      await this.tools();
      return true;
    } catch {
      return false;
    }
  }

  async #toolCall(name, args, timeoutMs = PROBE_MS) {
    const r = await this.rpc("tools/call", { name, arguments: args }, { timeoutMs });
    if (r?.error) throw new Error(`WanGP ${name}: ${r.error.message ?? JSON.stringify(r.error).slice(0, 300)}`);
    const res = r?.result;
    const text = (res?.content ?? []).map((c) => c.text ?? "").join("\n");
    if (res?.isError) throw new Error(`WanGP ${name}: ${text.slice(0, 500) || "error"}`);
    if (res?.structuredContent && typeof res.structuredContent === "object") return res.structuredContent;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`WanGP ${name} returned something unreadable: ${(text || JSON.stringify(r)).slice(0, 300)}`);
    }
  }

  /** H3 model types WanGP knows about (wangp_models search "h3"), cached 10 min. [] when it cannot say. */
  async models() {
    if (Date.now() - this.modelCache.at < 10 * 60_000 && this.modelCache.list.length) return this.modelCache.list;
    const found = new Set();
    try {
      let args = { query: "minimax h3" };
      for (let page = 0; page < 4; page += 1) {
        const r = await this.#toolCall("wangp_models", { action: "search", arguments: args });
        for (const m of r?.models ?? []) if (/minimax_h3/i.test(m?.model_type ?? "")) found.add(m.model_type);
        if (!r?.has_more || !r?.next_cursor) break;
        args = { ...args, cursor: r.next_cursor };
      }
    } catch {
      /* models are a nicety */
    }
    const list = [...found].sort();
    this.modelCache = { at: Date.now(), list };
    return list;
  }

  /** Every running wgp.py on this PC: [{ pid, mcp, cmd }]. null when it cannot look (not Windows, or PowerShell failed). */
  async wgpProcesses() {
    if (process.platform !== "win32") return null;
    const ps =
      "Get-CimInstance Win32_Process -Filter \"Name like 'python%'\" | Where-Object { $_.CommandLine -match 'wgp\\.py' } | " +
      "ForEach-Object { [string]$_.ProcessId + '|' + $_.CommandLine }";
    const r = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeoutMs: 20_000 });
    if (!r.ok) return null;
    return r.stdout
      .toString()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const bar = l.indexOf("|");
        const cmd = l.slice(bar + 1);
        return { pid: Number(l.slice(0, bar)), mcp: /--mcp\b/.test(cmd), cmd };
      });
  }

  /** Is something listening on Pinokio's WanGP web UI port? */
  uiPortOpen() {
    return new Promise((resolve) => {
      const s = net.connect({ host: "127.0.0.1", port: this.cfg.uiPort });
      const done = (v) => {
        s.destroy();
        resolve(v);
      };
      s.setTimeout(1500, () => done(false));
      s.once("connect", () => done(true));
      s.once("error", () => done(false));
    });
  }

  /**
   * WorkerStatus fields: { wangp, wangpDetail, models }, plus canRender.
   * Never touches a WanGP that is in the middle of our own render.
   */
  async status() {
    if (this.rendering) {
      const mins = Math.floor((Date.now() - this.rendering.since) / 60_000);
      return {
        wangp: "busy",
        wangpDetail: `Rendering ${this.rendering.id} on MiniMax H3 (${mins} min so far).`,
        models: this.modelCache.list,
        canRender: false,
      };
    }
    if (this.starting) {
      return { wangp: "busy", wangpDetail: "Starting WanGP's MCP server (the first start loads the model; a few minutes).", models: [], canRender: false };
    }
    if (await this.up()) {
      const v = this.server?.version ? ` ${this.server.version}` : "";
      const models = await this.models();
      return {
        wangp: "ready",
        wangpDetail: `WanGP${v} is answering on port ${this.cfg.mcpPort}.${models.length ? "" : " It did not list any MiniMax H3 models."}`,
        models,
        canRender: true,
      };
    }
    return this.#whyDown();
  }

  async #whyDown() {
    const procs = await this.wgpProcesses();
    // The process list is the real evidence; the UI port is only consulted when
    // the list cannot be read (some other program may own that port).
    const ui = procs === null ? await this.uiPortOpen() : false;
    const gradio = (procs ?? []).filter((p) => !p.mcp);
    if (gradio.length || ui) {
      return {
        wangp: "busy",
        wangpDetail:
          `WanGP is open in Pinokio's web UI${ui ? ` (port ${this.cfg.uiPort})` : ""} and holds the GPU. ` +
          "Stop it in Pinokio and the worker will start WanGP's render server itself. It never starts a second copy.",
        models: [],
        canRender: false,
      };
    }
    if ((procs ?? []).some((p) => p.mcp)) {
      return {
        wangp: "busy",
        wangpDetail: "WanGP's render server is running but not answering yet. It is probably still loading; the worker waits rather than start another.",
        models: [],
        canRender: false,
      };
    }
    const ok = existsSync(path.join(this.cfg.wangpApp, "wgp.py"));
    return {
      wangp: "down",
      wangpDetail: ok
        ? "WanGP is not running. The worker starts it on the next render (the first start takes a few minutes)."
        : `WanGP was not found at ${this.cfg.wangpApp}. Set WANGP_DIR in tools/h3-lab-worker/.env.`,
      models: [],
      canRender: ok,
    };
  }

  /** WanGP's MCP server, started if needed. Throws with a plain-English reason when it cannot be. */
  ensure(onWait = () => {}) {
    if (this.starting) return this.starting;
    this.starting = (async () => {
      if (await this.up()) return;
      const procs = await this.wgpProcesses();
      if ((procs ?? []).some((p) => !p.mcp) || (procs === null && (await this.uiPortOpen()))) {
        throw new Error("WanGP is open in Pinokio's web UI and holds the GPU. Stop it in Pinokio, then retry this render.");
      }
      if (!procs?.length) {
        const app = this.cfg.wangpApp;
        const py = path.join(app, "venv", "Scripts", "python.exe");
        if (!existsSync(py) || !existsSync(path.join(app, "wgp.py"))) {
          throw new Error(`WanGP not found at ${app} (set WANGP_DIR in tools/h3-lab-worker/.env).`);
        }
        mkdirSync(this.cfg.outDir, { recursive: true });
        const logFile = path.join(this.cfg.outDir, "wangp.log");
        const fd = openSync(logFile, "a");
        this.log(`Starting WanGP's MCP server on port ${this.cfg.mcpPort} (log: ${logFile})…`);
        spawn(
          py,
          ["wgp.py", "--mcp", "--mcp-transport", "streamable-http", "--mcp-port", String(this.cfg.mcpPort), "--mcp-allow-read-file-system"],
          { cwd: app, detached: true, stdio: ["ignore", fd, fd], windowsHide: true },
        ).unref();
      } else {
        this.log("A WanGP render server is already loading; waiting for it instead of starting another.");
      }
      const t0 = Date.now();
      while (Date.now() - t0 < START_WAIT_MS) {
        await new Promise((r) => setTimeout(r, 5000));
        onWait(Math.round((Date.now() - t0) / 1000));
        if (await this.up()) return;
      }
      throw new Error(`WanGP didn't come up within 8 minutes — see ${path.join(this.cfg.outDir, "wangp.log")}.`);
    })().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /**
   * Render one generation. `source` is the hub's settings object (already
   * complete — nothing is invented here). Returns the absolute output path.
   */
  async generate(id, source) {
    await this.tools(); // fresh session + which argument shape this WanGP takes
    const args =
      this.generateShape === "settings"
        ? { settings: source, wait: true }
        : { action: "generate", arguments: { source } }; // older WanGP MCP (what the studio bridge sends)
    this.rendering = { id, since: Date.now() };
    let out;
    try {
      out = await this.#toolCall("wangp_generate", args, 0);
    } finally {
      this.rendering = null;
    }
    const result = out?.result && typeof out.result === "object" ? out.result : out;
    if (out?.status === "timeout") throw new Error("WanGP stopped waiting for the render (timeout).");
    if (!result?.success) {
      const errs = (result?.errors ?? []).map((e) => e?.message ?? e).filter(Boolean);
      if (result?.cancelled) throw new Error("WanGP cancelled the render.");
      throw new Error(`WanGP failed: ${errs.join("; ").slice(0, 500) || JSON.stringify(result ?? out).slice(0, 400)}`);
    }
    const files = result.generated_files ?? [];
    const first = files.find((f) => /\.(mp4|mkv|webm|mov)$/i.test(f)) ?? files[0];
    if (!first) throw new Error("WanGP reported success but returned no file.");
    return this.#resolveOutput(first);
  }

  async #resolveOutput(p) {
    const candidates = path.isAbsolute(p)
      ? [p]
      : [path.join(this.cfg.wangpApp, p), path.join(this.cfg.wangpApp, "outputs", path.basename(p))];
    for (const c of candidates) {
      try {
        await fs.access(c);
        return path.resolve(c);
      } catch {
        /* next */
      }
    }
    throw new Error(`WanGP said it wrote ${p}, but the file is not there.`);
  }
}

// ----- settings, as forwarded ------------------------------------------------

const DATA_URL = /^data:([\w/+.-]+);base64,(.*)$/s;
const EXT = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/bmp": "bmp" };
/** Fields that hold media WanGP must read from disk. Data URLs in them become temp files. */
export const MEDIA_FIELDS = ["image_refs", "image_start", "image_end"];

/**
 * The hub's settings, verbatim, except:
 *   - prompt line breaks flattened to spaces (WanGP reads each line as a separate prompt);
 *   - data: URLs in image_refs / image_start (/ image_end) written to
 *     out/refs/<generationId>-<i>.<ext> and replaced by that absolute path.
 * Returns { source, tempFiles } — delete tempFiles once the result is posted.
 */
export async function prepareSettings(settings, generationId, refsDir) {
  const source = structuredClone(settings ?? {});
  if (typeof source.prompt === "string") source.prompt = source.prompt.replace(/\s*[\r\n]+\s*/g, " ").trim();
  const tempFiles = [];
  let n = 0;
  const safeId = String(generationId).replace(/[^\w.-]/g, "_");
  const materialize = async (value) => {
    if (typeof value !== "string") return value;
    const m = DATA_URL.exec(value);
    if (!m) return value;
    await fs.mkdir(refsDir, { recursive: true });
    const file = path.resolve(refsDir, `${safeId}-${n++}.${EXT[m[1].toLowerCase()] ?? "png"}`);
    await fs.writeFile(file, Buffer.from(m[2], "base64"));
    tempFiles.push(file);
    return file;
  };
  for (const key of MEDIA_FIELDS) {
    if (!(key in source)) continue;
    const v = source[key];
    source[key] = Array.isArray(v) ? await Promise.all(v.map(materialize)) : await materialize(v);
  }
  return { source, tempFiles };
}
