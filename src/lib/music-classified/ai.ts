// Server-only: one JSON chat call through the hub's provider picker.

import { DEFAULT_MODEL, aiKey, aiFetch } from "@/lib/ai/provider";

export function aiReady(): boolean {
  return Boolean(aiKey());
}

/** OpenAI-compatible content parts; audio is only understood by audio-input models (Gemini on OpenRouter). */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "input_audio"; input_audio: { data: string; format: "wav" | "mp3" } };

/**
 * Ask for a JSON object and parse it. Throws on any failure so the route can
 * fall back; models occasionally wrap JSON in a code fence, which is peeled.
 */
export async function chatJson(
  system: string,
  user: string | ContentPart[],
  {
    maxTokens = 3000,
    timeoutMs = 55_000,
    model,
    temperature = 0.3,
  }: { maxTokens?: number; timeoutMs?: number; model?: string; temperature?: number } = {},
): Promise<Record<string, unknown>> {
  const res = await aiFetch({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || process.env.AI_MODEL || DEFAULT_MODEL,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const content = String(json?.choices?.[0]?.message?.content ?? "");
  // A cut-off reply is broken JSON by definition; say so rather than failing
  // later with a parser error that hides the real cause.
  if (json?.choices?.[0]?.finish_reason === "length") {
    throw new Error(`AI reply hit the ${maxTokens}-token cap and was cut off`);
  }
  const body = content.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? content;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI returned no JSON");
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (err) {
    console.error(
      `music-classified: unparseable AI JSON (finish_reason=${json?.choices?.[0]?.finish_reason}):\n${content.slice(0, 2500)}`,
    );
    throw err;
  }
}
