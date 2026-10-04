// ---------------------------------------------------------------------------
// DeepSeek (dsh) as a harness, over Agent Client Protocol.
//
// dsh ships an `acp` profile that serves ACP on stdio, which is the right seam:
// one long-lived child, a session that resumes, streamed message and thought
// chunks, tool calls with their raw arguments, and permission requests as
// JSON-RPC requests this process can park.
//
// THE ONE THING THAT HAD TO BE FOUND
//
// Out of the box dsh asks for nothing. Probed against a scratch folder it read
// a file, rewrote it and ran a shell command without sending the client a
// single request, because its default permission preset is `workspace-write`
// and a write inside the session's own folder is simply allowed under it. A
// gate cannot be built on a hook that is never called, and the ACP app exposes
// no approval switch in `session/new`'s configOptions (only model and
// reasoning effort), so there is nothing to set from the protocol side.
//
// The switch is an environment variable. The acp profile composes
// dsh-sandbox-policy as `mode: process.env.DSH_PERMISSION_MODE ?? 'workspace-write'`,
// so starting the child with DSH_PERMISSION_MODE=read-only puts every write
// outside the sandbox. dsh then denies the tool once, tells the model
// escalation is available, the model retries the same call with
// `sandbox_permissions: workspace-write`, and THAT escalation is what arrives
// here as `session/request_permission`. Verified against a real turn: the edit
// was held, the gate answered, and only then did the file change.
//
// It is an env var rather than a `--patch` overlay or a settings edit on
// purpose — the overlay's `defaultPreset` was dropped by the config merge, and
// a settings edit would have changed the owner's own `dsh web` sessions too.
// Nothing outside this child process is touched.
//
// The other wrinkle: a permission request carries only a toolCallId — no name,
// no arguments. So every `tool_call` notification is remembered, and the gate
// is drawn from the remembered call. Without that the card would say
// "approve call_00_RwSj…" and mean nothing.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { describeTool } from "./harness-gate.mjs";

export const DEEPSEEK_LABEL = "DeepSeek (dsh)";

/** Where dsh is installed. It is NOT in this repo; it is the owner's own copy. */
export const DSH_CWD = process.env.DSH_DIR || "C:/Users/honey/deepseek-harness";

/**
 * dsh's tool names, mapped onto the vocabulary the gate already speaks.
 *
 * dsh reports every tool with `kind: "other"`, so the ACP `kind` field carries
 * no information and the title is all there is to go on.
 */
const TOOL_ALIAS = {
  read: "Read", glob: "Glob", grep: "Grep", ls: "LS", search: "Grep",
  edit: "Edit", str_replace_editor: "Edit", write: "Write", create: "Write",
  bash: "Bash", pwsh: "Bash", shell: "Bash", terminal: "Bash",
  web: "WebFetch", fetch: "WebFetch", todo: "TodoWrite",
};

const aliasFor = (title) => {
  const key = String(title ?? "").trim().toLowerCase().split(/[\s(]/)[0];
  return TOOL_ALIAS[key] ?? (key ? key[0].toUpperCase() + key.slice(1) : "Tool");
};

export function startAcp({ cwd, emit, gate, strict = false, command = "npx", args = ["dsh", "--profile", "acp"] }) {
  let sessionId = "";
  let nextId = 0;
  let closed = false;
  let busy = false;
  /** Turns typed before the session handshake finished. */
  const pending = [];
  /** id → resolve, for requests WE sent. */
  const waiting = new Map();
  /** toolCallId → what the call was, so a permission request can be described. */
  const calls = new Map();

  const child = spawn(command, args, {
    cwd: DSH_CWD,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
    windowsHide: true,
    env: {
      ...process.env,
      // The whole gate depends on this line. See the header.
      //
      // Always read-only, and `strict` does not change it: for dsh this is not
      // a strictness dial but the only mode in which a write is asked about at
      // all. Loosening it does not make the thread gate less, it makes it not
      // gate.
      DSH_PERMISSION_MODE: "read-only",
    },
  });

  const write = (obj) => {
    if (closed || !child.stdin.writable) return;
    child.stdin.write(`${JSON.stringify(obj)}\n`);
  };

  const request = (method, params) => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      write({ jsonrpc: "2.0", id, method, params });
    });
  };

  const respond = (id, result) => write({ jsonrpc: "2.0", id, result });
  const respondError = (id, message) => write({ jsonrpc: "2.0", id, error: { code: -32601, message } });

  // --- reading the agent --------------------------------------------------

  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // dsh prints the odd non-JSON line on stdout; it is not fatal.
      }
      void handle(msg);
    }
  });

  // dsh streams its reasoning to stderr by design, so stderr is only
  // interesting when the process is about to die on it.
  let stderrTail = "";
  child.stderr.on("data", (d) => {
    stderrTail = `${stderrTail}${d}`.slice(-4000);
  });

  child.on("exit", (code) => {
    closed = true;
    busy = false;
    for (const { reject } of waiting.values()) reject(new Error("dsh exited"));
    waiting.clear();
    if (code) emit({ kind: "error", message: readableDshError(code, stderrTail) });
    emit({ kind: "status", status: "ended" });
  });

  child.on("error", (e) => {
    closed = true;
    emit({ kind: "error", message: `dsh would not start: ${String(e?.message ?? e)}` });
    emit({ kind: "status", status: "ended" });
  });

  async function handle(msg) {
    // A reply to something we asked for.
    if (msg.id != null && !msg.method) {
      const w = waiting.get(msg.id);
      if (!w) return;
      waiting.delete(msg.id);
      if (msg.error) w.reject(new Error(msg.error.message ?? "dsh refused the request"));
      else w.resolve(msg.result);
      return;
    }

    // A request FROM the agent. The gate lives here.
    if (msg.id != null && msg.method) {
      if (msg.method === "session/request_permission") {
        const id = msg.params?.toolCall?.toolCallId ?? "";
        const remembered = calls.get(id) ?? {};
        const options = msg.params?.options ?? [];
        const allow = options.find((o) => o.kind === "allow_once" || /allow/i.test(o.optionId ?? ""));
        const reject = options.find((o) => o.kind === "reject_once" || /reject|deny/i.test(o.optionId ?? ""));
        const name = remembered.alias ?? "Tool";
        const d = describeTool(name, remembered.input ?? {}, cwd);
        const ok = await gate({
          name,
          title: d.title,
          why: d.why || "dsh is asking to step outside its read-only sandbox for this call.",
          risk: d.risk,
          patch: d.patch,
          command: d.command,
          path: d.path,
          input: remembered.input ?? {},
        }).catch(() => false);
        const chosen = ok ? allow : reject;
        if (!chosen) {
          // No usable option means we cannot answer honestly, and ACP's
          // cancelled outcome is the only safe thing left.
          respond(msg.id, { outcome: { outcome: "cancelled" } });
          return;
        }
        respond(msg.id, { outcome: { outcome: "selected", optionId: chosen.optionId } });
        return;
      }
      // We advertise neither filesystem nor terminal capabilities, so anything
      // else arriving as a request is dsh asking for something we promised not
      // to provide. Refusing is correct and recoverable.
      respondError(msg.id, `This client does not provide ${msg.method}.`);
      return;
    }

    if (msg.method !== "session/update") return;
    const u = msg.params?.update ?? {};

    switch (u.sessionUpdate) {
      case "agent_message_chunk":
        if (u.content?.text) emit({ kind: "text", text: u.content.text });
        return;
      case "agent_thought_chunk":
        if (u.content?.text) emit({ kind: "thinking", text: u.content.text });
        return;
      case "tool_call": {
        const alias = aliasFor(u.title);
        const input = u.rawInput ?? {};
        calls.set(u.toolCallId, { alias, title: u.title, input });
        const d = describeTool(alias, input, cwd);
        emit({
          kind: "tool",
          callId: u.toolCallId,
          name: alias,
          title: d.title,
          kindOf: d.kind,
          path: d.path,
          command: d.command,
        });
        return;
      }
      case "tool_call_update": {
        if (u.status === "in_progress" || !u.status) return;
        emit({
          kind: "tool_end",
          callId: u.toolCallId,
          ok: u.status === "completed",
          output: contentText(u.content),
        });
        return;
      }
      case "usage_update":
        emit({ kind: "usage", used: u.used ?? 0, size: u.size ?? 0 });
        return;
      case "plan":
        if (Array.isArray(u.entries) && u.entries.length) {
          emit({ kind: "plan", entries: u.entries.map((e) => ({ text: String(e?.content ?? ""), status: e?.status ?? "" })) });
        }
        return;
      default:
        return;
    }
  }

  // --- the handshake ------------------------------------------------------

  const ready = (async () => {
    await request("initialize", {
      protocolVersion: 1,
      // Both false on purpose. dsh ignores client filesystem capabilities and
      // does its own IO regardless, so advertising them would be a promise
      // that changes nothing and a second code path to keep correct.
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    const made = await request("session/new", { cwd, mcpServers: [] });
    sessionId = made?.sessionId ?? "";
    const model = pickModel(made?.configOptions);
    emit({
      kind: "status",
      status: "ready",
      detail: model ? `${model} · read-only sandbox, every write asks` : "read-only sandbox, every write asks",
      model,
      sessionId,
    });
    for (const text of pending.splice(0)) void turn(text);
  })().catch((e) => {
    emit({ kind: "error", message: readableDshError(0, `${e?.message ?? e}\n${stderrTail}`) });
    emit({ kind: "status", status: "ended" });
  });

  async function turn(text) {
    emit({ kind: "user", text });
    busy = true;
    emit({ kind: "status", status: "thinking" });
    const started = Date.now();
    try {
      const res = await request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text }],
      });
      emit({
        kind: "turn_end",
        ms: Date.now() - started,
        error: res?.stopReason && res.stopReason !== "end_turn" && res.stopReason !== "max_turn_requests"
          ? String(res.stopReason)
          : "",
      });
    } catch (e) {
      emit({ kind: "error", message: String(e?.message ?? e) });
    } finally {
      busy = false;
      emit({ kind: "status", status: "idle" });
    }
  }

  return {
    label: DEEPSEEK_LABEL,
    get sessionId() { return sessionId; },
    get busy() { return busy; },
    say(text) {
      const t = String(text ?? "");
      if (!sessionId) pending.push(t);
      else void turn(t);
    },
    async interrupt() {
      if (sessionId) await request("session/cancel", { sessionId }).catch(() => {});
      busy = false;
      emit({ kind: "status", status: "idle", detail: "Interrupted." });
    },
    async stop() {
      closed = true;
      await ready.catch(() => {});
      try {
        child.stdin.end();
      } catch { /* already gone. */ }
      child.kill();
      emit({ kind: "status", status: "ended" });
    },
  };
}

function contentText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c?.type === "content" ? (c.content?.text ?? "") : c?.type === "diff" ? "[diff]" : ""))
    .filter(Boolean)
    .join("\n");
}

/** The human name of whatever model the session came up on. */
function pickModel(options) {
  const opt = (options ?? []).find((o) => o.id === "model");
  if (!opt) return "";
  for (const group of opt.options ?? []) {
    for (const o of group.options ?? [group]) {
      if (o.value === opt.currentValue) return o.name ?? "";
    }
  }
  return "";
}

function readableDshError(code, tail) {
  const t = String(tail ?? "");
  if (/api[- ]?key|credential|unauthor|401/i.test(t)) {
    return "dsh has no DeepSeek API key on this PC. Run `dsh web` once and enter it.";
  }
  if (/ENOENT|not recognized|cannot find/i.test(t)) {
    return `dsh is not installed at ${DSH_CWD}. Install it there, or set DSH_DIR.`;
  }
  const last = t.trim().split("\n").filter(Boolean).slice(-2).join(" ");
  return last || `dsh exited with code ${code}.`;
}
