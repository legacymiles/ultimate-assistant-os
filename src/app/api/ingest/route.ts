import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiKey, aiUrl } from "@/lib/ai/provider";
import type { KnowledgeKind } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_TEXT = 16000; // chars sent to the model / kept

interface IngestResult {
  title: string;
  summary: string;
  kind: KnowledgeKind;
  isImage: boolean;
  charCount: number;
  engine: "ai" | "heuristic";
}

// POST /api/ingest  (multipart form-data, field "file")
// Reads a PDF / Word doc / text file / image and returns an AI (or heuristic)
// summary suitable for a Knowledge Inbox entry.
export async function POST(req: Request) {
  let file: File | null = null;
  try {
    const form = await req.formData();
    file = form.get("file") as File | null;
  } catch {
    return NextResponse.json({ error: "Expected multipart form-data" }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.size > MAX_BYTES)
    return NextResponse.json({ error: "File too large (max 25 MB)" }, { status: 413 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name || "upload";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const mime = file.type || "";
  const title = name.replace(/\.[^.]+$/, "");
  const isImage = mime.startsWith("image/") || IMAGE_EXTS.has(ext);

  const apiKey = aiKey();

  // ---- Images: vision model (or placeholder) ------------------------------
  if (isImage) {
    if (apiKey) {
      try {
        const summary = await summarizeImage(buffer, mime || `image/${ext}`, name, apiKey);
        return ok({ title, summary, kind: "documentation", isImage: true, charCount: 0, engine: "ai" });
      } catch (e) {
        console.error("Image ingest failed:", e);
      }
    }
    return ok({
      title,
      summary:
        `🖼️ Image "${name}" attached.\n\n` +
        "Set AI_GATEWAY_API_KEY to have the AI read the image (OCR + description) and summarise it automatically.",
      kind: "documentation",
      isImage: true,
      charCount: 0,
      engine: "heuristic",
    });
  }

  // ---- Text-extractable documents -----------------------------------------
  let text = "";
  try {
    text = await extractText(buffer, ext, mime);
  } catch (e) {
    console.error("Extraction failed:", e);
  }

  const clean = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) {
    return ok({
      title,
      summary: `📎 "${name}" attached. No readable text could be extracted from this file type.`,
      kind: inferKind(ext),
      isImage: false,
      charCount: 0,
      engine: "heuristic",
    });
  }

  const truncated = clean.slice(0, MAX_TEXT);
  if (apiKey) {
    try {
      const summary = await summarizeText(truncated, name, apiKey);
      return ok({ title, summary, kind: inferKind(ext), isImage: false, charCount: clean.length, engine: "ai" });
    } catch (e) {
      console.error("AI summary failed, using heuristic:", e);
    }
  }
  return ok({
    title,
    summary: heuristicSummary(truncated),
    kind: inferKind(ext),
    isImage: false,
    charCount: clean.length,
    engine: "heuristic",
  });
}

function ok(r: IngestResult) {
  return NextResponse.json(r);
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);

function inferKind(ext: string): KnowledgeKind {
  if (["txt", "md", "rtf"].includes(ext)) return "note";
  return "documentation";
}

// ---- Extraction -----------------------------------------------------------
async function extractText(buffer: Buffer, ext: string, mime: string): Promise<string> {
  if (ext === "pdf" || mime === "application/pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    return result.text ?? "";
  }
  if (ext === "docx" || mime.includes("officedocument.wordprocessingml")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? "";
  }
  // Plain-text family (txt, md, csv, json, code, html, etc.)
  return buffer.toString("utf-8");
}

// ---- AI summarisation -----------------------------------------------------
const GATEWAY = aiUrl();

async function summarizeText(text: string, name: string, apiKey: string): Promise<string> {
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You summarise documents for a project knowledge base. Produce a clear, " +
            "skimmable summary: a one-sentence gist, then concise bullet points capturing " +
            "key facts, decisions, requirements, features, numbers and action items. " +
            "Be faithful; do not invent. Use plain text, no preamble.",
        },
        { role: "user", content: `Document: "${name}"\n\n${text}` },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return String(json?.choices?.[0]?.message?.content ?? "").trim();
}

async function summarizeImage(
  buffer: Buffer,
  mime: string,
  name: string,
  apiKey: string,
): Promise<string> {
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You analyse images for a project knowledge base. Describe what the image " +
            "shows and transcribe any visible text (OCR). Then give a short summary of " +
            "what is relevant for the project. Plain text, no preamble.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Image filename: "${name}". Read and summarise it.` },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return String(json?.choices?.[0]?.message?.content ?? "").trim();
}

// ---- Heuristic fallback ---------------------------------------------------
function heuristicSummary(text: string): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  const lead = sentences.slice(0, 5);

  // Crude keyword frequency for a "key topics" line.
  const freq = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? []) {
    if (STOP.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const topics = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);

  const parts: string[] = ["Auto-summary (no AI key configured):", ""];
  if (lead.length) parts.push(lead.map((s) => `• ${s}`).join("\n"));
  else parts.push(text.slice(0, 600));
  if (topics.length) parts.push("", `Key topics: ${topics.join(", ")}.`);
  return parts.join("\n");
}

const STOP = new Set([
  "this", "that", "with", "from", "have", "will", "would", "there", "their",
  "which", "about", "into", "your", "they", "them", "then", "than", "what",
  "when", "where", "been", "were", "also", "such", "only", "more", "most",
  "some", "these", "those", "other", "between", "should", "could", "page",
]);
