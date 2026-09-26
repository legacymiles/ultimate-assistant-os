import { NextResponse } from "next/server";
import { aiEndpoint, aiFetch, DEFAULT_MODEL } from "@/lib/ai/provider";
import { catalogPrompt, cleanProposals, EXTRACT_SYSTEM } from "@/lib/jarvis/record/extract";

// Reads pictures and returns proposed record fields. Nothing is stored here —
// the record lives in the owner's browser, and only their yes writes to it.
export const runtime = "nodejs";
export const maxDuration = 120;

const IMAGE_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { images?: unknown; text?: unknown; hint?: unknown };

  const images = Array.isArray(body.images)
    ? body.images.filter((u): u is string => typeof u === "string" && u.length < 4_000_000 && IMAGE_URL.test(u)).slice(0, 4)
    : [];
  const text = typeof body.text === "string" ? body.text.slice(0, 20000) : "";
  const hint = typeof body.hint === "string" ? body.hint.slice(0, 200) : "";

  if (!images.length && !text.trim()) {
    return NextResponse.json({ error: "Nothing to read — attach a picture or paste some text." }, { status: 400 });
  }

  if (!aiEndpoint()) {
    return NextResponse.json(
      {
        error:
          "Reading a document needs an AI key. Set OPENROUTER_API_KEY and I'll read it — you can " +
          "still type anything into the record by hand in the meantime.",
      },
      { status: 503 },
    );
  }

  const parts: unknown[] = [
    {
      type: "text",
      text:
        `${hint ? `The person says this is: ${hint}\n\n` : ""}` +
        `Pull out every fact below that this document actually states.\n\n${catalogPrompt()}` +
        (text ? `\n\nTEXT THEY PASTED:\n${text}` : ""),
    },
    ...images.map((url) => ({ type: "image_url", image_url: { url } })),
  ];

  try {
    const res = await aiFetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 3000,
        messages: [
          { role: "system", content: EXTRACT_SYSTEM },
          { role: "user", content: parts },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `The model refused that (${res.status}).${detail ? ` ${detail.slice(0, 160)}` : ""}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    const raw = typeof content === "string" ? content : "";
    // Models wrap JSON in prose or a fence often enough that the brace scan is
    // cheaper than being strict and failing a perfectly good read.
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return NextResponse.json({ error: "I couldn't make sense of that document. Try a sharper picture?" }, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return NextResponse.json({ error: "I read it but the answer came back malformed. Try again?" }, { status: 502 });
    }

    return NextResponse.json(cleanProposals(parsed));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Reading that failed." }, { status: 500 });
  }
}
