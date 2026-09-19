// ---------------------------------------------------------------------------
// Image Studio — server-side helpers shared by the two routes.
// ---------------------------------------------------------------------------

import "server-only";
import { aiFetch } from "@/lib/ai/provider";
import { agentById, type ImageAgent } from "./agents";
import { MAX_PROMPT, MAX_REFS, type Part, type RefInput } from "./prompt";

export interface StudioRequest {
  agent: ImageAgent;
  prompt: string;
  refs: RefInput[];
  soften: boolean;
}

/** Validates a route body. Returns a user-readable error string instead of throwing. */
export function parseBody(body: unknown): StudioRequest | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const agent = agentById(String(b.agentId ?? ""));
  if (!agent) return "Pick an agent first.";
  const prompt = typeof b.prompt === "string" ? b.prompt.trim() : "";
  if (!prompt) return "Write a prompt first.";
  if (prompt.length > MAX_PROMPT) return `Keep the prompt under ${MAX_PROMPT} characters.`;
  const rawRefs = Array.isArray(b.refs) ? b.refs : [];
  if (rawRefs.length > MAX_REFS) return `Use at most ${MAX_REFS} reference images.`;
  const refs: RefInput[] = [];
  for (const r of rawRefs as Record<string, unknown>[]) {
    const dataUrl = typeof r?.dataUrl === "string" ? r.dataUrl : "";
    if (!dataUrl.startsWith("data:image/")) return "A reference image couldn't be read — try re-adding it.";
    refs.push({ role: r.role === "style" ? "style" : "person", dataUrl });
  }
  return { agent, prompt, refs, soften: b.soften === true };
}

/** One chat-completions call through the hub's provider. Throws on a non-2xx. */
export async function chat(
  model: string,
  messages: { role: "system" | "user"; content: string | Part[] }[],
  extra: Record<string, unknown> = {},
  timeoutMs = 60_000,
): Promise<unknown> {
  const res = await aiFetch({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, ...extra }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json();
}
