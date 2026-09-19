import "server-only";

// ---------------------------------------------------------------------------
// Turning text into a meaning vector.
//
// OpenRouter mirrors OpenAI's /embeddings shape, so the hub's existing key
// covers this too and no new account is needed. text-embedding-3-small is
// 1536 dimensions, which is what the migration's vector column declares —
// changing the model means changing that column, so the dimension is asserted
// here rather than trusted.
//
// Everything returns null instead of throwing when no key is set: memory then
// falls back to word search, which is degraded but true.
// ---------------------------------------------------------------------------

export const EMBED_MODEL = "openai/text-embedding-3-small";
export const EMBED_DIMS = 1536;

/** Embeddings do not go through the front-page model picker: the vector column
 *  is tied to one model's dimensions, so a swapped model would silently make
 *  every stored vector meaningless. */
function embedEndpoint(): { url: string; key: string } | null {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  return { url: "https://openrouter.ai/api/v1/embeddings", key };
}

export function canEmbed(): boolean {
  return embedEndpoint() !== null;
}

/** Cost control and a hard API limit: long files are embedded by their head. */
const MAX_CHARS = 8000;

/**
 * Embed a batch of texts. Returns null when embeddings are unavailable, so the
 * caller can store the memory anyway and search it by words.
 */
export async function embed(texts: string[]): Promise<number[][] | null> {
  const endpoint = embedEndpoint();
  if (!endpoint || !texts.length) return null;
  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${endpoint.key}`,
      },
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: texts.map((t) => t.slice(0, MAX_CHARS)),
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { embedding?: number[]; index?: number }[] };
    const rows = data.data;
    if (!Array.isArray(rows) || rows.length !== texts.length) return null;
    const out: number[][] = [];
    for (let i = 0; i < rows.length; i += 1) {
      const v = rows[i]?.embedding;
      // A wrong width would corrupt the column: refuse rather than write it.
      if (!Array.isArray(v) || v.length !== EMBED_DIMS) return null;
      out[rows[i]?.index ?? i] = v;
    }
    return out;
  } catch {
    return null;
  }
}

/** One text, for the query side. */
export async function embedOne(text: string): Promise<number[] | null> {
  const out = await embed([text]);
  return out?.[0] ?? null;
}
