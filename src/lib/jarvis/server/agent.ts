import "server-only";

// ---------------------------------------------------------------------------
// Jarvis's brain: one tool-calling loop, shared by chat, voice and routines.
//
// Three rules shape this file:
//
//   1. Nothing is invented. The system prompt says so, the answer must cite the
//      memories it used, and a question with no matching memory gets "I don't
//      have that" rather than a plausible guess.
//   2. Read tools run here; write tools do not. The moment the model asks for
//      one, the loop STOPS and hands back a pending action for the owner to
//      confirm. Execution happens later, in the action route, on their yes.
//   3. Everything degrades. No AI key, no Supabase, no connectors — each of
//      those changes what Jarvis can do, and he says which, rather than
//      pretending or failing.
// ---------------------------------------------------------------------------

import { aiEndpoint, aiFetch, DEFAULT_MODEL } from "@/lib/ai/provider";
import { appOf, CORE_TOOLS, isReadOnly, summarise, toApiTools, type ToolSpec } from "../tools";
import type { Citation, MemorySource } from "../types";
import { memoryContext, searchMemory, type MaybeContext } from "./memory";
import { digest, repoFiles } from "./masterFolder";

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ProposedMemory {
  title: string;
  content: string;
}

export interface AgentPending {
  tool: string;
  app: string;
  summary: string;
  args: Record<string, unknown>;
}

export interface AgentResult {
  text: string;
  citations: Citation[];
  proposals: ProposedMemory[];
  pending: AgentPending | null;
  /** Human notes about degraded capability, shown under the answer. */
  notices: string[];
  /** What the loop actually did, for the "did" line on a turn. */
  did: string[];
}

const SYSTEM = `You are Jarvis, {owner}'s personal assistant. You are precise, brief and warm — never florid.

HOW YOU ANSWER
- Search your memory before answering anything about {owner}, their work, their decisions or their history. Do it even when you think you know.
- Ground every claim in a memory, the master-folder context below, or something {owner} said in this conversation. Name where each fact came from, in words, e.g. "from your note 'Hub AI provider', captured 18 Sep".
- When you don't have something, say exactly that and say what would let you answer. Never fill a gap with a plausible guess.
- Never invent messages, meetings, numbers, progress or sources. An empty calendar in your memory does not mean {owner} is free — it means you don't know.
- Distinguish what you were told from what you inferred.
- Keep answers short. Two or three sentences unless asked for more. No headings for a simple answer.

WHAT YOU DO
- You may search memory freely.
- You may propose a memory when {owner} states something durable — a preference, a decision, a lesson. It is only a proposal; they approve it.
- Anything that touches the outside world — creating or changing a calendar event, sending an email or a message — you must NOT do silently. Call the tool and stop: {owner} sees exactly what would happen and confirms it. Say plainly that you have prepared it and are waiting for their yes.

TODAY
{today}

MASTER FOLDER — {owner}'s Claude Code context, always loaded:
{master}`;

/** The one place the model list, temperature and turn cap live. */
const MAX_ROUNDS = 6;

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export interface RunOptions {
  messages: AgentMessage[];
  ownerName: string;
  timezone?: string;
  /** Extra context the caller has (profile summary, routine context). */
  extraContext?: string;
  /** Connector tools; empty in stages 1–3. */
  connectorTools?: ToolSpec[];
  /** Runs a connector read tool. Required when connectorTools is non-empty. */
  runTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  profileId?: string;
}

export async function runAgent(opts: RunOptions): Promise<AgentResult> {
  const notices: string[] = [];
  const did: string[] = [];
  const citations: Citation[] = [];
  const proposals: ProposedMemory[] = [];

  if (!aiEndpoint()) {
    return {
      text:
        "I can't think without an AI key. Set OPENROUTER_API_KEY (or the Vercel gateway key) and " +
        "I'll answer properly — I'd rather say nothing than make something up.",
      citations: [],
      proposals: [],
      pending: null,
      notices: ["No AI key is set on this deployment."],
      did: [],
    };
  }

  const ctx: MaybeContext = await memoryContext(opts.profileId ?? "owner");
  if (!ctx.available) notices.push(`Memory is local-only: ${ctx.reason}`);

  const master = digest(await repoFiles());
  const today = `It is ${new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })}${opts.timezone ? ` in ${opts.timezone}` : ""}.`;

  const system =
    SYSTEM.replaceAll("{owner}", opts.ownerName || "the owner")
      .replace("{today}", today)
      .replace("{master}", master || "(no master-folder files were readable on this deployment)") +
    (opts.extraContext ? `\n\nCONTEXT FOR THIS REQUEST:\n${opts.extraContext}` : "") +
    (ctx.available ? "" : "\n\nNOTE: your long-term memory database is unavailable right now. Say so if asked to remember or recall something.");

  const tools = [...CORE_TOOLS, ...(opts.connectorTools ?? [])];
  const messages: Record<string, unknown>[] = [
    { role: "system", content: system },
    ...opts.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const res = await aiFetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 1200,
        messages,
        tools: toApiTools(tools),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`AI ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    const data = await res.json();
    const message = data?.choices?.[0]?.message ?? {};
    const calls: ToolCall[] = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    if (!calls.length) {
      return {
        text: typeof message.content === "string" ? message.content.trim() : "",
        citations,
        proposals,
        pending: null,
        notices,
        did,
      };
    }

    messages.push(message);

    for (const call of calls) {
      const name = call.function?.name ?? "";
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        args = {};
      }
      const spec = tools.find((t) => t.name === name);

      // A write tool ends the loop. Nothing is executed here, ever.
      if (spec && !isReadOnly(spec)) {
        return {
          text:
            typeof message.content === "string" && message.content.trim()
              ? message.content.trim()
              : "I've prepared this. Say the word and I'll do it.",
          citations,
          proposals,
          pending: {
            tool: name,
            app: appOf(spec),
            summary: summarise(name, args),
            args,
          },
          notices,
          did,
        };
      }

      let result: unknown;
      if (name === "search_memory") {
        const query = typeof args.query === "string" ? args.query : "";
        const limit = Math.min(20, Math.max(1, Number(args.limit) || 8));
        if (!ctx.available) {
          result = { error: "The memory database is unavailable on this device.", memories: [] };
        } else {
          try {
            const { hits, semantic } = await searchMemory(ctx, query, limit);
            did.push(`searched memory for "${query}" (${hits.length} found)`);
            for (const h of hits) {
              if (!citations.some((c) => c.memoryId === h.id)) {
                citations.push({
                  memoryId: h.id,
                  title: h.title,
                  source: h.source as MemorySource,
                  capturedAt: h.capturedAt,
                });
              }
            }
            if (!semantic && hits.length) notices.push("Searched by words only — meaning search needs an OpenRouter key.");
            result = {
              memories: hits.map((h) => ({
                id: h.id,
                title: h.title,
                source: h.source,
                captured: h.capturedAt,
                origin: h.origin,
                content: h.content.slice(0, 1500),
              })),
            };
          } catch (e) {
            result = { error: e instanceof Error ? e.message : "search failed", memories: [] };
          }
        }
      } else if (name === "propose_memory") {
        const title = typeof args.title === "string" ? args.title : "";
        const content = typeof args.content === "string" ? args.content : "";
        if (title && content) {
          proposals.push({ title, content });
          did.push(`proposed a memory: "${title}"`);
        }
        result = { ok: true, note: "Shown to the owner for review. Not saved yet." };
      } else if (spec && opts.runTool) {
        try {
          result = await opts.runTool(name, args);
          did.push(`ran ${name}`);
        } catch (e) {
          result = { error: e instanceof Error ? e.message : "tool failed" };
        }
      } else {
        result = { error: `No tool named ${name} is available.` };
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 12000),
      });
    }
  }

  return {
    text: "I went round in circles on that one. Ask me again with a bit more detail?",
    citations,
    proposals,
    pending: null,
    notices: [...notices, `Stopped after ${MAX_ROUNDS} tool rounds.`],
    did,
  };
}
