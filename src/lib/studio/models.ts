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
// Every fact below was read off OpenRouter's public model list on 30 Sep 2026,
// except the OrcaRouter entry, which comes from OrcaRouter's own catalogue on
// 8 Nov 2026. All six take tool calls, which is not optional here: the Studio
// agent is a tool loop and a model without tools cannot run it at all.
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
 * The owner's list, in the order they asked for.
 *
 * The uncensored DeepSeek leads it, because the work that reaches this chain is
 * the work another model has already refused. Behind it, unchanged: free first,
 * then the cheap workhorse, then the strong reasoner, then the two that can take
 * audio and video — which are last not because they are worse but because they
 * only earn their price when the film actually carries a clip or a track.
 */
export const STUDIO_MODELS: StudioModel[] = [
  {
    // OrcaRouter's uncensored DeepSeek. First because the films that reach this
    // chain are the ones another model has already declined, and an abliterated
    // model is the one thing here that will not hand a shot back as a refusal.
    // It reads stills, not clips or tracks, so a film with audio in it still
    // falls through to the two that can hear.
    id: "orca/orcacyber-flash-1.0",
    label: "DeepSeek 4.1 Flash Abliterated",
    reads: ["image"],
    price: [0.8, 1.6],
    json: true,
    context: 1_048_576,
    note: "Uncensored, on OrcaRouter. Needs ORCAROUTER_API_KEY and Security Research access on that account.",
  },
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
  {
    // Last, because it is the expensive one: reached when everything above has
    // refused the film. It is the only model here that watches a reference clip
    // AND is uncensored, so a film built on a clip that other models won't
    // discuss still has somewhere to go.
    id: "orca/orcacyber-k3.1-pro",
    label: "Kimi K3.1 Pro Abliterated",
    reads: ["image", "video"],
    price: [4, 20],
    json: true,
    context: 1_048_576,
    note: "Uncensored and watches clips. OrcaRouter, $4 / $20 per M — the last resort, not the workhorse.",
  },
];

export const STUDIO_MODEL_IDS = STUDIO_MODELS.map((m) => m.id);

const BY_ID = new Map(STUDIO_MODELS.map((m) => [m.id, m]));

export function studioModel(id: string): StudioModel | undefined {
  return BY_ID.get(id);
}

/** The chain when the owner has not reordered anything. */
export const DEFAULT_STUDIO_CHAIN: string[] = STUDIO_MODEL_IDS.slice();

/**
 * The chain this page shipped before the uncensored model joined it.
 *
 * Kept only so an untouched save can be recognised and upgraded: a browser that
 * stored this exact order never chose it, it just got the default, and leaving
 * it in place would keep the Studio on the old brains forever.
 */
const LEGACY_DEFAULT_CHAIN = [
  "qwen/qwen3.8-27b:free",
  "deepseek/deepseek-v4.1-flash",
  "openai/gpt-6-luna-pro",
  "qwen/qwen3.8-omni-flash",
  "xiaomi/mimo-v2.6-flash",
];

/** The saved chain, upgraded from the old default when that is all it is. */
export function upgradeStudioChain(chain: string[]): string[] {
  const untouched = chain.length === LEGACY_DEFAULT_CHAIN.length && chain.every((id, i) => id === LEGACY_DEFAULT_CHAIN[i]);
  return untouched ? DEFAULT_STUDIO_CHAIN : chain;
}

/** How many the provider will walk before giving up. All seven of them. */
export const MAX_CHAIN = 7;

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
