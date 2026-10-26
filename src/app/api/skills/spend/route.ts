import { NextResponse } from "next/server";
import { memoryContext } from "@/lib/jarvis/server/memory";
import { isRouteTier, setCap, setPin, type SpendDoc } from "@/lib/skills/spend";
import { readSpend, updateSpend } from "@/lib/skills/server/spendStore";

// ---------------------------------------------------------------------------
// Skills Library › Spend — what each skill costs, plus the owner's controls.
//
//   GET                                     -> { spend: SpendDoc }
//   PATCH { skill, cap: number | null }     -> weekly dollar cap (null clears it)
//   PATCH { skill, pin: tier | null }       -> fix a skill to a model tier (null = let Jev pick)
//
// Reading works without a sign-in (local demo mode shows whatever was metered);
// changing a cap or a pin needs one.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const view = (doc: SpendDoc) => ({ ...doc, seen: undefined });

export async function GET() {
  try {
    return NextResponse.json({ spend: view(await readSpend()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ spend: null, reason: e instanceof Error ? e.message : "Could not read skill spend." });
  }
}

export async function PATCH(req: Request) {
  const ctx = await memoryContext();
  if (!ctx.available) return NextResponse.json({ error: "Sign in to change caps and model picks." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const skill = typeof body.skill === "string" ? body.skill : "";
  if (!skill) return NextResponse.json({ error: "Which skill?" }, { status: 400 });
  try {
    const doc = await updateSpend((d) => {
      let next = d;
      if ("cap" in body) next = setCap(next, skill, body.cap === null ? null : Number(body.cap));
      if ("pin" in body) next = setPin(next, skill, isRouteTier(body.pin) ? body.pin : null);
      return next;
    });
    return NextResponse.json({ spend: view(doc) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save." }, { status: 503 });
  }
}
