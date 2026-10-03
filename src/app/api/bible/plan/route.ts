import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiFetch, aiKey } from "@/lib/ai/provider";
import { cleanPlan } from "@/lib/bible/clean";
import { PLAN_SCHEMA, PLAN_SYSTEM, briefBlock } from "@/lib/bible/prompts";
import type { Brief, HomeBase } from "@/lib/bible/types";

export const runtime = "nodejs";
// A whole build plan is a long answer; the UI shows a progress line meanwhile.
export const maxDuration = 120;

// POST /api/bible/plan
// Body: { brief: Brief, homeBase: HomeBase | null }
// Returns { plan } or { error } — never a 500. With no key configured the app
// still works by hand, so the honest answer is a sentence saying why not.
export async function POST(req: Request) {
  let body: { brief?: Brief; homeBase?: HomeBase | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const brief = body.brief;
  if (!brief?.what?.trim()) {
    return NextResponse.json({ error: "Say what you want to build first" }, { status: 400 });
  }

  if (!aiKey()) {
    return NextResponse.json(
      { error: "No AI provider is configured, so plans cannot be generated. Set OPENROUTER_API_KEY in .env.local. You can still write steps by hand." },
      { status: 503 },
    );
  }

  const homeBase = body.homeBase ?? null;
  const currency = brief.locationOverride?.currency || homeBase?.currency || "USD";
  const model = process.env.AI_MODEL || DEFAULT_MODEL;

  try {
    const res = await aiFetch({
      method: "POST",
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PLAN_SYSTEM },
          {
            role: "user",
            content: `${briefBlock(brief, homeBase)}\n\nReturn JSON in exactly this shape:\n${PLAN_SCHEMA}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(110_000),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("bible/plan provider refused:", res.status, detail.slice(0, 400));
      return NextResponse.json(
        { error: `The AI provider refused this (${res.status}). Try again, or pick another model on the hub's front page.` },
        { status: 502 },
      );
    }

    const json = await res.json();
    const plan = cleanPlan(
      JSON.parse(json?.choices?.[0]?.message?.content ?? "{}"),
      json?.model ?? model,
      currency,
    );
    if (!plan) {
      return NextResponse.json(
        { error: "The answer came back in a shape this app could not read. Try generating again." },
        { status: 502 },
      );
    }
    return NextResponse.json({ plan });
  } catch (err) {
    console.error("bible/plan failed:", err);
    return NextResponse.json(
      { error: "That took too long or the connection dropped. Nothing was changed — try again." },
      { status: 502 },
    );
  }
}
