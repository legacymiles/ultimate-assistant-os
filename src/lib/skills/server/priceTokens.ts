import "server-only";

// ---------------------------------------------------------------------------
// Pricing a Claude Code turn's tokens, for Skills Library › Spend.
//
// Claude Code on a subscription pays nothing per token, so this is what the
// turn WOULD cost at API prices — the figure that says which skill is heavy.
// Prices come from the live model catalogue (OpenRouter's list, the same one
// the AI spend ledger falls back to), never a hard-coded table, and every row
// priced here is marked as an estimate. A model the catalogue does not know
// is counted in tokens with a cost of zero, rather than a guess.
//
// Cache reads and writes are priced with Anthropic's prompt-caching
// multipliers on the input price (reads 0.1×, writes 1.25×).
// ---------------------------------------------------------------------------

import { listModels } from "@/lib/ai/models";

export interface TurnTokens {
  model: string;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Find a Claude Code model id ("claude-opus-5-5-20261001") in the catalogue ("anthropic/claude-opus-5.5"). */
export async function catalogPrice(model: string): Promise<{ input: number; output: number } | null> {
  const want = flat(model.replace(/-\d{8}$/, "")); // drop a date suffix
  if (!want) return null;
  const models = await listModels().catch(() => []);
  const hit = models.find((m) => flat(m.id.split("/").pop() ?? "") === want) ?? models.find((m) => flat(m.id).endsWith(want));
  return hit ? { input: hit.promptPrice, output: hit.completionPrice } : null;
}

export async function priceTurn(t: TurnTokens): Promise<{ cost: number; promptTokens: number; completionTokens: number; estimated: boolean }> {
  const input = Math.max(0, t.input || 0);
  const output = Math.max(0, t.output || 0);
  const read = Math.max(0, t.cacheRead || 0);
  const write = Math.max(0, t.cacheWrite || 0);
  const price = await catalogPrice(t.model);
  const cost = price ? ((input + write * 1.25 + read * 0.1) * price.input + output * price.output) / 1e6 : 0;
  return { cost, promptTokens: input + read + write, completionTokens: output, estimated: true };
}
