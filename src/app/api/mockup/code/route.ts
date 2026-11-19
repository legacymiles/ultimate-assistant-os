import { NextResponse } from "next/server";

import { aiConfigured, aiFetch, describeFailure, DEFAULT_MODEL } from "@/lib/ai/provider";
import { cleanMockupHtml, CODED_SYSTEM, codedUser, coerceCodedRequest } from "@/lib/mockup/coded";
import { callerIsMember } from "@/lib/recall/lists/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A full page of HTML is a long answer: give the model room.
export const maxDuration = 300;

// POST /api/mockup/code { request: CodedRequest, image? } → { html, by } | { html: "", why }
//
// The hub's own model writing one mockup lane as HTML and CSS (coded.ts). The
// bake-off asks Claude on the owner's plan first, through the PC helper, and
// comes here only when that can't answer — the PC is off, unpaired or out of
// plan. `html: ""` means "keep the instant layout drawing": no key, a model
// failure, or an answer with no document in it. It never blocks the board.

const MAX_IMAGE = 1_600_000;

export async function POST(req: Request) {
  if (await callerIsMember()) {
    return NextResponse.json({ error: "Mockups are made for the owner only." }, { status: 403 });
  }
  let body: { request?: unknown; image?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const request = coerceCodedRequest(body.request);
  if (!request) return NextResponse.json({ error: "Say what to mock up." }, { status: 400 });
  if (!aiConfigured()) return NextResponse.json({ html: "", why: "no-model" });

  const image =
    typeof body.image === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(body.image) && body.image.length <= MAX_IMAGE
      ? body.image
      : "";
  const user = codedUser(request);
  const content = image
    ? [
        { type: "text", text: `${user}\n\nA screenshot of the page as it is now is attached.` },
        { type: "image_url", image_url: { url: image } },
      ]
    : user;

  try {
    const res = await aiFetch({
      method: "POST",
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.5,
        max_tokens: 16_000,
        messages: [
          { role: "system", content: CODED_SYSTEM },
          { role: "user", content },
        ],
      }),
      signal: AbortSignal.timeout(280_000),
    });
    if (!res.ok) {
      console.warn("[mockup] code model failed:", await describeFailure(res));
      return NextResponse.json({ html: "", why: "model-failed" });
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const html = cleanMockupHtml(data.choices?.[0]?.message?.content ?? "");
    return NextResponse.json(html ? { html, by: "the hub's AI" } : { html: "", why: "bad-answer" });
  } catch (err) {
    console.warn("[mockup] code failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ html: "", why: "model-failed" });
  }
}
