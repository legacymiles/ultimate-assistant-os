import "server-only";

// The hub's one AI path (src/lib/ai/provider.ts) — the owner's picked model,
// OpenRouter first. A message with a video in it is routed by the hub's router
// to a model that can watch video, so a YouTube link can be read directly.

import { DEFAULT_MODEL, aiEndpoint, aiFetch } from "@/lib/ai/provider";
import { parseJsonLoose } from "@/lib/social-import/understand";

export { askJson } from "@/lib/social-personas/server/ai";

export function aiReady(): boolean {
  return Boolean(aiEndpoint());
}

/** Ask about a video by its link. Returns parsed JSON or throws. */
export async function askVideoJson(system: string, prompt: string, videoUrl: string): Promise<unknown> {
  const res = await aiFetch({
    method: "POST",
    body: JSON.stringify({
      model: process.env.AI_MODEL || DEFAULT_MODEL,
      temperature: 0.4,
      max_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "video_url", video_url: { url: videoUrl } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(170_000),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const reply = body?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) throw new Error("The AI returned an empty reply.");
  return parseJsonLoose(reply);
}

/** The body of a POST as an object, or null. Never throws. */
export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}
