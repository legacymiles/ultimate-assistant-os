import { NextResponse } from "next/server";
import { aiEndpoint, aiFetch, describeFailure, DEFAULT_MODEL } from "@/lib/ai/provider";
import { callerIsMember } from "@/lib/recall/lists/session";
import { coerceRule, describeRule, parseWatchLocal, WATCH_EXAMPLES } from "@/lib/new-jarvis/watchRules";

// ---------------------------------------------------------------------------
// "Tell me when…" → one notification rule.
//
// The model only TRANSLATES: it picks one of five closed rule shapes and fills
// it in. The page shows the owner what it understood before anything is
// saved, and the rule runs in the browser against data already there — so a
// wrong guess costs one "no", never a surprise action.
//
// No key, or a model that answers badly: the keyword parser answers instead.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 20;

const SYSTEM = `You turn a person's request for a notification into ONE rule, as JSON.

Return exactly: {"title": "<3-6 word label>", "rule": <rule>} or {"error": "<one short sentence why it can't be a rule>"}.

<rule> is one of:
- {"kind":"schedule","time":"HH:MM" (24h),"days":[0-6] (0=Sunday; [] means every day),"message":"<what to remind them, imperative, short>"}
- {"kind":"match","source":"any"|"lists"|"calendar"|"photos"|"camera"|"memory"|"actions"|"spend","contains":["word",...]}  — fires when an update's text mentions any of the words
- {"kind":"due","listId":"todo"|"buy"|"bills"|"remember"|"projects"|null,"daysAhead":0-30}  — fires when a list item is due within that many days (0 = today only)
- {"kind":"spend","over":<dollars>}  — fires when today's AI spend passes that amount
- {"kind":"camera","atLeast":<n>}  — fires when at least n new photos are waiting in Camera Autopilot (1 = every new photo)

Pick the closest rule. "morning" = 08:00, "evening" = 18:00, "weekdays" = [1,2,3,4,5]. Only JSON, no prose.`;

export async function POST(req: Request) {
  if (await callerIsMember()) {
    return NextResponse.json({ error: "This part of Jarvis is not shared." }, { status: 403 });
  }
  let text = "";
  try {
    const body = (await req.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim().slice(0, 400) : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "Say what you want to be told about." }, { status: 400 });

  const local = () => {
    const p = parseWatchLocal(text);
    return p
      ? NextResponse.json({ ...p, summary: describeRule(p.rule), engine: "local" })
      : NextResponse.json(
          { error: `I couldn't turn that into a notification. Try something like: “${WATCH_EXAMPLES[0]}”.`, examples: WATCH_EXAMPLES },
          { status: 422 },
        );
  };

  if (!aiEndpoint()) return local();

  try {
    const res = await aiFetch({
      method: "POST",
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0,
        max_tokens: 300,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Today is ${new Date().toDateString()}. Request: ${text}` },
        ],
      }),
    });
    if (!res.ok) {
      console.error("[watch] model failed:", await describeFailure(res));
      return local();
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { title?: unknown; rule?: unknown; error?: unknown };
    const rule = coerceRule(json.rule);
    if (!rule) {
      // The model said no, or answered in a shape we don't run. The keyword
      // parser gets a turn before the owner is told no.
      const p = parseWatchLocal(text);
      if (p) return NextResponse.json({ ...p, summary: describeRule(p.rule), engine: "local" });
      return NextResponse.json(
        { error: typeof json.error === "string" ? json.error : "I couldn't turn that into a notification.", examples: WATCH_EXAMPLES },
        { status: 422 },
      );
    }
    const title = typeof json.title === "string" && json.title.trim() ? json.title.trim().slice(0, 60) : text.slice(0, 60);
    return NextResponse.json({ title, rule, summary: describeRule(rule), engine: "ai" });
  } catch (err) {
    console.error("[watch] failed:", err);
    return local();
  }
}
