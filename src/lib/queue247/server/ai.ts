// ---------------------------------------------------------------------------
// The 24/7 Queue's AI calls — one door, metered per step.
//
// Every call goes through the hub's provider chain (src/lib/ai/provider.ts via
// the social-personas JSON helper, which already handles empty replies and
// reasoning budgets). With no AI key the helpers say so instead of pretending:
// executors check `aiReady()` and fall back to work that needs no model, and
// log that they did.
// ---------------------------------------------------------------------------

import { DEFAULT_MODEL, aiFetch, describeFailure } from "@/lib/ai/provider";
import { parseJsonLoose } from "@/lib/social-import/understand";
import { aiReady as providerReady, askJson as providerAskJson, askText as providerAskText } from "@/lib/social-personas/server/ai";

export function aiReady(): boolean {
  return providerReady();
}

export async function askJson<T = unknown>(
  system: string,
  user: string,
  opts: { temperature?: number; maxTokens?: number; timeoutMs?: number; meter?: { aiCalls: number } } = {},
): Promise<T> {
  if (opts.meter) opts.meter.aiCalls += 1;
  return (await providerAskJson(system, user, opts.temperature ?? 0.3, opts.maxTokens ?? 4000, opts.timeoutMs ?? 120_000, "low")) as T;
}

export async function askText(
  system: string,
  user: string,
  opts: { temperature?: number; meter?: { aiCalls: number } } = {},
): Promise<string> {
  if (opts.meter) opts.meter.aiCalls += 1;
  return providerAskText(system, [{ role: "user", content: user }], opts.temperature ?? 0.4);
}

/**
 * The commander's call: one JSON answer from the model the owner picked in the
 * chat ("" = Auto, the hub's router), with any reference pictures shown to it.
 * Returns which model actually answered, so the reply can say so.
 */
export async function askJsonAs(
  system: string,
  user: string,
  opts: { model?: string; images?: string[]; temperature?: number; maxTokens?: number; timeoutMs?: number } = {},
): Promise<{ data: unknown; model: string }> {
  const images = (opts.images ?? []).slice(0, 6);
  const content = images.length
    ? [{ type: "text", text: user }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))]
    : user;
  const res = await aiFetch({
    method: "POST",
    body: JSON.stringify({
      model: opts.model || DEFAULT_MODEL,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 3000,
      response_format: { type: "json_object" },
      reasoning: { effort: "low" },
      task: { app: "queue-247" },
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
  });
  if (!res.ok) throw new Error(await describeFailure(res));
  const body = (await res.json()) as { model?: string; choices?: { message?: { content?: string } }[] };
  const reply = body.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) throw new Error("The model returned an empty reply.");
  return { data: parseJsonLoose(reply), model: body.model || opts.model || DEFAULT_MODEL };
}
