import { NextResponse } from "next/server";

import { digestHtml } from "@/lib/ai-rankings/analyzeLink";
import { aiConfigured, aiFetch, describeFailure, DEFAULT_MODEL } from "@/lib/ai/provider";
import { coerceReadings, READINGS_SYSTEM, readingsUser } from "@/lib/mockup/edit";
import { callerIsMember } from "@/lib/recall/lists/session";
import { fetchText } from "@/lib/social-import/safeFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/mockup/readings { edit, siteName, url?, image? } → { lanes: [{label, instruction}] x3 } | { lanes: null }
//
// Three concrete readings of a website change, written by the hub's vision
// model looking at the screenshot Flux will paint onto (see edit.ts for why).
// `lanes: null` means "use the built-in readings" — no key, a model failure,
// or an answer that didn't check out. It never blocks the mockups.

const MAX_IMAGE = 1_600_000;

export async function POST(req: Request) {
  if (await callerIsMember()) {
    return NextResponse.json({ error: "Mockups are drawn for the owner only." }, { status: 403 });
  }
  let body: { edit?: unknown; siteName?: unknown; url?: unknown; image?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const edit = typeof body.edit === "string" ? body.edit.trim().slice(0, 1200) : "";
  if (!edit) return NextResponse.json({ error: "Say what to change." }, { status: 400 });
  if (!aiConfigured()) return NextResponse.json({ lanes: null, why: "no-model" });

  const siteName = typeof body.siteName === "string" ? body.siteName.slice(0, 80) : "";
  const url = typeof body.url === "string" && /^https?:\/\//.test(body.url) ? body.url.slice(0, 600) : "";
  const image =
    typeof body.image === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(body.image) && body.image.length <= MAX_IMAGE
      ? body.image
      : "";

  // What the page says, so the readings can quote it. safeFetch refuses
  // private addresses on every hop; a page that won't load just means the
  // model works from the screenshot alone.
  let pageText = "";
  if (url) {
    try {
      const html = await fetchText(url, 1_500_000);
      if (html) pageText = digestHtml(html, new URL(url)).text.slice(0, 2500);
    } catch {
      pageText = "";
    }
  }

  const user = readingsUser({ edit, siteName, url, pageText });
  const content = image
    ? [
        { type: "text", text: user },
        { type: "image_url", image_url: { url: image } },
      ]
    : user;

  try {
    const res = await aiFetch({
      method: "POST",
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.6,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: READINGS_SYSTEM },
          { role: "user", content },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      console.warn("[mockup] readings model failed:", await describeFailure(res));
      return NextResponse.json({ lanes: null, why: "model-failed" });
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const lanes = coerceReadings(parsed);
    return NextResponse.json(lanes ? { lanes } : { lanes: null, why: "bad-answer" });
  } catch (err) {
    console.warn("[mockup] readings failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ lanes: null, why: "model-failed" });
  }
}
