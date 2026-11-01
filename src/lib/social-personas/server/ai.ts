import "server-only";

import { DEFAULT_MODEL, aiEndpoint, aiFetch } from "@/lib/ai/provider";
import { parseJsonLoose } from "@/lib/social-import/understand";

export function aiReady(): boolean {
  return Boolean(aiEndpoint());
}

type Msg = { role: "system" | "user" | "assistant"; content: string };

async function complete(
  messages: Msg[],
  {
    json,
    temperature,
    maxTokens = 4000,
    timeoutMs = 120_000,
    reasoningEffort,
  }: { json: boolean; temperature: number; maxTokens?: number; timeoutMs?: number; reasoningEffort?: "low" | "medium" | "high" },
): Promise<string> {
  const res = await aiFetch({
    method: "POST",
    body: JSON.stringify({
      model: process.env.AI_MODEL || DEFAULT_MODEL,
      temperature,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      // Reasoning tokens come out of the SAME budget as the answer. On a long
      // prompt asking for a lot of prose, a reasoning model can spend the whole
      // allowance thinking and return an empty message with finish_reason
      // "length" — which looks like a refusal and is really a budget. Calls
      // that want prose, not deduction, say so here.
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
      messages,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const choice = body?.choices?.[0];
  const reply = choice?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) {
    // "Empty reply" on its own sent us hunting for a timeout that was not
    // there. The provider always says why — a hit token ceiling, a refusal, a
    // content filter — so the message carries it.
    const why = [
      choice?.finish_reason && `finish_reason=${choice.finish_reason}`,
      choice?.native_finish_reason && `native=${choice.native_finish_reason}`,
      choice?.message?.refusal && `refusal=${String(choice.message.refusal).slice(0, 160)}`,
      body?.usage && `tokens=${body.usage.completion_tokens ?? "?"}/${maxTokens}`,
      typeof choice?.message?.reasoning === "string" && choice.message.reasoning.trim()
        ? "the model spent the whole budget reasoning and wrote no answer"
        : null,
      body?.error?.message && `providerError=${String(body.error.message).slice(0, 200)}`,
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(`The AI returned an empty reply${why ? ` (${why})` : ""}.`);
  }
  return reply;
}

export async function askJson(
  system: string,
  user: string,
  temperature = 0.8,
  maxTokens?: number,
  timeoutMs?: number,
  reasoningEffort?: "low" | "medium" | "high",
): Promise<unknown> {
  return parseJsonLoose(
    await complete([{ role: "system", content: system }, { role: "user", content: user }], {
      json: true,
      temperature,
      maxTokens,
      timeoutMs,
      reasoningEffort,
    }),
  );
}

export async function askText(system: string, messages: Msg[], temperature = 0.8): Promise<string> {
  return complete([{ role: "system", content: system }, ...messages], { json: false, temperature });
}
