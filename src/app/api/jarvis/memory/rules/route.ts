import { NextResponse } from "next/server";
import { memoryContext } from "@/lib/jarvis/server/memory";
import { addFinding, addLog, recentLog } from "@/lib/memory-rules/rules";
import { readRules, updateRules } from "@/lib/memory-rules/server/store";
import { APP_EDITS } from "@/lib/timeline/appEdits";

// ---------------------------------------------------------------------------
// The memory rules for the signed-in owner: the daily log and the findings
// per workflow, read by the Memory map (timeline + layer 4 nodes). The owner
// can add a finding or a log line by hand from the map; agents write through
// the jarvis-memory connector instead.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

/**
 * The newest app edits, trimmed to what the map's timeline shows. Served from
 * here so the browser never bundles the whole feature log (it is ~240 KB).
 */
function recentAppEdits(limit = 300): { slug: string; date: string; title: string }[] {
  return [...APP_EDITS]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
    .map((e) => ({ slug: e.slug, date: e.date, title: e.title.slice(0, 160) }));
}

export async function GET() {
  const appEdits = recentAppEdits();
  const ctx = await memoryContext();
  if (!ctx.available) return NextResponse.json({ available: false, log: [], findings: {}, appEdits });
  const doc = await readRules(ctx.userId);
  return NextResponse.json({ available: true, log: recentLog(doc, 14), findings: doc.findings, appEdits });
}

export async function POST(req: Request) {
  const ctx = await memoryContext();
  if (!ctx.available) return NextResponse.json({ error: ctx.reason }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text : "";
  try {
    if (body.kind === "finding") {
      let added = false;
      await updateRules(ctx.userId, (d) => {
        const r = addFinding(d, { workflow: String(body.workflow ?? ""), text, by: "owner", kind: body.mark as "win" | "miss" | "note" });
        added = r.added;
        return r.doc;
      });
      return NextResponse.json({ added });
    }
    let added = 0;
    await updateRules(ctx.userId, (d) => {
      const r = addLog(d, [{ text, by: "owner", about: typeof body.about === "string" ? body.about : undefined, timeZone: typeof body.timezone === "string" ? body.timezone : undefined }]);
      added = r.added;
      return r.doc;
    });
    return NextResponse.json({ added });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save." }, { status: 503 });
  }
}
