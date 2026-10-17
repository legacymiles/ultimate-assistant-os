import { after, NextResponse } from "next/server";
import { mcpContext } from "@/lib/jarvis/server/mcpAuth";
import { getSkill, listSkills, saveSkill, SkillError } from "@/lib/jarvis/server/skills";
import { noteDevice } from "@/lib/jarvis/server/syncStatus";

// ---------------------------------------------------------------------------
// The skill store over plain HTTP, for scripts/skill-sync.mjs on the PC and
// the VPS. Same token and same account as the jarvis-memory connector
// (Authorization: Bearer <JARVIS_MCP_TOKEN>), so one token covers both, and
// the same server functions the connector's save_skill / get_skill use.
//
//   GET  /api/jarvis/skills            -> { skills: SkillSummary[] }  (no bodies)
//   GET  /api/jarvis/skills?name=foo   -> { skill: StoredSkill }      (full body + references)
//   POST /api/jarvis/skills            <- { name, body, files?, origin? } -> { name, changed, hash }
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function unauthorized(ctx: { reason: string; status: number }) {
  return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
}

export async function GET(req: Request) {
  const ctx = mcpContext(req);
  if (!ctx.available) return unauthorized(ctx);
  const name = new URL(req.url).searchParams.get("name");
  // The skill list is what every pull starts with: note this computer checked in.
  if (!name) after(() => noteDevice(ctx, req, req.headers.get("x-skill-sync-action") || "pull"));
  try {
    if (name) {
      const skill = await getSkill(ctx, name);
      return skill ? NextResponse.json({ skill }) : NextResponse.json({ error: `No skill named ${name}` }, { status: 404 });
    }
    return NextResponse.json({ skills: await listSkills(ctx) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "read failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const ctx = mcpContext(req);
  if (!ctx.available) return unauthorized(ctx);
  const body = (await req.json().catch(() => null)) as { name?: string; body?: string; files?: unknown; origin?: string } | null;
  if (!body) return NextResponse.json({ error: "Body was not JSON." }, { status: 400 });
  after(() => noteDevice(ctx, req, "push"));
  try {
    const r = await saveSkill(ctx, { name: body.name ?? "", body: body.body ?? "", files: body.files, origin: body.origin });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof SkillError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "save failed" }, { status: 500 });
  }
}
