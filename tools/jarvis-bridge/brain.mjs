// ---------------------------------------------------------------------------
// Jarvis's brain on your Claude subscription.
//
// The website can think with a cloud model (OpenRouter, paid per request), or
// it can ask THIS process to think with Claude — through Anthropic's own Agent
// SDK, running the unmodified Claude Code on this PC, signed in with the
// owner's own Claude account. That is ordinary personal use of their own plan:
// nothing here stores, forwards or shares the login, and it only ever serves
// the person sitting at this PC.
//
// One call = one step of Jarvis's loop. The page sends the system prompt, the
// tool list and the conversation; Claude answers with ONE move — a tool to
// call, or the final answer — as JSON. Claude Code's own tools are switched
// off for this: Jarvis's tools (the browser, files, memory…) are run by the
// page and this bridge exactly as they are for a cloud model, so the gates,
// the ledger and the plain-English results are the same whichever brain is on.
//
// Every failure comes back as a sentence the owner can act on, never a stack.
// ---------------------------------------------------------------------------

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRATCH = path.join(tmpdir(), "jarvis-brain");

/** Plain English for whatever went wrong, with the fix. */
export function explainBrainError(raw) {
  const t = String(raw?.message ?? raw ?? "");
  if (/cannot find (package|module) '@anthropic-ai\/claude-agent-sdk'|ERR_MODULE_NOT_FOUND/i.test(t)) {
    return "The Claude part of Jarvis's local agent isn't installed yet. On this PC, run tools\\jarvis-bridge\\install.cmd again, then try once more.";
  }
  if (/ENOENT|spawn .*claude|claude code (executable|binary)|not found.*claude|executable not found/i.test(t)) {
    return "Claude Code isn't installed on this PC. Install it from claude.com/code, sign in with your Claude account, then try again.";
  }
  if (/log ?in|logged out|not authenticated|authentication|invalid api key|oauth|401|credential/i.test(t)) {
    return "Claude isn't signed in on this PC. Open Claude Code (type `claude` in a terminal), sign in with your Claude account using /login, then try again.";
  }
  if (/usage limit|limit reached|rate.?limit|429|quota|too many requests/i.test(t)) {
    return "You've reached your Claude plan's usage limit for now. It resets on its own — or switch Jarvis's brain to a cloud model (like DeepSeek) until then.";
  }
  if (/overloaded|529|503|capacity/i.test(t)) {
    return "Claude is very busy right now (Anthropic's servers are overloaded). Try again in a minute.";
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|fetch failed|socket/i.test(t)) {
    return "This PC couldn't reach Claude over the internet. Check the PC's connection and try again.";
  }
  if (/abort/i.test(t)) return "Stopped.";
  const first = t.split("\n").find((l) => l.trim()) ?? "";
  return first ? `Claude couldn't answer: ${first.slice(0, 200)}` : "Claude couldn't answer, and didn't say why. Try again.";
}

const PROTOCOL = `HOW TO ANSWER (this replaces normal tool calling)
You make exactly ONE move per reply, as a single JSON object and nothing else — no prose around it, no code fences.
- To use a tool: {"tool": "<tool name>", "arguments": { ... }}
- To finish and talk to the person: {"answer": "<your reply, plain text or markdown>"}
Only use tools from the list below, with arguments that match their schema. After a tool runs you will see its result and choose the next move.`;

function toolCatalog(tools) {
  if (!Array.isArray(tools) || !tools.length) return "TOOLS: none this turn — answer directly.";
  const lines = tools.map((t) => {
    const f = t.function ?? t;
    return `- ${f.name}: ${f.description ?? ""}\n  arguments schema: ${JSON.stringify(f.parameters ?? {})}`;
  });
  return `TOOLS\n${lines.join("\n")}`;
}

/** The conversation as one readable transcript, pictures pulled out as image blocks. */
function transcript(messages) {
  const images = [];
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m.role === "user") {
      if (Array.isArray(m.content)) {
        const words = [];
        for (const p of m.content) {
          if (p?.type === "text") words.push(p.text);
          else if (p?.type === "image_url") {
            const url = String(p.image_url?.url ?? "");
            const hit = url.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
            if (hit && images.length < 12) {
              images.push({ type: "image", source: { type: "base64", media_type: hit[1], data: hit[2] } });
              words.push(`[picture ${images.length} attached below]`);
            }
          } else if (p?.type === "input_audio") {
            words.push("[a sound recording was attached — Claude can't listen to audio here, so rely on the description above]");
          }
        }
        out.push(`PERSON: ${words.join("\n")}`);
      } else out.push(`PERSON: ${String(m.content ?? "")}`);
    } else if (m.role === "assistant") {
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
      if (typeof m.content === "string" && m.content.trim()) out.push(`YOU: ${m.content}`);
      for (const c of calls) out.push(`YOU called ${c.function?.name} with ${c.function?.arguments ?? "{}"}`);
    } else if (m.role === "tool") {
      out.push(`RESULT of ${m.name || "that tool"}:\n${String(m.content ?? "").slice(0, 20_000)}`);
    }
  }
  out.push("Your move (one JSON object):");
  return { text: out.join("\n\n"), images };
}

/** Pull the one JSON move out of Claude's reply, tolerating fences and chatter. */
export function parseMove(text) {
  const s = String(text ?? "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(s.slice(start, end + 1));
      if (typeof j.tool === "string" && j.tool) return { tool: j.tool, args: j.arguments && typeof j.arguments === "object" ? j.arguments : {} };
      if (typeof j.answer === "string") return { answer: j.answer };
    } catch {
      /* fall through: treat the reply as the answer */
    }
  }
  return { answer: s || "Nothing came back." };
}

let seq = 0;

/**
 * One step of thinking. Returns the same shape the website's agent route does:
 * { toolCall, assistant, text } or { text }.
 */
export async function think({ system = "", tools = [], messages = [], model = "" } = {}) {
  let query;
  try {
    ({ query } = await import("@anthropic-ai/claude-agent-sdk"));
  } catch (e) {
    throw Object.assign(new Error(explainBrainError(e)), { status: 503 });
  }
  mkdirSync(SCRATCH, { recursive: true });

  const { text, images } = transcript(messages);
  const systemPrompt = [system, toolCatalog(tools), PROTOCOL].filter(Boolean).join("\n\n");

  async function* prompt() {
    yield {
      type: "user",
      message: { role: "user", content: [{ type: "text", text }, ...images] },
      parent_tool_use_id: null,
      session_id: "",
    };
  }

  let reply = "";
  let failure = "";
  let usedModel = "";
  try {
    const run = query({
      prompt: prompt(),
      options: {
        cwd: SCRATCH,
        systemPrompt,
        maxTurns: 1,
        // Claude Code's own tools stay off: Jarvis's tools run through the
        // page and this bridge, with their own gates.
        allowedTools: [],
        canUseTool: async () => ({ behavior: "deny", message: "Answer with one JSON move instead of calling tools." }),
        // Nothing from the PC's Claude Code settings or CLAUDE.md files leaks
        // into Jarvis's prompt.
        settingSources: [],
        ...(model ? { model } : {}),
      },
    });
    for await (const msg of run) {
      if (msg.type === "system" && msg.subtype === "init") usedModel = msg.model ?? "";
      if (msg.type === "assistant") {
        for (const b of msg.message?.content ?? []) if (b.type === "text") reply += b.text;
      }
      if (msg.type === "result") {
        if (msg.is_error || (msg.subtype && msg.subtype !== "success" && msg.subtype !== "error_max_turns")) {
          failure = String(msg.result ?? msg.subtype ?? "");
        } else if (!reply && typeof msg.result === "string") reply = msg.result;
      }
    }
  } catch (e) {
    throw Object.assign(new Error(explainBrainError(e)), { status: 502 });
  }
  if (!reply && failure) throw Object.assign(new Error(explainBrainError(failure)), { status: 502 });

  const move = parseMove(reply);
  const model_ = usedModel ? `claude-subscription:${usedModel}` : "claude-subscription";
  if (move.tool) {
    const id = `call_${Date.now().toString(36)}_${(seq++).toString(36)}`;
    const args = JSON.stringify(move.args);
    return {
      toolCall: { id, name: move.tool, args: move.args },
      assistant: { role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name: move.tool, arguments: args } }] },
      text: "",
      model: model_,
    };
  }
  return { toolCall: null, text: move.answer.trim() || "Nothing came back.", model: model_ };
}

/** A tiny round trip, so setup can say "working" or exactly what to fix. */
export async function check() {
  try {
    const r = await think({ system: "You are a connection test.", messages: [{ role: "user", content: 'Reply with {"answer":"ready"}' }] });
    return { ok: true, model: r.model, said: r.text };
  } catch (e) {
    return { ok: false, problem: String(e?.message ?? e) };
  }
}
