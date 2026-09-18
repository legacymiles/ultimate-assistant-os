import { NextResponse } from "next/server";
import { aiEndpoint, DEFAULT_MODEL } from "@/lib/ai/provider";
import { coerceProfile } from "@/lib/new-dashboard/export";
import { coerceFocus, FOCUS_SYSTEM, focusPrompt, heuristicFocus } from "@/lib/new-dashboard/focus";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { profile?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const profile = coerceProfile(body.profile);
  if (!profile) return NextResponse.json({ error: "A profile with a name is required." }, { status: 400 });
  // coerceProfile regenerates ids and resets progress; keep what the focus
  // prompt actually reads from the original.
  const raw = body.profile as { prioritiesDone?: unknown };
  profile.prioritiesDone = Array.isArray(raw.prioritiesDone) ? raw.prioritiesDone.filter((n): n is number => typeof n === "number") : [];

  const endpoint = aiEndpoint();
  if (!endpoint) return NextResponse.json({ ...heuristicFocus(profile), warning: "No AI key set — answered from your priorities directly." });

  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${endpoint.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: FOCUS_SYSTEM },
          { role: "user", content: focusPrompt(profile) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`AI ${res.status}`);
    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "";
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const focus = coerceFocus(JSON.parse(json));
    if (!focus) throw new Error("Unusable AI answer");
    return NextResponse.json(focus);
  } catch (e) {
    return NextResponse.json({
      ...heuristicFocus(profile),
      warning: `AI unavailable (${e instanceof Error ? e.message : "error"}) — answered from your priorities directly.`,
    });
  }
}
