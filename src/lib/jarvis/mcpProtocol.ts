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
  "Never save passwords, API keys or card numbers. " +
  "Skills live here too, so every device has the same ones: when the owner asks you to create or change a skill, " +
  "write the complete SKILL.md (YAML frontmatter with name and description, then the instructions) and store it with save_skill — " +
  "that is what makes it appear on their Jarvis website, their PC and their VPS. " +
  "Call list_skills to see what skills exist, and get_skill to load one and follow it when a task matches its description. " +
  "The owner's In Queue is here too: requests they typed for you, filed by app, workflow or skill. " +
  "When asked to work the queue, call queue_list, queue_start the one you take, and when it is finished and verified call queue_complete — " +
  "that removes it from their queue. Whenever you finish any work, check queue_list for a request it satisfies and complete that too. " +
  "Never complete a request that is not actually done; queue_note the blocker instead. " +
  "A \"Client edit\" request ends with client_review_preview (posts the preview to the client), then queue_complete.";

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
    name: "save_skill",
    description:
      "Create or replace one of the owner's skills in Jarvis. The skill then appears on the Jarvis website and is pulled onto the owner's PC and VPS (~/.claude/skills/<name>) at their next Claude Code session. Pass the COMPLETE SKILL.md each time — it replaces the stored one.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Folder name for the skill: letters, digits, dot, dash, underscore, max 64 (e.g. \"stock-screener\").",
        },
        skill_md: {
          type: "string",
          description:
            "The full SKILL.md: YAML frontmatter (---, name:, description: when to use it, ---) followed by the instructions in markdown.",
        },
        references: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            'Optional extra text files the SKILL.md refers to, keyed by path under references/, e.g. {"references/checklist.md": "..."}.',
        },
        origin: { type: "string", description: 'Where it was made, e.g. "claude-code-phone", "claude.ai".' },
      },
      required: ["name", "skill_md"],
    },
  },
  {
    name: "list_skills",
    description: "List every skill stored in Jarvis — name, what it is for, when it last changed and from where.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_skill",
    description: "Load one skill's full SKILL.md and reference files from Jarvis, to follow it or edit it.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "The skill's name, as list_skills shows it." } },
      required: ["name"],
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
  {
    name: "queue_list",
    description:
      "List the owner's In Queue requests — the things they typed into an app's, workflow's or skill's folder for you to do — newest first, with ids, folders, notes and picture links. Pass folder (e.g. flow:animate-my-character, app:jarvis, inbox) to see one folder.",
    inputSchema: {
      type: "object",
      properties: { folder: { type: "string", description: "Optional: one folder id, as queue_list prints it." } },
    },
  },
  {
    name: "queue_add",
    description:
      "File a request in the owner's In Queue, when they ask you to queue something for later rather than do it now. Folder is the queue row it is about (app:<slug>, flow:<workflow-id>, skill:<name>) or inbox.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The request, in the owner's words. A list of '- items' files one request per item." },
        folder: { type: "string" },
      },
      required: ["text"],
    },
  },
  {
    name: "queue_start",
    description: "Mark a queued request as being worked on, so the owner sees 'working on it'. Call it when you begin.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The request id, e.g. q-7k2m9x." } },
      required: ["id"],
    },
  },
  {
    name: "queue_note",
    description:
      "Add a short plain-English note to a queued request without finishing it — progress, or why it is blocked ('needs ffmpeg installed'). Pass release: true to put it back to waiting.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        note: { type: "string" },
        release: { type: "boolean" },
      },
      required: ["id", "note"],
    },
  },
  {
    name: "queue_video_link",
    description:
      "Before completing a request that produced a video (Kids Animation Flow / Animate my character), get the exact commands to upload the finished MP4 so the owner can watch it in Jarvis on any device. Run them, then call queue_complete with video: true.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The request id." } },
      required: ["id"],
    },
  },
  {
    name: "queue_complete",
    description:
      "The request is DONE: this removes it from the owner's queue and logs it as finished. Call it only after the work is actually finished and verified, never before. Give a one-line result (what changed, where the file is, the commit).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        result: { type: "string", description: "One line on what came of it." },
        video: { type: "boolean", description: "True when you uploaded its video with queue_video_link's commands." },
      },
      required: ["id"],
    },
  },
  {
    name: "client_review_preview",
    description:
      "Post a finished client edit to Client Review: the Vercel preview of the branch you built becomes the new version on the client's screen and the client is notified. " +
      "Use it for In Queue requests that start with \"Client edit\" (App Builder, folder app:app-builder), after the edits are verified at their pinned spots, the branch is pushed, the pull request is open (never merged — the owner merges to go live) and the preview opens without a login. " +
      "review_id and version_id are in the request. Then call queue_complete.",
    inputSchema: {
      type: "object",
      properties: {
        review_id: { type: "string", description: "The Client Review project id (crp_…), from the request." },
        version_id: { type: "string", description: "The version being built (ver_…), from the request." },
        preview_url: { type: "string", description: "The Vercel preview URL for the branch — must open without a Vercel login." },
        pr_url: { type: "string", description: "The pull request that puts it live when the owner merges it." },
        branch: { type: "string", description: "The branch the edits are on." },
        summary: { type: "string", description: "What changed, in plain words the client will read (one line per edit)." },
      },
      required: ["review_id", "version_id", "preview_url"],
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
