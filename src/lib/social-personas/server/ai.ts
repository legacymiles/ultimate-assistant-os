import "server-only";

import { DEFAULT_MODEL, aiEndpoint, aiFetch } from "@/lib/ai/provider";
import { parseJsonLoose } from "@/lib/social-import/understand";

export function aiReady(): boolean {
  return Boolean(aiEndpoint());
}

type Msg = { role: "system" | "user" | "assistant"; content: string };

async function complete(messages: Msg[], { json, temperature }: { json: boolean; temperature: number }): Promise<string> {
  const res = await aiFetch({
    method: "POST",
    body: JSON.stringify({
      model: process.env.AI_MODEL || DEFAULT_MODEL,
      temperature,
      max_tokens: 4000,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      messages,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const reply = body?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) throw new Error("The AI returned an empty reply.");
  return reply;
}

export async function askJson(system: string, user: string, temperature = 0.8): Promise<unknown> {
  return parseJsonLoose(await complete([{ role: "system", content: system }, { role: "user", content: user }], { json: true, temperature }));
}

export async function askText(system: string, messages: Msg[], temperature = 0.8): Promise<string> {
  return complete([{ role: "system", content: system }, ...messages], { json: false, temperature });
}
