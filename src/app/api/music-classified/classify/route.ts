import { NextResponse } from "next/server";
import { aiReady, chatJson } from "@/lib/music-classified/ai";
import {
  CLASSIFY_SYSTEM,
  classifyPrompt,
  coerceDraft,
  heuristicDraft,
} from "@/lib/music-classified/classify";
import type { Identity } from "@/lib/music-classified/identify";
import { isLens } from "@/lib/music-classified/levels";
import type { ClassifyResult, Measured, Tree } from "@/lib/music-classified/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/music-classified/classify
// Body: { identity, measured?, tree, lenses }
// Always answers with a draft: with no AI key, or when the model fails, the
// offline filer does the job and the warning says so.
export async function POST(req: Request) {
  let body: { identity?: Identity; measured?: Measured; tree?: Tree; lenses?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.identity?.title) {
    return NextResponse.json({ error: "Which song? Identify it first." }, { status: 400 });
  }

  const ctx = {
    identity: body.identity,
    measured: body.measured ?? undefined,
    tree: body.tree && typeof body.tree === "object" ? body.tree : {},
    lenses: (body.lenses ?? []).filter(isLens),
  };

  if (!aiReady()) {
    return NextResponse.json({
      draft: heuristicDraft(ctx),
      aiAvailable: false,
      warning: "No AI key is set, so this was filed offline from the store genre and measured tempo.",
    } satisfies ClassifyResult);
  }

  try {
    // The app files with no lenses and writes descriptions in parallel calls
    // (one long reply ran past a minute); lenses here still work for callers
    // that want everything in one round trip.
    // Generous caps: the model's hidden reasoning counts against max_tokens, so
    // a 1400 cap cut off a ~400-token visible reply. Billing is on tokens used.
    const raw = await chatJson(CLASSIFY_SYSTEM, classifyPrompt(ctx), {
      maxTokens: 5000 + 1500 * ctx.lenses.length,
      timeoutMs: 110_000,
    });
    return NextResponse.json({ draft: coerceDraft(raw, ctx), aiAvailable: true } satisfies ClassifyResult);
  } catch (err) {
    console.error("music-classified classify failed, using offline filer:", err);
    return NextResponse.json({
      draft: heuristicDraft(ctx),
      aiAvailable: true,
      warning: "The AI didn't answer, so this was filed offline. Open the song and hit Re-analyze to retry.",
    } satisfies ClassifyResult);
  }
}
