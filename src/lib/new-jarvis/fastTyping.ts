import "server-only";

import { decide } from "@/lib/ai/decide";
import { aiEndpoint, aiFetch } from "@/lib/ai/provider";
import { matchField } from "@/lib/jarvis/record/fields";
import { decideRoute } from "@/lib/client-review/contentCheck";
import { uncensoredChain } from "./reroute";
import {
  cleanWritten,
  fillStep,
  pickWords,
  savedFor,
  snippetsFrom,
  typeStep,
  wordsRequest,
  writerPrompt,
  FAST_TIMEOUT_MS,
  type Candidate,
  type FastStep,
  type SavedField,
  type TypeIntent,
} from "./browserFast";

// ---------------------------------------------------------------------------
// Jev chose to type into a box. Decide what goes in it, cheapest first:
//
//   1. A rule: the box's label names a Life Record field you've filled
//      ("Email", "Zip code") → fill it from your Record. No model at all.
//   2. Jev picks: your saved detail, or words from your own message.
//   3. Only if new words are needed: a small text model writes them, given just
//      the goal and the box label (a few hundred tokens), never the whole
//      conversation. DeepSeek by default (JARVIS_TYPING_MODEL to change).
//
// Any step unsure, slow, failing or refusing → null, and the round goes to the
// chat model exactly as before.
// ---------------------------------------------------------------------------

export const DEFAULT_TYPING_MODEL = "deepseek/deepseek-v4.1-flash";

export interface TypingResult {
  step: FastStep;
  /** The text model that wrote the words, when one did. */
  writer?: string;
}

export async function resolveTyping(intent: TypeIntent, c: Candidate, saved: SavedField[]): Promise<TypingResult | null> {
  const { box } = intent;
  const tab = c.snap.tabId;

  // 1. The label alone says which saved field it is.
  const rule = matchField({ label: box.name, type: box.type });
  const ruleHit = rule && rule.confidence >= 0.5 ? saved.find((f) => f.key === rule.key) : undefined;
  if (ruleHit) return { step: fillStep(box, ruleHit.key, ruleHit.label, tab) };

  // 2. Jev picks the words, when there is anything to pick from.
  const ctx = { box, snippets: snippetsFrom(c.goal), saved: savedFor(box, saved, rule?.key) };
  if (ctx.snippets.length || ctx.saved.length) {
    const pick = pickWords(
      await decide(wordsRequest(c.goal, c.snap, ctx), { app: "jarvis-browser", timeoutMs: FAST_TIMEOUT_MS }),
      ctx,
    );
    if (!pick) return null;
    if (pick.kind === "said") return { step: typeStep(box, pick.text, tab, `type your words into "${box.name}"`) };
    if (pick.kind === "saved") return { step: fillStep(box, pick.key, pick.label, tab) };
  }

  // 3. New words are needed.
  return writeWords(c, box, tab);
}

async function writeWords(c: Candidate, box: TypeIntent["box"], tab: string | undefined): Promise<TypingResult | null> {
  if (!aiEndpoint()) return null;
  const check = decideRoute(`${c.goal}\n${box.name}\n${c.snap.title}`, null, null);
  if (check.route === "blocked") return null;
  let model = process.env.JARVIS_TYPING_MODEL || DEFAULT_TYPING_MODEL;
  if (check.route === "uncensored" && model.startsWith("anthropic/")) {
    model = uncensoredChain({ jarvis: process.env.JARVIS_UNCENSORED_MODELS })[0] ?? DEFAULT_TYPING_MODEL;
  }

  const { system, user } = writerPrompt(c.goal, c.snap, box);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8_000);
  try {
    const res = await aiFetch({
      method: "POST",
      signal: ctl.signal,
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: box.role === "textarea" ? 450 : 80,
        // Pinned: the router must not trade this tiny call up to a big model.
        task: { app: "jarvis-typing", models: [model] },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = cleanWritten(data.choices?.[0]?.message?.content ?? "", box);
    if (!text) return null;
    return { step: typeStep(box, text, tab, `write and type into "${box.name}"`), writer: model };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
