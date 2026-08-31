import { NextResponse } from "next/server";
import { callerIsMember } from "@/lib/recall/lists/session";

// POST /api/recall/extract  (multipart form: file, category)
// Reads text OUT of an uploaded file so Recall can retrieve on its contents
// rather than just its filename — the part that makes this a real RAG.
//
//   pdf   → pdf-parse
//   doc   → mammoth (.docx) or raw text
//   image → a vision model via the AI Gateway, when a key is set
//   video → never read; the client does not even send these
//
// Always returns 200 with a status so a failed read degrades to "stored but not
// read" instead of failing the upload.

export const runtime = "nodejs";
export const maxDuration = 60;

const GATEWAY = "https://ai-gateway.vercel.sh/v1/chat/completions";
/** Plenty for retrieval; keeps localStorage sane. */
const MAX_TEXT = 40_000;

type Status = "ok" | "unsupported" | "failed";

function done(text: string, status: Status) {
  return NextResponse.json({ text: text.slice(0, MAX_TEXT), status });
}

/**
 * Family members get the Lists board and nothing else, so the RAG side refuses
 * them here rather than only hiding the UI.
 */
async function memberBlocked(): Promise<NextResponse | null> {
  return (await callerIsMember())
    ? NextResponse.json({ error: "This part of Recall is not shared." }, { status: 403 })
    : null;
}

export async function POST(req: Request) {
  const blocked = await memberBlocked();
  if (blocked) return blocked;

  let file: File | null = null;
  let category = "file";
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
    category = String(form.get("category") ?? "file");
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

  if (category === "video") return done("", "unsupported");

  const name = file.name.toLowerCase();

  try {
    if (category === "pdf" || name.endsWith(".pdf")) {
      return done(await readPdf(file), "ok");
    }

    if (name.endsWith(".docx")) {
      const mammoth = (await import("mammoth")).default;
      const { value } = await mammoth.extractRawText({
        buffer: Buffer.from(await file.arrayBuffer()),
      });
      return done(normalize(value), "ok");
    }

    if (category === "image") {
      const apiKey = process.env.AI_GATEWAY_API_KEY;
      // No key: the file is still stored and searchable by name — just not read.
      if (!apiKey) return done("", "unsupported");
      return done(await describeImage(file, apiKey), "ok");
    }

    // Anything else that is plausibly text.
    const text = normalize(await file.text());
    return text ? done(text, "ok") : done("", "unsupported");
  } catch (err) {
    console.error("Recall extract failed:", err);
    return done("", "failed");
  }
}

function normalize(s: string): string {
  return s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function readPdf(file: File): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const result = await parser.getText();
    return normalize(result.text ?? "");
  } finally {
    await parser.destroy?.();
  }
}

/**
 * Describe an image well enough to retrieve it later: what it shows, and any
 * text visible in it (screenshots of dashboards, error messages, receipts).
 */
async function describeImage(file: File, apiKey: string): Promise<string> {
  const model = process.env.AI_VISION_MODEL || process.env.AI_MODEL || "anthropic/claude-sonnet-4-6";
  const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const dataUrl = `data:${file.type || "image/jpeg"};base64,${b64}`;

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You index images for a personal knowledge base. Describe what the image " +
            "shows in 1–3 sentences, then transcribe ALL legible text in it verbatim " +
            "under a 'Text:' heading. Be factual and specific — names, numbers, labels, " +
            "error messages. No preamble.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Filename: ${file.name}` },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return normalize(String(data?.choices?.[0]?.message?.content ?? ""));
}
