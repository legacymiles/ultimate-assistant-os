import { after, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// One memory, reachable from everywhere.
//
// This is the MCP endpoint that Claude Code (on the PC or the VPS) and a
// claude.ai custom connector talk to. It is a thin seam: the protocol lives in
// `lib/jarvis/mcpProtocol.ts`, who-is-asking lives in `server/mcpAuth.ts`, and
// every actual read and write goes through the SAME `server/memory.ts`
// functions the browser uses. There is no second copy of the memory logic
// here, which is what makes "the same memory everywhere" true rather than
// aspirational.
// ---------------------------------------------------------------------------

import { handleRpc, TOOLS, type RpcRequest } from "@/lib/jarvis/mcpProtocol";
import { mcpConfig, mcpContext, mcpReady } from "@/lib/jarvis/server/mcpAuth";
import {
  deleteMemory,
  listMemories,
  saveMemories,
  searchMemory,
  sourceOf,
  type MemoryContext,
} from "@/lib/jarvis/server/memory";
import { MEMORY_SOURCES, type MemorySource } from "@/lib/jarvis/types";
import { getSkill, listSkills, saveSkill, SkillError } from "@/lib/jarvis/server/skills";
import { noteConnector } from "@/lib/jarvis/server/syncStatus";

export const runtime = "nodejs";
// Embedding plus a Supabase round trip can outrun the default on a cold start.
export const maxDuration = 60;

/** Sources that mirror a real file on disk; deleting the row would just lie. */
const MIRRORED: MemorySource[] = ["vault", "master-folder"];

function clamp(v: unknown, fallback: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Run one tool against the shared memory functions, returning text for the model. */
async function runTool(ctx: MemoryContext, name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "search_memory": {
      const query = str(args.query);
      const limit = clamp(args.limit, 8, 50);
      const { hits, semantic } = await searchMemory(ctx, query, limit);
      if (!hits.length) return "No memories matched. Try fewer or different words.";
      const lines = hits.map(
        (h) =>
          `- [${h.source}] ${h.title}\n  ${h.content.replace(/\s+/g, " ").slice(0, 600)}\n  (id ${h.id}, captured ${h.capturedAt}, from ${h.origin})`,
      );
      return `${hits.length} memories (${semantic ? "meaning + word" : "word"} search):\n${lines.join("\n")}`;
    }

    case "save_memory": {
      const content = str(args.content);
      if (!content) return "Nothing to save: content was empty.";
      const asked = str(args.source) as MemorySource;
      // An external client may not invent a source. Anything it does not name
      // correctly becomes "chat", which is what a fact stated in conversation
      // is — and keeps file-mirroring sources off limits from out here.
      const source: MemorySource =
        MEMORY_SOURCES.includes(asked) && !MIRRORED.includes(asked) ? asked : "chat";
      const title = str(args.title) || content.split("\n")[0].slice(0, 120);
      const tags = Array.isArray(args.tags)
        ? args.tags.filter((t): t is string => typeof t === "string").slice(0, 20)
        : [];
      const { saved } = await saveMemories(ctx, [
        { source, title: title.slice(0, 300), content, origin: str(args.origin) || "mcp", tags },
      ]);
      return saved
        ? `Saved: ${title.slice(0, 120)}`
        : "Already saved — an identical memory exists, so nothing was added.";
    }

    case "list_recent": {
      const limit = clamp(args.limit, 20, 100);
      const rows = await listMemories(ctx, limit);
      if (!rows.length) return "Memory is empty.";
      return rows
        .map((r) => `- [${r.source}] ${r.title} (id ${r.id}, ${r.capturedAt})`)
        .join("\n");
    }

    case "save_skill": {
      const name = str(args.name);
      const body = typeof args.skill_md === "string" ? args.skill_md : "";
      try {
        const r = await saveSkill(ctx, { name, body, files: args.references, origin: str(args.origin) || "connector" });
        return r.changed
          ? `Saved skill "${r.name}" to Jarvis. It is on the website now, and your PC and VPS pull it at their next Claude Code session.`
          : `Skill "${r.name}" is already saved exactly like this — nothing changed.`;
      } catch (e) {
        if (e instanceof SkillError) return `Not saved: ${e.message}`;
        throw e;
      }
    }

    case "list_skills": {
      const skills = await listSkills(ctx);
      if (!skills.length) return "No skills are stored in Jarvis yet.";
      return `${skills.length} skills:\n` +
        skills
          .map((s) => `- ${s.name}: ${s.description.replace(/\s+/g, " ").slice(0, 220)}${s.updatedFrom ? ` (from ${s.updatedFrom}, ${s.updatedAt.slice(0, 10)})` : ""}`)
          .join("\n");
    }

    case "get_skill": {
      const name = str(args.name);
      const sk = await getSkill(ctx, name);
      if (!sk) return `No skill named "${name}". Call list_skills to see what exists.`;
      const refs = Object.entries(sk.files);
      return (
        `# ${sk.name}${sk.complete ? "" : " (summary only — the full skill has not been saved to Jarvis yet)"}\n\n${sk.body}` +
        (refs.length ? `\n\n---\nReference files:\n${refs.map(([k, v]) => `\n=== ${k} ===\n${v}`).join("\n")}` : "")
      );
    }

    case "delete_memory": {
      const id = str(args.id);
      if (!id) return "No id given.";
      const source = await sourceOf(ctx, id);
      if (!source) return `No memory with id ${id}.`;
      if (MIRRORED.includes(source)) {
        return `That memory mirrors a real file (${source}), so deleting the row here would not remove anything. Delete the file instead.`;
      }
      await deleteMemory(ctx, id);
      return `Deleted ${id}.`;
    }

    default:
      throw new Error(`No tool named ${name}.`);
  }
}

/**
 * A status probe for the Memory tab's sync card. Deliberately unauthenticated
 * and deliberately boolean-only: the card has to be able to say "you still
 * need to set the token" to someone who, by definition, has not got one yet.
 */
export async function GET() {
  return NextResponse.json({
    server: "jarvis-memory",
    ready: mcpReady(),
    config: mcpConfig(),
    tools: TOOLS.map((t) => t.name),
  });
}

export async function POST(req: Request) {
  const ctx = mcpContext(req);
  if (!ctx.available) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: ctx.reason } },
      { status: ctx.status },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Body was not JSON." } },
      { status: 400 },
    );
  }

  // Leave a note that this connector is in use (which client, when), so Jarvis
  // can show it as set up. After the response, never in its way.
  const messages = (Array.isArray(body) ? body : [body]) as RpcRequest[];
  const init = messages.find((m) => m?.method === "initialize");
  const clientInfo = (init?.params as { clientInfo?: { name?: string } } | undefined)?.clientInfo;
  const viaQuery = new URL(req.url).searchParams.has("k");
  const client = clientInfo?.name || (viaQuery ? "claude-ai" : "claude-code");
  after(() => noteConnector(ctx, client, Boolean(init)));

  const run = (name: string, args: Record<string, unknown>) => runTool(ctx, name, args);

  // A client may batch several messages into one array.
  if (Array.isArray(body)) {
    const out = (await Promise.all((body as RpcRequest[]).map((m) => handleRpc(m, run)))).filter(Boolean);
    // An all-notification batch gets 202 and no body, per JSON-RPC.
    return out.length ? NextResponse.json(out) : new Response(null, { status: 202 });
  }

  const res = await handleRpc(body as RpcRequest, run);
  return res ? NextResponse.json(res) : new Response(null, { status: 202 });
}
