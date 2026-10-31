import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiFetch, aiKey } from "@/lib/ai/provider";
import { PACKS } from "@/lib/profile/packs";
import type { Draft } from "@/lib/profile/types";

// POST /api/profile/extract
//   JSON      { text: string }                  — a sentence, or pasted content
//   multipart { file: File }                    — resume, bill, offer, AI chat export
//
// Returns drafts for the Profile tree. This is the route that makes onboarding
// INGESTION rather than interrogation: the owner drops what they already have
// and the AI proposes the folders, instead of answering a form.
//
// Everything it returns lands in the tree unconfirmed (see `applyDrafts`), so a
// wrong guess here costs the owner one click, never a corrupted profile.
//
// Always 200 with a `status`: a missing key must degrade to "read it yourself"
// rather than failing the upload, same rule as the rest of the hub.

export const runtime = "nodejs";
export const maxDuration = 60;

/** Enough for a resume or a bill; a chat export is reduced before it gets here. */
const MAX_INPUT = 60_000;

type Status = "ok" | "no-key" | "unsupported" | "failed";

function done(drafts: Draft[], status: Status, questions: string[] = [], note = "") {
  return NextResponse.json({ drafts, status, questions, note });
}

export async function POST(req: Request) {
  let text = "";
  let filename = "";

  try {
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await req.formData();
      const f = form.get("file");
      if (!(f instanceof File)) return done([], "failed", [], "No file in the form.");
      filename = f.name;
      text = await readFile(f);
    } else {
      const body = (await req.json()) as { text?: string; filename?: string };
      text = String(body.text ?? "");
      filename = String(body.filename ?? "");
    }
  } catch {
    return done([], "failed", [], "Could not read the request.");
  }

  text = text.trim();
  if (!text) return done([], "unsupported", [], "Nothing readable in that.");

  const key = aiKey();
  if (!key) {
    return done([], "no-key", [], "No AI key set, so nothing was read. Add one in the hub's AI panel, or type the facts in yourself.");
  }

  try {
    const parsed = await ask(text.slice(0, MAX_INPUT), filename);
    return done(parsed.drafts, "ok", parsed.questions);
  } catch (err) {
    console.error("Profile extract failed:", err);
    return done([], "failed", [], "The model could not read that. Try a smaller file, or type the facts in.");
  }
}

// ---------------------------------------------------------------------------
// Reading files
// ---------------------------------------------------------------------------

async function readFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    const pdf = (await import("pdf-parse")).default;
    const { text } = await pdf(Buffer.from(await file.arrayBuffer()));
    return normalize(text);
  }
  if (name.endsWith(".docx")) {
    const mammoth = (await import("mammoth")).default;
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) });
    return normalize(value);
  }
  if (name.endsWith(".json")) return chatExport(await file.text());
  return normalize(await file.text());
}

function normalize(s: string): string {
  return s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Reduce a ChatGPT/Claude data export to the owner's OWN words.
 *
 * The video's whole onboarding trick is that a chat history already contains
 * every fact the owner has ever explained. But an export is tens of megabytes
 * and most of it is the assistant talking — and feeding assistant text back in
 * is how a profile ends up describing the owner in LLM clichés. So: user turns
 * only, longest first (a long turn is where people explain themselves), capped.
 */
function chatExport(raw: string): string {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return normalize(raw);
  }

  const said: string[] = [];
  const visit = (v: unknown) => {
    if (said.join("\n").length > MAX_INPUT * 2) return;
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;

    const role =
      typeof o.role === "string" ? o.role
      : typeof (o.author as Record<string, unknown>)?.role === "string" ? String((o.author as Record<string, unknown>).role)
      : typeof o.sender === "string" ? o.sender
      : "";

    if (/^(user|human)$/i.test(role)) {
      const content = o.content ?? o.text ?? o.message;
      const flat =
        typeof content === "string" ? content
        : Array.isArray(content) ? content.map((c) => (typeof c === "string" ? c : String((c as Record<string, unknown>)?.text ?? ""))).join(" ")
        : typeof (content as Record<string, unknown>)?.parts !== "undefined" ? (((content as Record<string, unknown>).parts as unknown[]) ?? []).map(String).join(" ")
        : "";
      const t = flat.trim();
      if (t.length > 40) said.push(t);
    }
    Object.values(o).forEach(visit);
  };
  visit(data);

  if (!said.length) return normalize(raw).slice(0, MAX_INPUT);
  return said
    .sort((a, b) => b.length - a.length)
    .slice(0, 160)
    .join("\n\n---\n\n")
    .slice(0, MAX_INPUT);
}

// ---------------------------------------------------------------------------
// The model call
// ---------------------------------------------------------------------------

/** The packs, as the prompt sees them: id, the fields it owns, and the cues that imply it. */
function packMenu(): string {
  return PACKS.map(
    (p) => `${p.id} (${p.label}) — fields: ${p.fields.map((f) => `${f.label}:${f.kind}`).join(", ")}`,
  ).join("\n");
}

const SYSTEM = `You read one document or sentence belonging to a person and turn it into folders for their personal profile.

Reply with JSON only: {"drafts":[{"path":["Work","Acme"],"pack":"job","fields":[{"label":"Title","kind":"text","value":"Operator"}],"notes":""}],"questions":["..."]}

Rules:
- "path" is where the folder belongs. Start with one of these roots and nothing else: Me, People, Money, Work, Business, Home, Legal & Docs.
  People go under ["People","Friends & Family",<their name>]. A job goes under ["Work",<employer>]. A business goes under ["Business",<business name>].
  Things belonging to a business nest inside it, e.g. ["Business","Honey DTF","Equipment","DTF printer"].
- "pack" must be one of the ids listed below, or "" for a plain folder. Use the pack whose fields fit the thing.
- Only use field labels from the chosen pack, unless the document states something no pack field covers — then add your own label.
- Put every value in the owner's own words. Copy numbers, dates and names EXACTLY. Dates as YYYY-MM-DD when you can.
- Credentials (passwords, card numbers, door codes, ID numbers, routing numbers) DO go in, with kind "secret". They are stored in a vault and never shown to a model again.
- Never invent a value. If the document implies a fact but does not state it, leave the field out and put a short question in "questions" instead.
- If two parts of the document disagree, take neither: ask about it in "questions", quoting both.
- Never write marketing language, summaries of yourself, or anything the document does not say.

Packs:
${packMenu()}`;

async function ask(text: string, filename: string): Promise<{ drafts: Draft[]; questions: string[] }> {
  const res = await aiFetch({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `${filename ? `File: ${filename}\n\n` : ""}${text}` },
      ],
    }),
    signal: AbortSignal.timeout(50_000),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const raw = String(data?.choices?.[0]?.message?.content ?? "{}");
  const parsed = JSON.parse(raw) as { drafts?: unknown; questions?: unknown };

  return {
    drafts: coerceDrafts(parsed.drafts),
    questions: Array.isArray(parsed.questions) ? parsed.questions.map(String).slice(0, 12) : [],
  };
}

const PACK_IDS = new Set(PACKS.map((p) => p.id));
const ROOTS = new Set(["Me", "People", "Money", "Work", "Business", "Home", "Legal & Docs"]);
const KINDS = new Set(["text", "multiline", "date", "money", "url", "email", "phone", "address", "secret"]);

/**
 * Trust nothing the model returned.
 *
 * A path that does not start at a real root would create an eighth root tile
 * nobody asked for, and a pack id that does not exist would produce a typed
 * folder with no type — both are silent corruption of the owner's tree, so both
 * are dropped here rather than defended against in the UI.
 */
function coerceDrafts(v: unknown): Draft[] {
  if (!Array.isArray(v)) return [];
  const out: Draft[] = [];
  for (const d of v.slice(0, 40)) {
    if (!d || typeof d !== "object") continue;
    const o = d as Record<string, unknown>;
    const path = Array.isArray(o.path) ? o.path.map((s) => String(s).trim()).filter(Boolean).slice(0, 5) : [];
    if (!path.length || !ROOTS.has(path[0])) continue;

    const pack = PACK_IDS.has(String(o.pack)) ? String(o.pack) : "";
    const fields = (Array.isArray(o.fields) ? o.fields : [])
      .map((f) => {
        const g = (f ?? {}) as Record<string, unknown>;
        const kind = String(g.kind ?? "text");
        return {
          label: String(g.label ?? "").trim().slice(0, 60),
          kind: (KINDS.has(kind) ? kind : "text") as Draft["fields"][number]["kind"],
          value: String(g.value ?? "").trim().slice(0, 2_000),
        };
      })
      .filter((f) => f.label && f.value)
      .slice(0, 30);

    if (!fields.length && !String(o.notes ?? "").trim()) continue;
    out.push({ path, pack, fields, notes: String(o.notes ?? "").trim().slice(0, 2_000) });
  }
  return out;
}
