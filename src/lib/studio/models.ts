// ---------------------------------------------------------------------------
// The Studio's own model chain — the brains it plans a film with.
//
// Film setup is where the owner sets the world (genre, era, tempo), and this
// sits with them because it is the same kind of decision: who is doing the
// thinking on this film. The list is ordered, and the order IS the fallback —
// the first one that answers takes the work, so a model that is down, rate
// limited, out of credit or unable to read an attached reference hands the job
// to the next one instead of failing the shot.
//
// WHAT THIS DOES NOT DO, because the name invites the wrong expectation: none of
// these five draws a picture or renders a frame. Stills come from Flux 2 Klein on
// the owner's own PC (src/lib/ai/images.ts) and video from H3; those are image and
// video models and no LLM substitutes for them. What these five do is the writing
// and the looking — the shot plan, the prompts, the board, reading the reference
// photos, watching a reference clip, listening to a track. When a film fails to
// get made it is almost always this step that refused, which is why it is the step
// that gets a fallback chain.
//
// Every fact below was read off OpenRouter's public model list on 30 Sep 2026.
// All five take tool calls, which is not optional here: the Studio agent is a
// tool loop and a model without tools cannot run it at all.
// ---------------------------------------------------------------------------

export interface StudioModel {
  id: string;
  /** What the picker calls it. */
  label: string;
  /** Besides text. */
  reads: ("image" | "audio" | "video" | "file")[];
  /** $ per million tokens, [prompt, completion]. */
  price: [number, number];
  /** response_format support. A model without it cannot return a strict board. */
  json: boolean;
  context: number;
  /** One line: what this one is FOR, in the owner's terms. */
  note: string;
}

/**
 * The owner's five, in the order they asked for.
 *
 * That order is deliberate and is the default chain: free first, then the cheap
 * workhorse, then the strong reasoner, then the two that can take audio and
 * video — which are last not because they are worse but because they only earn
 * their price when the film actually carries a clip or a track.
 */
export const STUDIO_MODELS: StudioModel[] = [
  {
    id: "qwen/qwen3.8-27b:free",
    label: "Qwen3.8 27B free",
    reads: ["image", "video"],
    price: [0, 0],
    json: false,
    context: 262_144,
    note: "Free. Writes the plan and reads reference stills and clips at no cost.",
  },
  {
    id: "deepseek/deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    reads: ["image"],
    price: [0.03, 0.5],
    json: true,
    context: 1_048_576,
    note: "Three cents a million. The workhorse when the free one refuses or a strict board is needed.",
  },
  {
    id: "openai/gpt-6-luna-pro",
    label: "GPT-6 Luna Pro",
    reads: ["image", "file"],
    price: [0.1, 0.5],
    json: true,
    context: 1_050_000,
    note: "The strongest planner here. For a film whose story has to hold together.",
  },
  {
    id: "qwen/qwen3.8-omni-flash",
    label: "Qwen3.8 Omni Flash",
    reads: ["image", "audio", "video"],
    price: [0.15, 0.47],
    json: true,
    context: 1_000_000,
    note: "Reads all four. For a film built on a reference clip or a music track.",
  },
  {
    id: "xiaomi/mimo-v2.6-flash",
    label: "MiMo-V2.6-Flash",
    reads: ["image", "audio", "video"],
    price: [0.14, 0.28],
    json: true,
    context: 1_050_000,
    note: "Reads all four and costs less. The cheaper of the two that can hear a track.",
  },
];

export const STUDIO_MODEL_IDS = STUDIO_MODELS.map((m) => m.id);

const BY_ID = new Map(STUDIO_MODELS.map((m) => [m.id, m]));

export function studioModel(id: string): StudioModel | undefined {
  return BY_ID.get(id);
}

/** The chain when the owner has not reordered anything. */
export const DEFAULT_STUDIO_CHAIN: string[] = STUDIO_MODEL_IDS.slice();

/** How many the provider will walk before giving up. All five of them. */
export const MAX_CHAIN = 5;

/**
 * A chain this code will act on: known ids, no duplicates, at most MAX_CHAIN.
 *
 * The cap matches the list exactly, so every row in the picker is a control that
 * does something. It was four for a while and that was wrong: the fifth row sat
 * there looking settable and would have disappeared the first time the owner
 * moved anything. Empty means "no opinion" — the hub's own router decides, which
 * is a legitimate state and not an error.
 */
export function cleanStudioChain(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !BY_ID.has(v) || out.includes(v)) continue;
    out.push(v);
    if (out.length === MAX_CHAIN) break;
  }
  return out;
}

/** Move one model up or down the chain. Returns a new array. */
export function reorderChain(chain: string[], id: string, direction: -1 | 1): string[] {
  const from = chain.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= chain.length) return chain;
  const next = [...chain];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Add or remove a model, keeping the list's own order for anything re-added. */
export function toggleInChain(chain: string[], id: string): string[] {
  if (!BY_ID.has(id)) return chain;
  if (chain.includes(id)) return chain.filter((c) => c !== id);
  if (chain.length >= MAX_CHAIN) return chain;
  // Re-added at the end rather than back in its catalogue position: the chain is
  // the owner's order now, and quietly inserting something into the middle of it
  // would change which model answers next without them asking.
  return [...chain, id];
}

/** "free", or "$0.14 / $0.28 per million". */
export function priceLabel(model: StudioModel): string {
  if (model.price[0] === 0 && model.price[1] === 0) return "free";
  return `$${model.price[0]} / $${model.price[1]} per M`;
}
