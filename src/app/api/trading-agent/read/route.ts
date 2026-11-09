import { NextResponse } from "next/server";
import { aiConfigured, aiFetch } from "@/lib/ai/provider";
import { READ_MODEL, parseRead, readSystem, readUser } from "@/lib/trading-agent/prompt";
import { numbersFor, type Account, type Direction, type Setup } from "@/lib/trading-agent/setup";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_THESIS = 4000;

function parseSetup(body: unknown): { setup: Setup; account: Account } | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const entry = num(b.entry);
  const stop = num(b.stop);
  const target = num(b.target);
  if (![entry, stop, target].every(Number.isFinite)) return "Entry, stop and target all have to be numbers.";

  const thesis = str(b.thesis);
  if (thesis.length > MAX_THESIS) return `Keep the thesis under ${MAX_THESIS} characters.`;

  const size = num(b.size);
  const riskPct = num(b.riskPct);

  return {
    setup: {
      instrument: str(b.instrument).slice(0, 40),
      direction: (b.direction === "short" ? "short" : "long") as Direction,
      entry,
      stop,
      target,
      timeframe: str(b.timeframe).slice(0, 24),
      thesis,
    },
    account: {
      size: Number.isFinite(size) ? size : 10_000,
      riskPct: Number.isFinite(riskPct) ? riskPct : 1,
    },
  };
}

// POST /api/trading-agent/read
// Body: { instrument, direction, entry, stop, target, timeframe, thesis, size, riskPct }
// Returns: { read } | { offline: true } | { error }
//
// The ARITHMETIC is not computed here and is not sent back from here — the
// client has it already, from the same pure module this route imports, because
// the numbers must be identical on both sides and must not depend on a network
// call succeeding. What this route adds is the only part that needs a model:
// the argument with the reasoning.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = parseSetup(body);
  if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
  const { setup, account } = parsed;

  if (!setup.thesis) {
    return NextResponse.json(
      { error: "Write why you think this works — that is the part the agent reads." },
      { status: 400 },
    );
  }
  // A key that is not set degrades visibly rather than 500ing: the arithmetic
  // the owner came for is already on their screen.
  if (!aiConfigured()) return NextResponse.json({ offline: true });

  try {
    const res = await aiFetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.TRADING_AGENT_MODEL || READ_MODEL,
        messages: [
          { role: "system", content: readSystem() },
          { role: "user", content: readUser(setup, numbersFor(setup, account)) },
        ],
        temperature: 0.6,
        max_tokens: 1400,
      }),
      signal: AbortSignal.timeout(55_000),
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const read = parseRead(json.choices?.[0]?.message?.content ?? "");
    if (!read) throw new Error("the model did not answer in a shape this screen can show");
    return NextResponse.json({ read });
  } catch (err) {
    console.error("[trading-agent] read failed:", err);
    return NextResponse.json(
      { error: "The agent didn't answer. The arithmetic on the left is unaffected — it never needed one." },
      { status: 502 },
    );
  }
}
