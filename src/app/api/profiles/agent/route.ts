import { NextResponse } from "next/server";
import { aiFetch, describeFailure } from "@/lib/ai/provider";

// ---------------------------------------------------------------------------
// The Profiles chat's cloud brain.
//
// Used when the owner's PC harness can't answer (on a phone, away from the
// desk). The page builds the prompt — the same one the harness gets, see
// lib/profiles/agent.ts — so this route only carries it to the hub's AI
// provider and returns the words. It never reads or writes profile data, and
// it never applies a change: the page shows every proposed change for Save.
//
// Owner-only like every /api route (middleware). With no provider configured
// it answers 503 { offline: true } and the page falls back to its offline
// reader, so the chat still works in local demo mode.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  system?: string;
  history?: { role?: string; text?: string }[];
  message?: string;
}

const MAX = 120_000;

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "That request wasn't readable." }, { status: 400 });
  }
  const system = String(body.system ?? "").slice(0, MAX);
  const message = String(body.message ?? "").slice(0, 8_000).trim();
  if (!system || !message) return NextResponse.json({ error: "Nothing to answer." }, { status: 400 });

  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-8)
    .map((t) => ({ role: t.role === "assistant" ? "assistant" : "user", content: String(t.text ?? "").slice(0, 2_000) }))
    .filter((t) => t.content);

  try {
    const res = await aiFetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        temperature: 0.2,
        messages: [{ role: "system", content: system }, ...history, { role: "user", content: message }],
      }),
      signal: AbortSignal.timeout(50_000),
    });
    if (res.status === 503) return NextResponse.json({ offline: true, error: "No AI provider is set up." }, { status: 503 });
    if (!res.ok) return NextResponse.json({ error: await describeFailure(res) }, { status: 502 });
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) return NextResponse.json({ error: "The model answered with nothing." }, { status: 502 });
    return NextResponse.json({ text });
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    return NextResponse.json({ error: timeout ? "The cloud model took too long." : "Couldn't reach the cloud model." }, { status: 504 });
  }
}
