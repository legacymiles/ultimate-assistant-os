import "server-only";

// ---------------------------------------------------------------------------
// The LLM catalogue behind the hub's model picker: OpenRouter's public model
// list (no key needed), trimmed to text-answering models, cached an hour.
//
// The provider also asks it one question — "can this model read the images /
// audio this request carries?" — so a text-only pick never breaks an app that
// sends a photo; that call falls through to a model that can see it.
// ---------------------------------------------------------------------------

export interface ModelInfo {
  id: string;
  name: string;
  /** "text", "image", "audio", "video", "file" */
  input: string[];
  /** Dollars per million tokens. */
  promptPrice: number;
  completionPrice: number;
  context: number;
  json: boolean;
  created: number;
}

/** Non-Claude defaults for the fallback chain: vision-capable, JSON-mode, cheap enough. */
export const DEFAULT_FALLBACKS = ["google/gemini-3.8-flash", "openai/gpt-5.6-sol"];

const TTL = 3600_000;
let cache: { at: number; list: ModelInfo[] } | null = null;
let loading: Promise<ModelInfo[]> | null = null;

export async function listModels(): Promise<ModelInfo[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.list;
  loading ??= (async () => {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { data?: Record<string, unknown>[] };
      const list: ModelInfo[] = [];
      for (const m of body.data ?? []) {
        const id = String(m.id ?? "");
        const arch = (m.architecture ?? {}) as { input_modalities?: string[]; output_modalities?: string[] };
        const out = arch.output_modalities ?? ["text"];
        // Chat answers only: skip image/audio generators and batch-only aliases.
        if (!id || id.endsWith(":batch") || !out.includes("text") || out.includes("image") || out.includes("audio")) continue;
        const pricing = (m.pricing ?? {}) as { prompt?: string; completion?: string };
        list.push({
          id,
          name: String(m.name ?? id),
          input: arch.input_modalities ?? ["text"],
          promptPrice: Math.max(0, Number(pricing.prompt ?? 0) * 1e6),
          completionPrice: Math.max(0, Number(pricing.completion ?? 0) * 1e6),
          context: Number(m.context_length ?? 0),
          json: Array.isArray(m.supported_parameters) && (m.supported_parameters as string[]).includes("response_format"),
          created: Number(m.created ?? 0),
        });
      }
      list.sort((a, b) => b.created - a.created);
      cache = { at: Date.now(), list };
      return list;
    } catch {
      return cache?.list ?? [];
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** What a chat-completions body asks the model to read besides text. */
export function mediaIn(body: Record<string, unknown>): Set<string> {
  const need = new Set<string>();
  for (const msg of Array.isArray(body.messages) ? (body.messages as { content?: unknown }[]) : []) {
    if (!Array.isArray(msg?.content)) continue;
    for (const part of msg.content as { type?: string }[]) {
      if (part?.type === "image_url") need.add("image");
      else if (part?.type === "input_audio") need.add("audio");
      else if (part?.type === "video_url") need.add("video");
      else if (part?.type === "file") need.add("file");
    }
  }
  return need;
}

/** True when the catalogue says the model reads everything in `need`; unknown models get the benefit of the doubt. */
export async function canRead(model: string, need: Set<string>): Promise<boolean> {
  if (!need.size) return true;
  const info = (await listModels()).find((m) => m.id === model);
  if (!info) return true;
  return [...need].every((n) => info.input.includes(n));
}
