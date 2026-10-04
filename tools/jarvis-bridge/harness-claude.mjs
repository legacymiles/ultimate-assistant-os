// ---------------------------------------------------------------------------
// Claude Code as a harness, driven from the page.
//
// This uses the Agent SDK rather than shelling out to `claude -p`, for one
// reason that decides the whole feature: `canUseTool`. Spawning the CLI and
// parsing its JSON lines gives you a transcript you can show, but the
// permission prompt stays inside the CLI, so the only ways to run it
// unattended are to pre-approve everything or to pipe "y". With the SDK the
// permission request is a function call in this process, which means it can be
// parked, carried to a page on a phone, drawn as a diff, and answered there.
// The gate the owner taps IS the harness's permission prompt, not a copy of it.
//
// The input is an async generator rather than a string because a thread is a
// conversation: the generator stays open and yields the next turn whenever the
// owner sends one, so the model keeps its context instead of being restarted
// with a transcript pasted in front of it.
// ---------------------------------------------------------------------------

import { query } from "@anthropic-ai/claude-agent-sdk";
import { autoAllow, describeTool, denialMessage } from "./harness-gate.mjs";

export const CLAUDE_LABEL = "Claude Code";

/**
 * Start a Claude thread.
 *
 * `emit` appends an event to the session's ring; `gate` parks until the owner
 * answers and resolves true or false. Neither is allowed to throw: a gate that
 * rejects would surface to the model as a tool failure rather than a refusal.
 */
export function startClaude({ cwd, emit, gate, strict = false, laneWrites = false, model = "", signal }) {
  /** Turns waiting to be handed to the model. */
  const queue = [];
  let wake = null;
  let closed = false;
  let sessionId = "";
  let busy = false;

  const nudge = () => {
    const w = wake;
    wake = null;
    if (w) w();
  };

  async function* input() {
    while (!closed) {
      if (queue.length === 0) {
        await new Promise((r) => { wake = r; });
        continue;
      }
      const text = queue.shift();
      if (text == null) continue;
      emit({ kind: "user", text });
      busy = true;
      emit({ kind: "status", status: "thinking" });
      yield {
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
        session_id: sessionId,
      };
    }
  }

  const run = query({
    prompt: input(),
    options: {
      cwd,
      // The worktree only. A harness that can reach the main checkout can edit
      // the files the owner is looking at, which is the one thing the worktree
      // exists to prevent.
      permissionMode: "default",
      includePartialMessages: true,
      ...(model ? { model } : {}),
      ...(signal ? { abortController: signalToController(signal) } : {}),
      canUseTool: async (name, args) => {
        const d = describeTool(name, args, cwd);
        // What passes without asking is one policy, stated in harness-gate.mjs
        // so this adapter and the dsh one cannot drift apart on it.
        if (autoAllow(d, { strict, laneWrites })) {
          emit({ kind: "allowed", name, title: d.title });
          return { behavior: "allow", updatedInput: args };
        }
        const ok = await gate({
          name,
          title: d.title,
          why: d.why,
          risk: d.risk,
          patch: d.patch,
          command: d.command,
          path: d.path,
          input: args,
        }).catch(() => false);
        return ok
          ? { behavior: "allow", updatedInput: args }
          : { behavior: "deny", message: denialMessage(d.title) };
      },
    },
  });

  // --- the message loop --------------------------------------------------
  //
  // Partial text is emitted as it arrives so the thread reads live, and the
  // finished assistant message is NOT emitted again as text — only its tool
  // calls are. Emitting both is how a streamed answer ends up on the page
  // twice, once a character at a time and once all at once.
  const pump = (async () => {
    try {
      for await (const msg of run) {
        if (msg.type === "system" && msg.subtype === "init") {
          sessionId = msg.session_id || sessionId;
          emit({
            kind: "status",
            status: "ready",
            detail: `${msg.model ?? "claude"} · ${(msg.tools ?? []).length} tools`,
            model: msg.model ?? "",
            sessionId,
          });
          continue;
        }

        if (msg.type === "stream_event") {
          const ev = msg.event;
          if (ev?.type === "content_block_delta") {
            if (ev.delta?.type === "text_delta" && ev.delta.text) {
              emit({ kind: "text", text: ev.delta.text });
            } else if (ev.delta?.type === "thinking_delta" && ev.delta.thinking) {
              emit({ kind: "thinking", text: ev.delta.thinking });
            }
          }
          continue;
        }

        if (msg.type === "assistant") {
          for (const block of msg.message?.content ?? []) {
            if (block.type === "tool_use") {
              const d = describeTool(block.name, block.input ?? {}, cwd);
              emit({
                kind: "tool",
                callId: block.id,
                name: block.name,
                title: d.title,
                kindOf: d.kind,
                path: d.path,
                command: d.command,
              });
            }
          }
          continue;
        }

        if (msg.type === "user") {
          for (const block of msg.message?.content ?? []) {
            if (block.type === "tool_result") {
              emit({
                kind: "tool_end",
                callId: block.tool_use_id,
                ok: !block.is_error,
                output: textOf(block.content),
              });
            }
          }
          continue;
        }

        if (msg.type === "result") {
          busy = false;
          emit({
            kind: "turn_end",
            ms: msg.duration_ms ?? 0,
            usd: msg.total_cost_usd ?? 0,
            error: msg.subtype === "success" ? "" : String(msg.subtype ?? "failed"),
          });
          emit({ kind: "status", status: "idle" });
        }
      }
    } catch (e) {
      busy = false;
      if (!closed) {
        emit({ kind: "error", message: readableClaudeError(e) });
        emit({ kind: "status", status: "ended" });
      }
    }
  })();

  return {
    label: CLAUDE_LABEL,
    get sessionId() { return sessionId; },
    get busy() { return busy; },
    say(text) {
      queue.push(String(text ?? ""));
      nudge();
    },
    async interrupt() {
      await run.interrupt?.().catch(() => {});
      busy = false;
      emit({ kind: "status", status: "idle", detail: "Interrupted." });
    },
    async stop() {
      closed = true;
      nudge();
      await run.interrupt?.().catch(() => {});
      await run.return?.().catch(() => {});
      await pump.catch(() => {});
      emit({ kind: "status", status: "ended" });
    },
  };
}

function signalToController(signal) {
  const ac = new AbortController();
  if (signal.aborted) ac.abort();
  else signal.addEventListener("abort", () => ac.abort(), { once: true });
  return ac;
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (b?.type === "text" ? b.text : b?.type === "image" ? "[image]" : ""))
    .filter(Boolean)
    .join("\n");
}

/**
 * The failure the owner can act on, instead of the one the SDK threw.
 *
 * Every one of these is a thing that actually happens on a first run, and each
 * has a different fix — "process exited with code 1" has none.
 */
function readableClaudeError(e) {
  const raw = String(e?.message ?? e);
  if (/ENOENT|not found|spawn/i.test(raw) && /claude/i.test(raw)) {
    return "Claude Code is not installed on this PC. Install it, then restart the bridge.";
  }
  if (/credit|balance|quota|usage limit/i.test(raw)) {
    return `Claude stopped on an account limit: ${raw}`;
  }
  if (/api key|unauthor|authenticat|oauth/i.test(raw)) {
    return "Claude Code is not signed in on this PC. Run `claude` once in a terminal and sign in.";
  }
  return raw;
}
