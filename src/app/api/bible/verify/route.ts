import { NextResponse } from "next/server";
import { aiFetch, aiKey } from "@/lib/ai/provider";
import { uid } from "@/lib/bible/ids";
import { VERIFY_SYSTEM } from "@/lib/bible/prompts";
import type { Finding } from "@/lib/bible/verify";
import type { HomeBase, Plan } from "@/lib/bible/types";

export const runtime = "nodejs";
// A web-reading model is slower than a chat one, and this reads several pages.
export const maxDuration = 180;

/** A search model, not the hub's general model: this call has to read the web. */
const SEARCH_MODEL = process.env.BIBLE_VERIFY_MODEL || "perplexity/sonar";

/** The shopping list: what to price, and which step and material it belongs to. */
function shoppingList(plan: Plan): string {
  const lines: string[] = [];
  for (const phase of plan.phases) {
    for (const step of phase.steps) {
      if (step.skipped) continue;
      for (const material of step.materials) {
        if (material.provenance === "user") continue; // his price stands
        lines.push(
          `stepId=${step.id} materialId=${material.id} — ${material.qty} ${material.unit} of ${material.name}`,
        );
      }
      // A step with a cost but no itemised materials is still worth pricing:
      // a saw rental, a market table, a cutting fee.
      if (!step.materials.length && step.cost && step.provenance !== "user") {
        lines.push(`stepId=${step.id} — ${step.title}: ${step.detail}`.slice(0, 300));
      }
    }
  }
  return lines.slice(0, 40).join("\n");
}

function cleanFindings(value: unknown): Finding[] {
  if (!Array.isArray(value)) return [];
  const out: Finding[] = [];
  for (const entry of value.slice(0, 60)) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, any>;
    const stepId = typeof raw.stepId === "string" ? raw.stepId : "";
    const s = raw.supplier;
    if (!stepId || !s || typeof s !== "object" || typeof s.name !== "string") continue;
    // A price with no source is exactly what the prompt forbids, so it is
    // dropped here rather than shown to the owner as if it were checked.
    const source = typeof s.source === "string" ? s.source.slice(0, 400) : "";
    if (!source) continue;
    const price = s.price && typeof s.price === "object"
      && typeof s.price.low === "number" && typeof s.price.high === "number"
      ? {
          low: Math.min(s.price.low, s.price.high),
          high: Math.max(s.price.low, s.price.high),
          currency: typeof s.price.currency === "string" ? s.price.currency.toUpperCase().slice(0, 3) : "USD",
        }
      : undefined;
    out.push({
      stepId,
      materialId: typeof raw.materialId === "string" && raw.materialId ? raw.materialId : undefined,
      supplier: {
        id: uid("sup"),
        name: s.name.slice(0, 120),
        what: typeof s.what === "string" ? s.what.slice(0, 120) : "",
        where: typeof s.where === "string" ? s.where.slice(0, 200) : undefined,
        phone: typeof s.phone === "string" ? s.phone.slice(0, 40) : undefined,
        url: typeof s.url === "string" ? s.url.slice(0, 400) : undefined,
        price,
        source,
      },
    });
  }
  return out;
}

// POST /api/bible/verify
// Body: { plan, homeBase }
// Returns { findings } for the client to merge with mergeVerified().
export async function POST(req: Request) {
  let body: { plan?: Plan; homeBase?: HomeBase | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const plan = body.plan;
  if (!plan?.phases?.length) {
    return NextResponse.json({ error: "Nothing to price yet" }, { status: 400 });
  }
  if (!aiKey()) {
    return NextResponse.json(
      { error: "No AI provider is configured, so prices cannot be checked. Set OPENROUTER_API_KEY in .env.local." },
      { status: 503 },
    );
  }

  const list = shoppingList(plan);
  if (!list) {
    return NextResponse.json({ error: "Every price here is already yours or already checked" }, { status: 400 });
  }

  const where = body.homeBase
    ? `${body.homeBase.city}, ${body.homeBase.region}, ${body.homeBase.country} (currency ${body.homeBase.currency})`
    : "no location given — use suppliers that ship, and say so";

  try {
    const res = await aiFetch({
      method: "POST",
      body: JSON.stringify({
        model: SEARCH_MODEL,
        temperature: 0.1,
        messages: [
          { role: "system", content: VERIFY_SYSTEM },
          { role: "user", content: `Buying near: ${where}\n\nPrice these, keeping the stepId and materialId on each answer:\n${list}` },
        ],
      }),
      signal: AbortSignal.timeout(170_000),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("bible/verify provider refused:", res.status, detail.slice(0, 400));
      return NextResponse.json({ error: `The search model refused this (${res.status}).` }, { status: 502 });
    }

    const json = await res.json();
    const content: string = json?.choices?.[0]?.message?.content ?? "{}";
    // A search model answers in prose more often than a chat one, so the JSON
    // is dug out rather than assumed to be the whole body.
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    const parsed = start === -1 || end === -1 ? {} : JSON.parse(content.slice(start, end + 1));
    const findings = cleanFindings(parsed?.findings);
    if (!findings.length) {
      return NextResponse.json(
        { error: "Nothing came back with a source attached, so nothing was changed. The estimates stand." },
        { status: 502 },
      );
    }
    return NextResponse.json({ findings });
  } catch (err) {
    console.error("bible/verify failed:", err);
    return NextResponse.json({ error: "The price check took too long. The estimates stand." }, { status: 502 });
  }
}
