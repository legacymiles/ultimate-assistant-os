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
import { appOf, CORE_TOOLS, DASHBOARD_TOOLS, isReadOnly, STUDIO_TOOLS, summarise, toApiTools, type ToolSpec } from "../tools";
import { cleanForm, type StudioForm } from "@/lib/studio/forms";
import { cleanStoryboard, type Storyboard } from "@/lib/studio/storyboard";
import type { Citation, MemorySource } from "../types";
import { memoryContext, searchMemory, type MaybeContext } from "./memory";
import { digest, repoFiles } from "./masterFolder";

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  /** Images the owner attached to this turn, as data: URLs. User turns only. */
  images?: string[];
}

/** A turn with pictures becomes text + image parts; the model sees both. */
function toApiContent(m: AgentMessage): unknown {
  if (m.role !== "user" || !m.images?.length) return m.content;
  return [
    { type: "text", text: m.content || "(image attached)" },
    ...m.images.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
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
  /** A Studio skill is waiting on the owner's answers to this form. */
  form?: StudioForm | null;
  /** A shot plan for the owner to edit, then render as one film. */
  storyboard?: Storyboard | null;
  /**
   * An audio-driven shot plan, passed through as the director wrote it.
   *
   * Deliberately NOT validated here, unlike a storyboard: a score's every shot
   * time is only meaningful against the measured timeline of the track, and that
   * timeline lives in the browser (it was computed from the owner's own file by
   * Web Audio and never uploaded). So `cleanScore` — which is the trust boundary
   * — runs on the client, where the clock it has to check against exists. This
   * value is raw model output and nothing may render or persist it unchecked.
   */
  score?: unknown;
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
- {owner}'s Dashboard — folders, their own calendar and the family Lists — is summarised under CONTEXT FOR THIS REQUEST when available. Answer questions about those from that summary and say it came from their folders / lists / calendar. To add a list entry, a note or an event there, call lists_add_item, dashboard_add_note or dashboard_add_event; like every change, it waits for their yes.
- Anything that touches the outside world — creating or changing a calendar event, sending an email or a message — you must NOT do silently. Call the tool and stop: {owner} sees exactly what would happen and confirms it. Say plainly that you have prepared it and are waiting for their yes.

TODAY
{today}

MASTER FOLDER — {owner}'s Claude Code context, always loaded:
{master}`;

/**
 * What the Chat tab's agent is told on top of the assistant prompt.
 *
 * The difference is not personality, it is how far it may go on its own: this
 * one is expected to chain tools until the question is actually answered, and
 * to say what it did. Rule 2 does not bend - a write still stops the loop and
 * waits for a yes - so "act" here means read, gather and draft, never send.
 */
const AGENT = `HOW YOU WORK ON THIS TAB
- You are the owner's general agent here, not a chatbot. Work the question: decide what you need, call the tools you need, read what comes back, and call more if the answer still has a hole in it.
- Chain tools without asking permission to look something up. Asking "shall I search your memory?" wastes a turn - search it.
- When a picture is attached, read it and answer about what is actually in it.
- Video, shot plans and renders are not yours: they live on the Studio tab. If the owner asks for a film, a shot or a clip here, say so in one line and point them there. Do not write shot lists.
- Do not pad. If the answer is one sentence, send one sentence.`;

/** The one place the model list, temperature and turn cap live. */
const MAX_ROUNDS = 6;
/** An agent chains tools; the same cap would cut it off mid-job. */
const AGENT_ROUNDS = 10;

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
  /** A Studio skill is running: offer the form and render tools, allow long answers. */
  studio?: boolean;
  /**
   * The Chat tab's agent: chain tools further, and say so. Never set with
   * `studio` - they are two jobs on two tabs, and a prompt told to do both
   * does neither.
   */
  agent?: boolean;
  /**
   * The model to think with, when the caller pins one.
   *
   * Left unset, the request asks for the hub's general model and the owner's
   * pick on the front page answers it. A caller that names one here is saying
   * this surface IS that model - the Chat tab is DeepSeek - so it must name a
   * model the provider passes through untouched (modelChain, provider.ts).
   */
  model?: string;
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
    (opts.agent ? `\n\n${AGENT}` : "") +
    (opts.extraContext ? `\n\nCONTEXT FOR THIS REQUEST:\n${opts.extraContext}` : "") +
    (ctx.available ? "" : "\n\nNOTE: your long-term memory database is unavailable right now. Say so if asked to remember or recall something.");

  const tools = [
    ...CORE_TOOLS,
    ...DASHBOARD_TOOLS,
    ...(opts.studio ? STUDIO_TOOLS : []),
    ...(opts.connectorTools ?? []),
  ];
  const messages: Record<string, unknown>[] = [
    { role: "system", content: system },
    ...opts.messages.map((m) => ({ role: m.role, content: toApiContent(m) })),
  ];

  const rounds = opts.agent ? AGENT_ROUNDS : MAX_ROUNDS;
  for (let round = 0; round < rounds; round += 1) {
    const res = await aiFetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model || DEFAULT_MODEL,
        // Studio skills write shot tables and full prompts; everything else
        // stays short. An agent gets more room than a one-shot answer: it
        // chains tool rounds, and a model that thinks first spends part of
        // this budget on that.
        max_tokens: opts.studio ? 8000 : opts.agent ? 4000 : 1200,
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

      // A form pauses the loop: the owner answers it, and that answer is the next turn.
      if (name === "studio_form" && opts.studio) {
        const form = cleanForm(args);
        if (form) {
          return {
            text: typeof message.content === "string" ? message.content.trim() : "",
            citations,
            proposals,
            pending: null,
            form,
            notices,
            did,
          };
        }
      }

      // A shot plan pauses the loop too: it is the owner's to edit, and only
      // they start the render. Nothing is spent until they press the button.
      if (name === "studio_storyboard" && opts.studio) {
        const storyboard = cleanStoryboard(args);
        if (storyboard) {
          return {
            text: typeof message.content === "string" ? message.content.trim() : "",
            citations,
            proposals,
            pending: null,
            storyboard,
            notices,
            did,
          };
        }
      }

      // A score pauses the loop for the same reason a storyboard does: the plan
      // is the owner's to edit, and only they start the render.
      if (name === "studio_score" && opts.studio) {
        if (args && typeof args === "object" && Array.isArray((args as { shots?: unknown }).shots)) {
          return {
            text: typeof message.content === "string" ? message.content.trim() : "",
            citations,
            proposals,
            pending: null,
            score: args,
            notices,
            did,
          };
        }
      }

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
          // Said out loud rather than swallowed: a trace that shows nothing
          // reads as an agent that looked nothing up, and it did look.
          did.push(`tried to search memory for "${query}" — the database is unavailable`);
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
      } else if (name === "studio_storyboard") {
        // It only reaches here when the board had no usable shot in it.
        result = {
          error:
            "That shot plan had no shots in it. Send `shots` as an array, each with a title, an action and a "
            + "duration_sec between 4 and 15.",
        };
      } else if (name === "studio_score") {
        // Likewise: it only reaches here when there were no shots to place.
        result = {
          error:
            "That score had no shots in it. Send `shots` as an array, each with a title, an at_sec on the "
            + "track's clock, an action and a `because`. Consecutive at_sec values must be 4-15 seconds apart.",
        };
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
    notices: [...notices, `Stopped after ${rounds} tool rounds.`],
    did,
  };
}
