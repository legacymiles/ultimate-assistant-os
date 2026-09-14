import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiConfigured, aiKey, aiUrl } from "@/lib/ai/provider";
import { MAX_PROMPT, MAX_UPLOADS, clampCutCount, clampTotal } from "@/lib/smart-shot/constants";
import { heuristicPlan } from "@/lib/smart-shot/plan/heuristic";
import { plannerSystem, plannerUser } from "@/lib/smart-shot/plan/prompt";
import { normalisePlan, readJson } from "@/lib/smart-shot/plan/schema";
import type { AspectRatio, Brief, LookId, Quality, Upload, UploadRole } from "@/lib/smart-shot/types";
import { uid } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/smart-shot/plan
// Body: { brief, uploads: [{ id, role, name, dataUrl, description }] }
// Returns: { plan, engine: "ai" | "heuristic", warning? }
//
// The planner sees the uploads (vision) so a character built from a photo is
// described as that photo, not a guess. The heuristic planner is the fallback
// for a missing key or a bad answer — the app never fails to make a sheet.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = parse(body);
  if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
  const { brief, uploads } = parsed;

  if (!aiConfigured()) {
    return NextResponse.json({ plan: heuristicPlan(brief, uploads, uid), engine: "heuristic", warning: "No AI key configured — the sheet was planned locally." });
  }

  try {
    const model = process.env.SMART_SHOT_MODEL || process.env.AI_MODEL || DEFAULT_MODEL;
    const content: ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] = [
      { type: "text", text: plannerUser(brief, uploads) },
      ...uploads.map((u) => ({ type: "image_url" as const, image_url: { url: u.dataUrl } })),
    ];
    const res = await fetch(aiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiKey()}` },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        max_tokens: 6000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: plannerSystem() },
          { role: "user", content },
        ],
      }),
      signal: AbortSignal.timeout(110_000),
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content ?? "");
    const plan = normalisePlan(readJson(text), { brief, uploads, id: uid });
    return NextResponse.json({ plan, engine: "ai" });
  } catch (err) {
    console.error("[smart-shot] plan failed, using heuristic:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      plan: heuristicPlan(brief, uploads, uid),
      engine: "heuristic",
      warning: `The planner model failed (${message.slice(0, 120)}); the sheet was planned locally.`,
    });
  }
}

const ROLES: UploadRole[] = ["character", "location", "object", "style"];
const LOOKS: LookId[] = ["live-action", "anime", "3d-animation", "commercial", "documentary"];
const ASPECTS: AspectRatio[] = ["16:9", "9:16", "1:1"];

function parse(body: Record<string, unknown>): { brief: Brief; uploads: Upload[] } | string {
  const b = (body.brief ?? {}) as Record<string, unknown>;
  const prompt = typeof b.prompt === "string" ? b.prompt.trim() : "";
  if (!prompt) return "Write what the video is about first.";
  if (prompt.length > MAX_PROMPT) return `Keep the brief under ${MAX_PROMPT} characters.`;
  const brief: Brief = {
    prompt,
    cutCount: clampCutCount(b.cutCount),
    totalSec: clampTotal(b.totalSec),
    aspectRatio: ASPECTS.includes(b.aspectRatio as AspectRatio) ? (b.aspectRatio as AspectRatio) : "16:9",
    look: LOOKS.includes(b.look as LookId) ? (b.look as LookId) : "live-action",
    quality: b.quality === "high" ? ("high" as Quality) : ("medium" as Quality),
  };
  const raw = Array.isArray(body.uploads) ? body.uploads : [];
  if (raw.length > MAX_UPLOADS) return `Use at most ${MAX_UPLOADS} images.`;
  const uploads: Upload[] = [];
  for (const u of raw as Record<string, unknown>[]) {
    const dataUrl = typeof u?.dataUrl === "string" ? u.dataUrl : "";
    if (!dataUrl.startsWith("data:image/")) return "An uploaded image couldn't be read — try re-adding it.";
    uploads.push({
      id: typeof u.id === "string" && u.id ? u.id.slice(0, 40) : uid("up"),
      role: ROLES.includes(u.role as UploadRole) ? (u.role as UploadRole) : "character",
      name: typeof u.name === "string" ? u.name.trim().slice(0, 40) : "",
      dataUrl,
      description: typeof u.description === "string" ? u.description.trim().slice(0, 400) : "",
    });
  }
  return { brief, uploads };
}
