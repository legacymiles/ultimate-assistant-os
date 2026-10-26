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
import { noteSkillUse } from "@/lib/skills/server/usageStore";
import {
  addRequests,
  attachVideo,
  completeRequest,
  videoKey,
  describeForAgent,
  noteRequest,
  releaseRequest,
  RequestError,
  startRequest,
} from "@/lib/new-jarvis/requests";
import { readRequests, updateRequests } from "@/lib/new-jarvis/server/requestsStore";
import { folderName } from "@/lib/new-jarvis/server/requestsAuth";
import { videoUploadLink } from "@/lib/new-jarvis/server/requestVideo";
import { ReviewError } from "@/lib/client-review/logic";
import { shipPreviewNow } from "@/lib/client-review/ship";
import { addFinding, addLog, agentDeleteRefusal, agentSource, findingsBlock, findRouter, routerIndex, routerMarkdown } from "@/lib/memory-rules/rules";
import { readRules, routersFor, updateRules } from "@/lib/memory-rules/server/store";

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
async function runTool(
  ctx: MemoryContext,
  name: string,
  args: Record<string, unknown>,
  origin = "",
  client = "claude-code",
): Promise<string> {
  if (name.startsWith("queue_")) return runQueueTool(ctx, name, args, origin, client);
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
      // An external client may not invent a source, and may not write as the
      // owner: notes, profile and vault are the human side of memory. Anything
      // else it does not name correctly becomes "chat", which is what a fact
      // stated in conversation is.
      const source: MemorySource = agentSource(str(args.source), MEMORY_SOURCES);
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
      // Loading a skill to follow it is a call — counted for Skills Library › Usage.
      after(() => noteSkillUse(ctx, [{ skill: sk.name, source: "connector" }]));
      const refs = Object.entries(sk.files);
      return (
        `# ${sk.name}${sk.complete ? "" : " (summary only — the full skill has not been saved to Jarvis yet)"}\n\n${sk.body}` +
        (refs.length ? `\n\n---\nReference files:\n${refs.map(([k, v]) => `\n=== ${k} ===\n${v}`).join("\n")}` : "")
      );
    }

    case "client_review_preview": {
      try {
        const out = await shipPreviewNow(
          {
            reviewId: str(args.review_id),
            versionId: str(args.version_id),
            siteUrl: str(args.preview_url),
            prUrl: str(args.pr_url) || undefined,
            branch: str(args.branch) || undefined,
            summary: str(args.summary) || undefined,
          },
          origin,
        );
        const who = out.project.clientName || "the client";
        return out.already
          ? `${out.version.number} already shows that preview — nothing changed. Call queue_complete if you haven't.`
          : `Posted: ${out.version.number} (${out.version.siteUrl}) is now on ${who}'s Client Review link and they were notified. ` +
              `It goes live when the owner merges ${out.version.prUrl ?? "the pull request"}. Now call queue_complete.`;
      } catch (e) {
        if (e instanceof ReviewError) return `Not posted: ${e.message}`;
        throw e;
      }
    }

    case "delete_memory": {
      const id = str(args.id);
      if (!id) return "No id given.";
      const source = await sourceOf(ctx, id);
      if (!source) return `No memory with id ${id}.`;
      if (MIRRORED.includes(source)) {
        return `That memory mirrors a real file (${source}), so deleting the row here would not remove anything. Delete the file instead.`;
      }
      const refusal = agentDeleteRefusal(source);
      if (refusal) return refusal;
      await deleteMemory(ctx, id);
      return `Deleted ${id}.`;
    }

    case "get_router": {
      const routers = await routersFor(ctx);
      const area = str(args.area);
      if (!area) return routerIndex(routers);
      const hit = findRouter(routers, area);
      return hit ? routerMarkdown(hit) : `No area matches "${area}".\n\n${routerIndex(routers)}`;
    }

    case "log_activity": {
      const text = str(args.text);
      if (!text) return "Nothing logged: text was empty.";
      let added = 0;
      await updateRules(ctx.userId, (d) => {
        const r = addLog(d, [{ text, by: client, about: str(args.about) || undefined, timeZone: str(args.timezone) || undefined }]);
        added = r.added;
        return r.doc;
      });
      return added ? "Logged in today's daily log." : "Already in today's log.";
    }

    case "get_findings": {
      const workflow = str(args.workflow);
      if (!workflow) return "Name the workflow or skill.";
      const block = findingsBlock(await readRules(ctx.userId), workflow, 25);
      return block || `No findings yet for ${workflow}. After this run, add_finding with what worked or what to avoid.`;
    }

    case "add_finding": {
      let res = { added: false, key: "" };
      await updateRules(ctx.userId, (d) => {
        const r = addFinding(d, { workflow: str(args.workflow), text: str(args.text), by: client, kind: str(args.kind) as "win" | "miss" | "note" });
        res = { added: r.added, key: r.key };
        return r.doc;
      });
      if (!res.key) return "Not saved: name the workflow and write the lesson.";
      return res.added ? `Saved a finding for ${res.key}.` : `Already on file for ${res.key}.`;
    }

    default:
      throw new Error(`No tool named ${name}.`);
  }
}

/**
 * The In Queue tools. A RequestError is the agent's mistake (a stale id) and
 * comes back as text it can read; anything else is thrown and reported as a
 * failed tool by handleRpc.
 */
async function runQueueTool(
  ctx: MemoryContext,
  name: string,
  args: Record<string, unknown>,
  origin: string,
  client: string,
): Promise<string> {
  const id = str(args.id);
  const imageUrl = (rid: string, n: number) =>
    `${origin}/api/new-jarvis/requests/image?id=${encodeURIComponent(rid)}&n=${n} (header Authorization: Bearer <the same token as this connector>)`;
  try {
    switch (name) {
      case "queue_list":
        return describeForAgent(await readRequests(ctx.userId), folderName, imageUrl, str(args.folder) || undefined);
      case "queue_add": {
        let added = 0;
        await updateRequests(ctx.userId, (d) => {
          const r = addRequests(d, { folder: str(args.folder) || undefined, text: str(args.text), from: client });
          added = r.added.length;
          return r.doc;
        });
        return added ? `Queued ${added} request${added === 1 ? "" : "s"}.` : "Already queued — nothing new added.";
      }
      case "queue_start":
        await updateRequests(ctx.userId, (d) => startRequest(d, id, client));
        return `Marked ${id} as being worked on.`;
      case "queue_note":
        await updateRequests(ctx.userId, (d) => {
          const noted = noteRequest(d, id, str(args.note), client);
          return args.release === true ? releaseRequest(noted, id) : noted;
        });
        return args.release === true ? `Noted, and ${id} is back to waiting.` : `Noted on ${id}.`;
      case "queue_video_link": {
        const doc = await readRequests(ctx.userId);
        if (!doc.requests.some((r) => r.id === id)) return `Not changed: no open request ${id}.`;
        const link = await videoUploadLink(ctx.userId, id);
        if (link) {
          return [
            `Upload the finished MP4 for ${id} with ONE command (the link works once, for about two hours; no token needed):`,
            `curl -sS -X PUT -H "Content-Type: video/mp4" -H "x-upsert: true" --data-binary @<path-to>/share.mp4 "${link.url}"`,
            `PowerShell: Invoke-WebRequest -Method Put -ContentType "video/mp4" -Headers @{"x-upsert"="true"} -InFile <path-to>/share.mp4 -Uri "${link.url}"`,
            `When it returns 200, call queue_complete with id ${id}, video: true and a one-line result.`,
          ].join("\n");
        }
        return [
          `This hub has no cloud storage, so post the file to it (up to ~10 MB) with the connector's token:`,
          `curl -sS -H "Authorization: Bearer <the connector token>" -H "x-agent: ${client}" -F id=${id} -F file=@<path-to>/share.mp4 ${origin}/api/new-jarvis/requests/video`,
          `Then call queue_complete with id ${id}, video: true and a one-line result.`,
        ].join("\n");
      }
      case "queue_complete":
        await updateRequests(ctx.userId, (d) => {
          const withVideo = args.video === true ? attachVideo(d, id, videoKey(ctx.userId, id), client) : d;
          return completeRequest(withVideo, id, client, str(args.result) || undefined);
        });
        return `Done — ${id} is off the queue and in the finished log${args.video === true ? ", with its video ready to watch in Jarvis" : ""}.`;
      default:
        throw new Error(`No tool named ${name}.`);
    }
  } catch (e) {
    if (e instanceof RequestError) return `Not changed: ${e.message}`;
    throw e;
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

  const origin = new URL(req.url).origin;
  const run = (name: string, args: Record<string, unknown>) => runTool(ctx, name, args, origin, client);

  // A client may batch several messages into one array.
  if (Array.isArray(body)) {
    const out = (await Promise.all((body as RpcRequest[]).map((m) => handleRpc(m, run)))).filter(Boolean);
    // An all-notification batch gets 202 and no body, per JSON-RPC.
    return out.length ? NextResponse.json(out) : new Response(null, { status: 202 });
  }

  const res = await handleRpc(body as RpcRequest, run);
  return res ? NextResponse.json(res) : new Response(null, { status: 202 });
}
