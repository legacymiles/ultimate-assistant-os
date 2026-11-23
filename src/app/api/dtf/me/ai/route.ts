// ---------------------------------------------------------------------------
// POST /api/dtf/me/ai — one AI designer turn.
//
// Body: { project, message, history?, referenceAssetIds?, readiness?, selectedLayerId? }
// Reply: AiReply — proposals of DesignOps the browser shows and, on Approve,
// applies with the editor's own reducer. Nothing here edits a project.
//
// Live model when a provider is configured (vision when reference pictures
// are attached); the built-in planner otherwise, or when the model fails or
// answers with something unreadable — always with a one-line note saying why.
// Every reply, live or offline, goes through schema.ts so ops only ever touch
// real, unlocked layers with sane numbers.
// ---------------------------------------------------------------------------

import { aiConfigured, aiFetch, DEFAULT_MODEL, describeFailure } from "@/lib/ai/provider";
import { describeProject } from "@/lib/dtf/ai/context";
import { offlineReply } from "@/lib/dtf/ai/offline";
import { SYSTEM_PROMPT } from "@/lib/dtf/ai/prompt";
import { DesignProjectInputSchema, extractJson, parseAiReply, parseReadiness } from "@/lib/dtf/ai/schema";
import { errorResponse, HttpError, requireUser } from "@/lib/dtf/server/access";
import { assetBytes, bumpAiUsage, getAsset } from "@/lib/dtf/server/store";
import type { AiReply, AssetKind, DesignProject } from "@/lib/dtf/types";

export const dynamic = "force-dynamic";
// Three proposals plus an original SVG from a large model can take 60-120 s.
export const maxDuration = 180;

const MAX_BODY_BYTES = 1.5 * 1024 * 1024;
const DAILY_TURNS = 60;
const MAX_REFS = 4;
const MAX_REF_BYTES = 4 * 1024 * 1024;
const REF_KINDS: AssetKind[] = ["original", "reference", "ai", "processed"];
/** Formats vision models actually read. SVG is text to them, not a picture. */
const VISION_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

interface Turn {
  role: "user" | "assistant";
  content: string;
}

function readHistory(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is { role: unknown; content: unknown } => !!t && typeof t === "object")
    .map((t) => ({ role: t.role, content: t.content }))
    .filter((t): t is Turn => (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim() !== "")
    .slice(-10)
    .map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }));
}

/** Reference pictures the caller owns, as data URLs; plus notes for any skipped. */
async function loadReferences(ids: unknown, userId: string): Promise<{ images: { url: string; name: string }[]; notes: string[] }> {
  const images: { url: string; name: string }[] = [];
  const notes: string[] = [];
  if (!Array.isArray(ids)) return { images, notes };
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length < 200))];
  if (wanted.length > MAX_REFS) notes.push(`Only the first ${MAX_REFS} reference pictures were used.`);
  let unreadable = 0;
  for (const id of wanted.slice(0, MAX_REFS)) {
    const asset = await getAsset(id).catch(() => null);
    // Never read someone else's upload, and never say whether it exists.
    if (!asset || asset.userId !== userId || !REF_KINDS.includes(asset.kind)) {
      unreadable++;
      continue;
    }
    if (!VISION_MIMES.has(asset.mime)) {
      notes.push(`"${asset.name ?? "A reference"}" is ${asset.mime === "image/svg+xml" ? "an SVG" : "a file type"} the designer can't look at — use a PNG, JPG or WebP.`);
      continue;
    }
    if (asset.bytes > MAX_REF_BYTES) {
      notes.push(`"${asset.name ?? "A reference"}" is over 4 MB, so the designer skipped it — a smaller copy works just as well for style.`);
      continue;
    }
    const bytes = await assetBytes(asset).catch(() => null);
    if (!bytes) {
      unreadable++;
      continue;
    }
    if (bytes.length > MAX_REF_BYTES) {
      notes.push(`"${asset.name ?? "A reference"}" is over 4 MB, so the designer skipped it.`);
      continue;
    }
    images.push({ url: `data:${asset.mime};base64,${bytes.toString("base64")}`, name: asset.name ?? `reference ${images.length + 1}` });
  }
  if (unreadable) notes.push(`${unreadable} reference picture${unreadable === 1 ? "" : "s"} couldn't be read.`);
  return { images, notes };
}

/** The model's text, whether content came back as a string or as parts. */
function replyText(data: unknown): string {
  const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("");
  }
  return "";
}

function withNotes(reply: AiReply, extra: string[]): AiReply {
  const notes = [...extra, ...(reply.notes ?? [])].slice(0, 8);
  return notes.length ? { ...reply, notes } : reply;
}

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await requireUser();

    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) throw new HttpError(413, "That request is too big — remove a few layers' embedded images and try again.");
    const text = await req.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new HttpError(413, "That request is too big — remove a few layers' embedded images and try again.");

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "The request wasn't valid JSON.");
    }

    const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
    if (!message) throw new HttpError(400, "Tell the designer what you'd like to change.");
    const projectParse = DesignProjectInputSchema.safeParse(body.project);
    if (!projectParse.success) throw new HttpError(400, "The design couldn't be read — reload the editor and try again.");
    const project: DesignProject = projectParse.data;
    const readiness = parseReadiness(body.readiness);
    const selectedLayerId = typeof body.selectedLayerId === "string" && project.layers.some((l) => l.id === body.selectedLayerId) ? body.selectedLayerId : undefined;
    const history = readHistory(body.history);

    // No provider: the built-in designer answers. It costs nothing, so it is not counted.
    if (!aiConfigured()) {
      return Response.json(withNotes(offlineReply(project, message, { selectedLayerId }), ["No live AI is configured on this shop, so the built-in designer answered."]));
    }

    if (!user.owner) {
      const day = new Date().toISOString().slice(0, 10);
      const used = await bumpAiUsage(user.id, day);
      if (used > DAILY_TURNS) {
        throw new HttpError(
          429,
          `You've used today's ${DAILY_TURNS} AI designer turns — they reset at midnight UTC. Every editing tool still works, and your design is saved.`,
        );
      }
    }

    const refs = await loadReferences(body.referenceAssetIds, user.id);
    const context = describeProject(project, readiness);
    const selected = selectedLayerId ? `\nSELECTED LAYER ("this"/"it"): ${selectedLayerId}` : "\nSELECTED LAYER: none";
    const prompt =
      `CURRENT PROJECT\n${context}${selected}\n` +
      (refs.images.length ? `\nREFERENCE PICTURES ATTACHED: ${refs.images.length} (below). Name their style, then recreate the style originally.\n` : "") +
      `\nCUSTOMER SAYS:\n${message}\n\nRespond with the JSON object only.`;

    const userContent: unknown = refs.images.length
      ? [
          { type: "text", text: prompt },
          ...refs.images.flatMap((img, i) => [
            { type: "text", text: `Reference ${i + 1}: ${JSON.stringify(img.name.slice(0, 80))}` },
            { type: "image_url", image_url: { url: img.url } },
          ]),
        ]
      : prompt;

    const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...history, { role: "user", content: userContent }];

    let fallbackWhy: string;
    try {
      const res = await aiFetch({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // The sentinel, not a destination: provider.ts routes it to the model
          // the owner picked (a vision-capable one when pictures are attached).
          model: process.env.AI_MODEL || DEFAULT_MODEL,
          task: { app: "dtf-studio", difficulty: "harder" },
          temperature: 0.5,
          // Tight on purpose: a designer that answers in under a minute is used;
          // one that writes three illustrations and times out is not.
          max_tokens: 3500,
          messages,
        }),
        signal: AbortSignal.timeout(170_000),
      });
      if (res.ok) {
        const json = extractJson(replyText(await res.json()));
        if (json) return Response.json(withNotes(parseAiReply(json, project), refs.notes));
        fallbackWhy = "The live AI's answer couldn't be read, so the built-in designer answered instead.";
      } else {
        const why = await describeFailure(res);
        console.warn("[dtf/ai] provider failed:", why);
        fallbackWhy =
          res.status === 503
            ? "The live AI isn't set up, so the built-in designer answered."
            : /credit|402/i.test(why)
              ? "The shop's live AI has run out of credit, so the built-in designer answered instead."
              : "The live AI couldn't be reached, so the built-in designer answered instead.";
      }
    } catch (err) {
      console.warn("[dtf/ai] provider error:", err instanceof Error ? err.message : err);
      fallbackWhy = ["TimeoutError", "AbortError"].includes((err as Error)?.name ?? "") ? "The live AI took too long, so the built-in designer answered instead." : "The live AI couldn't be reached, so the built-in designer answered instead.";
    }
    return Response.json(withNotes(offlineReply(project, message, { selectedLayerId }), [fallbackWhy, ...refs.notes]));
  } catch (err) {
    return errorResponse(err);
  }
}
