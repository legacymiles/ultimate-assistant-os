import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiFetch, aiKey } from "@/lib/ai/provider";
import { extractCode } from "@/lib/ea-replay/custom";
import { PORT_SYSTEM, portUserMessage, splitNotes } from "@/lib/ea-replay/portPrompt";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_SOURCE = 120_000;

// POST /api/ea-replay/port  { source: string, fileName?: string }
// -> { code, notes } | { error }
//
// MQL4 source in, replay-bot JavaScript out. The code is only PARSED here to
// catch a broken reply early — it is never executed on the server. It runs in
// the owner's browser, inside their own replay.
export async function POST(req: Request) {
  let body: { source?: string; fileName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const source = (body.source ?? "").trim();
  if (!source) return NextResponse.json({ error: "Paste the .mq4 source first" }, { status: 400 });
  if (/^\s*EX-?[\x00-\x1f]/.test(source) || source.includes("\u0000")) {
    return NextResponse.json({ error: "That is a compiled .ex4 — only .mq4 source can be ported. Nothing can read inside an .ex4." }, { status: 400 });
  }
  if (source.length > MAX_SOURCE) return NextResponse.json({ error: "That file is over 120 KB of source — trim the parts that are not the strategy" }, { status: 413 });
  if (!aiKey()) {
    return NextResponse.json(
      { error: "No AI key is set (OPENROUTER_API_KEY or AI_GATEWAY_API_KEY), so the porter is off. Write the bot by hand from the template instead." },
      { status: 503 },
    );
  }

  try {
    const res = await aiFetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.AI_MODEL || DEFAULT_MODEL,
        temperature: 0.1,
        messages: [
          { role: "system", content: PORT_SYSTEM },
          { role: "user", content: portUserMessage(body.fileName ?? "", source) },
        ],
      }),
      signal: AbortSignal.timeout(110_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `The AI provider answered ${res.status}. ${text.slice(0, 200)}` }, { status: 502 });
    }
    const json = await res.json();
    const reply: string = json?.choices?.[0]?.message?.content ?? "";
    const code = extractCode(reply.replace(/NOTES:[\s\S]*$/i, ""));
    try {
      // Parse only. `new Function` compiles without running the body.
      new Function(`"use strict"; return (${code.replace(/;\s*$/, "")});`);
    } catch (e) {
      return NextResponse.json({ error: `The port came back with broken code (${e instanceof Error ? e.message : "syntax"}). Try again.`, code }, { status: 422 });
    }
    return NextResponse.json({ code, notes: splitNotes(reply) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Port failed" }, { status: 502 });
  }
}
