import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiFetch, aiKey } from "@/lib/ai/provider";
import { EXTRA_SYSTEM } from "@/lib/bible/prompts";
import type { ExtraTopic, HomeBase } from "@/lib/bible/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/** What each button asks for, in words. The ONLY place these are discussed. */
const TOPIC_ASK: Record<ExtraTopic, string> = {
  "legal-structure": "whether to trade as themselves or form a company, and what forming one involves",
  insurance: "what insurance this kind of work actually needs, and what each kind covers",
  banking: "keeping the money separate: accounts, cards, and bookkeeping that takes minutes",
  taxes: "what they will owe, what they can deduct, and what to keep records of from day one",
  branding: "a name, a mark and a look that suits what they are making",
  marketing: "how the first fifty people hear about this, cheaply",
  "selling-online": "where to list it, what each platform takes, and what shipping costs them",
  hiring: "the first person they would pay, and what to hand over first",
  scaling: "what breaks first when demand doubles, and what to fix before it does",
};

// POST /api/bible/extra
// Body: { topic, summary, homeBase? }
// Returns { body } — markdown for one Extra.
export async function POST(req: Request) {
  let body: { topic?: ExtraTopic; summary?: string; homeBase?: HomeBase | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const topic = body.topic;
  if (!topic || !(topic in TOPIC_ASK)) {
    return NextResponse.json({ error: "Unknown topic" }, { status: 400 });
  }
  if (!aiKey()) {
    return NextResponse.json(
      { error: "No AI provider is configured. Set OPENROUTER_API_KEY in .env.local." },
      { status: 503 },
    );
  }

  const where = body.homeBase
    ? `They are in ${body.homeBase.city}, ${body.homeBase.region}, ${body.homeBase.country}.`
    : "No location given.";

  try {
    const res = await aiFetch({
      method: "POST",
      body: JSON.stringify({
        model: process.env.AI_MODEL || DEFAULT_MODEL,
        temperature: 0.3,
        messages: [
          { role: "system", content: EXTRA_SYSTEM },
          {
            role: "user",
            content: `The build: ${(body.summary ?? "").slice(0, 1200)}\n${where}\n\nTopic, and nothing else: ${TOPIC_ASK[topic]}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(110_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `The AI provider refused this (${res.status}).` }, { status: 502 });
    }
    const json = await res.json();
    const markdown = (json?.choices?.[0]?.message?.content ?? "").trim();
    if (!markdown) return NextResponse.json({ error: "That came back empty. Try again." }, { status: 502 });
    return NextResponse.json({ body: markdown.slice(0, 20_000) });
  } catch (err) {
    console.error("bible/extra failed:", err);
    return NextResponse.json({ error: "That took too long. Try again." }, { status: 502 });
  }
}
