// Turning a model's answer into words a person can say on air.
//
// Asked for JSON, models return JSON — usually. Sometimes it arrives in a
// code fence, after a sentence of preamble, or wrapped in a made-up tool
// call (`<toolcall><function=...><parameter=content>...`). Anything that
// slips through here is read aloud by the voice and burned into the stream's
// captions, so every shape is handled, and anything that still looks like
// markup is stripped rather than spoken.

import { MOODS, type Mood } from "./personality";

export interface ParsedReply {
  reply: string;
  mood: Mood;
}

/**
 * Make text safe to say out loud: no tags, no markdown, no stray JSON
 * punctuation, no "Alex:" speaker label, single-spaced.
 */
export function speakable(text: string): string {
  return text
    .replace(/```[a-z]*\n?|```/gi, " ")
    .replace(/<[^<>]{0,200}>/g, " ") // any tag, including <parameter=content>
    .replace(/&(?:lt|gt|amp|quot|#39);/g, " ")
    .replace(/[*_#`~|{}[\]\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:reply|answer|response|assistant|[\p{Lu}][\p{L}]{1,20})\s*:\s+/u, "")
    // Wrapping quotes only — trimmed first, so surrounding spaces can't shield them.
    .replace(/^["“”‘’]+|["“”‘’]+$/g, "")
    .trim();
}

function tryJson(s: string): ParsedReply | null {
  try {
    const j = JSON.parse(s) as { reply?: unknown; mood?: unknown };
    if (typeof j.reply !== "string" || !j.reply.trim()) return null;
    const mood = MOODS.includes(j.mood as Mood) ? (j.mood as Mood) : "neutral";
    return { reply: speakable(j.reply), mood };
  } catch {
    return null;
  }
}

export function parseReply(content: string): ParsedReply {
  const raw = content.trim();

  // 1. The JSON we asked for — bare, fenced, or after a line of preamble.
  const objects = raw.match(/\{[^{}]*"reply"[^{}]*\}/g) ?? [];
  for (const o of objects) {
    const parsed = tryJson(o);
    if (parsed?.reply) return parsed;
  }

  // 2. A made-up tool call: keep only what was meant to be said.
  const param = raw.match(/<parameter[^>]*>([\s\S]*?)<\/parameter>/i);
  if (param?.[1]) {
    const inner = tryJson(param[1].trim());
    if (inner?.reply) return inner;
    return { reply: speakable(param[1]), mood: "neutral" };
  }

  // 3. Plain words, with anything that isn't speech removed.
  return { reply: speakable(raw), mood: "neutral" };
}
