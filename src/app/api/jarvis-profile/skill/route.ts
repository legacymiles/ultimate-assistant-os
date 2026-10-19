import { NextResponse } from "next/server";
import { memoryContext } from "@/lib/jarvis/server/memory";
import { saveSkill, SkillError } from "@/lib/jarvis/server/skills";
import { callerIsMember } from "@/lib/recall/lists/session";
import { SKILL_NAME } from "@/lib/jarvis-profile/checklist";

// ---------------------------------------------------------------------------
// POST /api/jarvis-profile/skill { body }
//
// Publishes the build checklist as the Claude Code skill
// "website-build-checklist" in the same skill store every device syncs from
// (scripts/skill-sync.mjs on the PC and VPS, the jarvis-memory connector), so
// Claude Code builds follow the same rules Jarvis does. Owner only.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (await callerIsMember()) {
    return NextResponse.json({ error: "This part of Jarvis is not shared." }, { status: 403 });
  }
  const ctx = await memoryContext();
  if (!ctx.available) return NextResponse.json({ published: false, notice: ctx.reason });
  const body = (await req.json().catch(() => null)) as { body?: unknown } | null;
  const text = typeof body?.body === "string" ? body.body : "";
  try {
    const r = await saveSkill(ctx, { name: SKILL_NAME, body: text, origin: "jarvis-profile" });
    return NextResponse.json({ published: true, changed: r.changed });
  } catch (e) {
    if (e instanceof SkillError) return NextResponse.json({ published: false, notice: e.message }, { status: 400 });
    return NextResponse.json({ published: false, notice: "Couldn't save the checklist skill just now. Jarvis will try again." });
  }
}
