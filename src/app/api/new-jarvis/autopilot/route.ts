import { NextResponse } from "next/server";
import { aiEndpoint, aiFetch, describeFailure, DEFAULT_MODEL } from "@/lib/ai/provider";
import { callerIsMember } from "@/lib/recall/lists/session";
import {
  localReply,
  parseReply,
  settleForFiled,
  systemPrompt,
  type AutopilotRequest,
} from "@/lib/new-jarvis/autopilotChat";

// ---------------------------------------------------------------------------
// One turn of the Camera Autopilot conversation on the Deck.
//
// Returns a reply and PROPOSED actions — never performs one. Photos live in the
// owner's browser (IndexedDB), so only the page could file them anyway; the
// page shows each action as a card and runs it on "Yes".
//
// No key: falls back to the keyword version rather than failing, per the
// repo's "apps work with no keys set" rule.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  if (await callerIsMember()) {
    return NextResponse.json({ error: "This part of Jarvis is not shared." }, { status: 403 });
  }

  let body: AutopilotRequest;
  try {
    const raw = (await req.json()) as Partial<AutopilotRequest>;
    body = {
      messages: Array.isArray(raw.messages) ? raw.messages.slice(-16) : [],
      photos: Array.isArray(raw.photos) ? raw.photos.slice(0, 80) : [],
      selectedId: typeof raw.selectedId === "string" ? raw.selectedId : null,
      rules: Array.isArray(raw.rules) ? raw.rules.filter((r) => typeof r === "string").slice(0, 30) : [],
      ownerName: typeof raw.ownerName === "string" ? raw.ownerName.slice(0, 60) : "",
    };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const ids = body.photos.map((p) => p.id);
  if (!aiEndpoint()) return NextResponse.json({ ...settleForFiled(localReply(body), body.photos), engine: "local" });

  try {
    const res = await aiFetch({
      method: "POST",
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.2,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt(body) },
          ...body.messages
            .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
            .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) })),
        ],
      }),
    });
    if (!res.ok) {
      const why = await describeFailure(res);
      console.error("[autopilot] model failed:", why);
      return NextResponse.json({ ...settleForFiled(localReply(body), body.photos), engine: "local", warning: why });
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ ...settleForFiled(parseReply(text, ids), body.photos), engine: "ai" });
  } catch (err) {
    console.error("[autopilot] failed:", err);
    return NextResponse.json({ ...settleForFiled(localReply(body), body.photos), engine: "local" });
  }
}
