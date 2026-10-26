// ---------------------------------------------------------------------------
// The router: which model answers this request, and why.
//
// One decision, made in one place, out of what the request actually contains —
// never out of which app asked. Every general call in the hub names
// DEFAULT_MODEL; provider.ts hands the body here and sends it wherever this
// file says. So a new rule lands here once and the whole hub inherits it.
//
// Four things decide it, in this order of authority:
//
// 1. WHAT THE REQUEST CARRIES. A model that cannot read the audio in a body is
//    not a cheaper option, it is a failed call. Modality outranks everything
//    below, which is why a "hardest question" arriving with a video attached
//    does NOT go to the reasoning model — it goes to the cheapest model that
//    can actually watch the video.
//
// 2. WHETHER STRICT JSON WAS ASKED FOR. Neither free model supports it:
//    OpenRouter lists no response_format on Qwen3.8 27B (free) or Inkling
//    (free). Much of this hub parses a schema out of the reply, so a free model
//    there is a parse error, not a saving. Those calls start on DeepSeek V4.1
//    Flash at $0.02/M — three orders of magnitude under Opus, and close enough
//    to free that the rule costs nothing worth naming.
//
// 3. HOW BIG IT IS. A 300k-character prompt does not fit the free Qwen's 262k
//    window, and a request that asks for a very long answer is the "task that
//    could take too long" Jev exists for: Jev picks the model AND the reasoning
//    effort per request, and has a million tokens of room, so it is the one
//    model that can be handed something open-ended.
//
// 4. HOW HARD IT IS. Structural, never keyword sniffing: the reasoning effort
//    the caller asked for, whether tools are on the request, how big the output
//    schema is, how long the conversation has got. A heuristic that read the
//    words would route on the topic; these read the shape of the work.
//
// Cost is the tiebreak, not the goal. The ladder is ordered cheapest first and
// a retry never drops BELOW the rank that was chosen: a hard question whose
// model is rate-limited retries on another capable model, never on the free one
// that was already ruled out.
//
// Deliberately pure, with no server imports — the Toolbox page renders the same
// table the router runs on, so the two cannot drift.
// ---------------------------------------------------------------------------

export type Modality = "text" | "image" | "audio" | "video" | "file";

/** Which rung of the ladder a model is. */
export type TierId = "free" | "free-audio" | "harder" | "hardest" | "everything" | "long";

export type Difficulty = "simple" | "harder" | "hardest";

/** What a caller may declare about its own request, when it knows better than the heuristic. */
export interface TaskHint {
  difficulty?: Difficulty;
  /** This one is open-ended or slow; give it to the router model. */
  long?: boolean;
  /** Which app or feature asked, for the spend ledger. */
  app?: string;
  /**
   * The skill or Studio workflow this call runs for ("felix", "studio:film-3d").
   * Its tokens count toward that skill in Skills Library › Spend, and when the
   * router is choosing, Jev picks the tier it needs (skills/server/routeSkill.ts).
   */
  skill?: string;
  /**
   * This surface's OWN chain, in order, overruling the ladder below.
   *
   * For a surface where the owner picks the models themselves — the Studio's
   * Film setup deck — because there the choice of brain is part of the creative
   * setup rather than a cost decision the router should be making for them.
   * Models that cannot read the request are still skipped: an explicit pick
   * cannot make a text-only model watch a video.
   */
  models?: string[];
}

export interface RouterModel {
  id: string;
  label: string;
  tier: TierId;
  /** Besides text. Read off OpenRouter's own input_modalities. */
  reads: Modality[];
  /** Supports response_format: json_object / json_schema. */
  json: boolean;
  /** Tokens of context. */
  context: number;
  /** $ per million tokens, [prompt, completion]. null = billed as whatever it routes to. */
  price: [number, number] | null;
  /** 1 = cheapest and simplest … 4 = the router model. A retry never goes below the pick's rank. */
  rank: number;
  /** The owner's rule, in their words. Shown in the Toolbox. */
  why: string;
}

/**
 * The ladder, cheapest first.
 *
 * Every field is a fact read off OpenRouter's public model list on 30 Sep 2026,
 * not a guess. `npm run check:router` re-reads that list and fails when a
 * model's modalities, JSON support, context or price have moved under us.
 */
export const ROUTER_MODELS: RouterModel[] = [
  {
    id: "qwen/qwen3.8-27b:free",
    label: "Qwen3.8 27B (free)",
    tier: "free",
    reads: ["text", "image", "video"],
    json: false,
    context: 262_144,
    price: [0, 0],
    rank: 1,
    why: "Everything it can take, because it is free. Text, pictures and video prompts all start here.",
  },
  {
    id: "thinkingmachines/inkling:free",
    label: "Inkling (free)",
    tier: "free-audio",
    reads: ["text", "image", "audio"],
    json: false,
    context: 1_048_576,
    price: [0, 0],
    rank: 1,
    why: "Anything with audio in it, because it listens and it is free.",
  },
  {
    // v4.1-flash specifically: it is the only DeepSeek that reads pictures as
    // well as calling tools. The pro and older flash builds are text-only, and
    // every surface that lands on this rung — a chat you can drop a photo into,
    // a storyboard built from references — needs both.
    id: "deepseek/deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    tier: "harder",
    reads: ["text", "image"],
    json: true,
    context: 1_048_576,
    price: [0.03, 0.5],
    rank: 2,
    why: "A bit more complicated than the free tier should answer, or strict JSON was asked for.",
  },
  {
    id: "xiaomi/mimo-v2.6-flash",
    label: "MiMo-V2.6-Flash",
    tier: "everything",
    reads: ["text", "image", "audio", "video"],
    json: true,
    context: 1_050_000,
    price: [0.14, 0.28],
    rank: 2,
    why: "One prompt carrying audio AND video. The only cheap model that reads all four at once.",
  },
  {
    id: "openai/gpt-6-luna-pro",
    label: "GPT-6 Luna Pro",
    tier: "hardest",
    reads: ["text", "image", "file"],
    json: true,
    context: 1_050_000,
    price: [0.1, 0.5],
    rank: 3,
    why: "The hardest questions.",
  },
  {
    id: "typesafe/jev-router",
    label: "Jev Router",
    tier: "long",
    reads: ["text", "image", "audio", "video", "file"],
    json: true,
    context: 1_000_000,
    price: null,
    rank: 4,
    why: "Tasks that could take too long. Jev picks the model and the reasoning effort itself, and reads everything.",
  },
];

const BY_TIER = new Map(ROUTER_MODELS.map((m) => [m.tier, m]));

function tierModel(tier: TierId): RouterModel {
  const m = BY_TIER.get(tier);
  if (!m) throw new Error(`No model on the ${tier} rung.`);
  return m;
}

export function routerModel(id: string): RouterModel | undefined {
  return ROUTER_MODELS.find((m) => m.id === id);
}

/**
 * What a model costs HERE, per million tokens of this hub's actual traffic.
 *
 * Prompt and completion are not weighted equally, because this hub's calls are
 * not: a Jarvis agent turn measured 5,066 prompt tokens against 3 completion
 * tokens, since every request carries the memory, folders, lists and tool
 * instructions and most answers are a sentence. Summing the two as though they
 * were balanced ranked MiMo-V2.6-Flash ($0.14/$0.28) below DeepSeek V4.1 Flash
 * ($0.03/$0.50) — exactly backwards for a prompt-heavy call, where DeepSeek is
 * four times cheaper.
 *
 * Four-to-one rather than the measured thousand-to-one: a long answer should
 * still count for something, and the ordering is stable anywhere in between.
 */
const PROMPT_WEIGHT = 4;

function byCost(a: RouterModel, b: RouterModel): number {
  const cost = (m: RouterModel) =>
    m.price ? m.price[0] * PROMPT_WEIGHT + m.price[1] : Number.MAX_SAFE_INTEGER;
  return cost(a) - cost(b);
}

// --- reading the request ---------------------------------------------------

export interface RouteRequest {
  /** Modalities the body carries besides text. */
  need: Modality[];
  /** response_format asked for a JSON object or schema. */
  json: boolean;
  /**
   * Characters of what the OWNER wrote — the conversation, not the scaffolding.
   *
   * Never counts a base64 image: that would make every photo look like a novel
   * and route it to the reasoning model. And never counts the system prompt,
   * which is the same mistake one level up: the Jarvis agent sends roughly
   * 20,000 characters of memory, folders, lists and tool instructions with every
   * request, so counting it made "Reply with exactly: ok" score as a harder task
   * than anything the free rung would ever be allowed to answer.
   */
  chars: number;
  /** The system prompt's size. Kept apart so it counts toward FITTING but not toward DIFFICULTY. */
  systemChars: number;
  /** Largest answer the caller will accept, when it said. */
  maxTokens: number;
  /** Turns in the conversation, system prompt excluded for the same reason. */
  messages: number;
  tools: boolean;
  /** reasoning_effort, when the caller set one. */
  effort: string;
  /** Property names in the requested output schema. A big schema is hard work. */
  schemaFields: number;
  hint?: TaskHint;
}

type Part = { type?: string; text?: string };

/** Everything the router needs to know about a chat-completions body. */
export function readRequest(body: Record<string, unknown>): RouteRequest {
  const need = new Set<Modality>();
  let chars = 0;
  let systemChars = 0;
  const all = Array.isArray(body.messages) ? (body.messages as { role?: string; content?: unknown }[]) : [];
  const messages = all.filter((m) => m?.role !== "system" && m?.role !== "developer");
  for (const msg of all) {
    const scaffolding = msg?.role === "system" || msg?.role === "developer";
    if (typeof msg?.content === "string") {
      if (scaffolding) systemChars += msg.content.length;
      else chars += msg.content.length;
      continue;
    }
    if (!Array.isArray(msg?.content)) continue;
    for (const part of msg.content as Part[]) {
      if (part?.type === "image_url") need.add("image");
      else if (part?.type === "input_audio") need.add("audio");
      else if (part?.type === "video_url") need.add("video");
      else if (part?.type === "file") need.add("file");
      else if (part?.type === "text") {
        if (scaffolding) systemChars += (part.text ?? "").length;
        else chars += (part.text ?? "").length;
      }
    }
  }

  const format = body.response_format as { type?: string; json_schema?: unknown } | undefined;
  const json = format?.type === "json_object" || format?.type === "json_schema";

  const reasoning = body.reasoning as { effort?: string } | undefined;
  const effort = String(reasoning?.effort ?? body.reasoning_effort ?? "");

  return {
    need: [...need],
    json,
    chars,
    systemChars,
    maxTokens: Number(body.max_tokens ?? body.max_completion_tokens ?? 0) || 0,
    messages: messages.length,
    tools: Array.isArray(body.tools) && body.tools.length > 0,
    effort,
    schemaFields: countFields(format?.json_schema),
    hint: (body.task ?? undefined) as TaskHint | undefined,
  };
}

/** Property names anywhere in a JSON schema, capped so a pathological one cannot spin. */
function countFields(schema: unknown, depth = 0): number {
  if (!schema || typeof schema !== "object" || depth > 6) return 0;
  let n = 0;
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "properties" && value && typeof value === "object") {
      const props = value as Record<string, unknown>;
      n += Object.keys(props).length;
      for (const p of Object.keys(props)) n += countFields(props[p], depth + 1);
    } else if (value && typeof value === "object") {
      n += countFields(value, depth + 1);
    }
    if (n > 200) return 200;
  }
  return n;
}

// --- the decision ----------------------------------------------------------

/**
 * How hard this is, from the SHAPE of the work rather than its words.
 *
 * Keyword sniffing was the obvious first try and it is wrong: "why did my
 * deploy fail" and "why is the sky blue" share every keyword and are not the
 * same job. What does correlate is structure — a caller that asked for high
 * reasoning effort, a conversation twenty turns deep, a schema with fifteen
 * fields, a prompt the length of a chapter.
 *
 * TOOLS ARE DELIBERATELY NOT A SIGNAL. They were, on the reasoning that a tool
 * loop goes wrong badly on a small model — and the effect was that the Jarvis
 * chat and the Studio agent, which always carry tools, never once reached the
 * free rung. Both free models do support tool calls, so the owner's rule stands:
 * free unless the request genuinely needs something free cannot do. A free model
 * that then handles the loop poorly fails visibly and the chain moves on, which
 * is the cheaper way to find out.
 */
export function difficultyOf(req: RouteRequest): Difficulty {
  if (req.hint?.difficulty) return req.hint.difficulty;
  if (req.effort === "high" || req.chars > 40_000 || req.messages >= 24 || req.schemaFields >= 12) return "hardest";
  if (req.effort === "medium" || req.chars > 6_000 || req.messages >= 8) return "harder";
  return "simple";
}

/**
 * True when this one is open-ended enough that Jev should pick the effort.
 *
 * The output ceiling is 16k rather than the 8k it started at, measured against
 * what this hub actually asks for: 8000 is the Studio agent's ORDINARY budget for
 * a shot table, and a threshold sitting exactly on it sent every Studio call to
 * the router model. The genuinely open-ended requests here ask for 20k.
 */
export function isLong(req: RouteRequest): boolean {
  return Boolean(req.hint?.long) || req.maxTokens >= 16_000 || req.chars > 120_000;
}

/**
 * Tokens this request will roughly occupy: four characters a token, plus the
 * answer.
 *
 * Counts the system prompt, unlike the difficulty heuristic — it does not make
 * the work harder, but it absolutely has to fit in the window.
 */
function sizeOf(req: RouteRequest): number {
  return Math.ceil((req.chars + req.systemChars) / 4) + req.maxTokens;
}

/** Can this model actually serve this request? Modality, JSON and room, all three. */
export function capable(model: RouterModel, req: RouteRequest): boolean {
  if (req.json && !model.json) return false;
  for (const n of req.need) if (n !== "text" && !model.reads.includes(n)) return false;
  // Media is not counted in `chars`, so this guard only ever fires on real text.
  return model.context >= sizeOf(req) * 1.15;
}

export interface RoutePlan {
  /** The rung the request landed on. */
  tier: TierId;
  /** In order: the pick, then capable retries that are no weaker than it. */
  models: string[];
  difficulty: Difficulty;
  long: boolean;
  /** One line, plain English, for the Toolbox and the spend ledger. */
  why: string;
}

/** The rung a request asks for, before capability is checked. */
function wantedTier(req: RouteRequest, difficulty: Difficulty, long: boolean): TierId {
  if (long) return "long";
  const audio = req.need.includes("audio");
  const video = req.need.includes("video");
  // Audio and video in the same prompt: only the all-four model and Jev can
  // take it, and this is the cheap one. This is the case the owner asked about
  // when he wondered whether one prompt could use several models — it cannot,
  // so one model has to cover the lot.
  if (audio && video) return "everything";
  if (audio) return "free-audio";
  if (difficulty === "hardest") return "hardest";
  if (difficulty === "harder") return "harder";
  return "free";
}

/**
 * Where this request goes, and the retries behind it.
 *
 * The wanted rung is a preference, not a promise: when it cannot read the
 * request, cannot answer in JSON, or has no room, the cheapest capable model
 * that CAN takes it instead, and `why` names the rule that moved it.
 */
export function planRoute(req: RouteRequest): RoutePlan {
  const difficulty = difficultyOf(req);
  const long = isLong(req);
  const tier = wantedTier(req, difficulty, long);
  const wanted = tierModel(tier);

  const usable = ROUTER_MODELS.filter((m) => capable(m, req)).sort(byCost);
  // Jev reads everything and has a million tokens, so `usable` is only ever
  // empty for a request nothing on the ladder can serve at all.
  const pick = capable(wanted, req) ? wanted : (usable[0] ?? tierModel("long"));

  // A retry must not quietly answer a hard question with the free model that
  // was ruled out a moment ago. A weak answer to a hard question reads as a
  // success and is not one, which is worse than the call failing where the app's
  // offline path can see it — so anything below the chosen rank gets a turn only
  // when there is nothing at or above it left to try.
  const atOrAbove = usable.filter((m) => m.id !== pick.id && m.rank >= pick.rank);
  const below = usable.filter((m) => m.id !== pick.id && m.rank < pick.rank);
  const retries = atOrAbove.length ? atOrAbove : below;
  const models = [pick.id, ...retries.map((m) => m.id)].slice(0, 4);

  return { tier: pick.tier, models, difficulty, long, why: reason(req, difficulty, long, tier, pick) };
}

function reason(req: RouteRequest, difficulty: Difficulty, long: boolean, tier: TierId, pick: RouterModel): string {
  const carries = req.need.length ? req.need.join(" + ") : "text";
  const base = long
    ? "Open-ended or very large, so Jev picks the model and the effort"
    : difficulty === "hardest"
      ? "One of the hardest questions"
      : difficulty === "harder"
        ? "A bit more complicated than the free tier"
        : "Ordinary work the free tier can take";
  if (pick.tier === tier) return `${base} (${carries}).`;

  const wanted = tierModel(tier);
  if (req.json && !wanted.json) {
    return `${base} (${carries}), but strict JSON was asked for and the free tier has no JSON mode, so ${pick.label} took it.`;
  }
  const unreadable = req.need.filter((n) => n !== "text" && !wanted.reads.includes(n));
  if (unreadable.length) {
    return `${base}, but it carries ${unreadable.join(" + ")} that tier cannot read, so ${pick.label} took it.`;
  }
  return `${base} (${carries}), but it is too big for that tier, so ${pick.label} took it.`;
}

/** The table the Toolbox shows: one row per rung, in the order the router asks them. */
export const TIER_RULES: { tier: TierId; when: string; model: RouterModel }[] = [
  { tier: "free", when: "Text, pictures or a video prompt — anything the free model can read", model: tierModel("free") },
  { tier: "free-audio", when: "Audio anywhere in the prompt", model: tierModel("free-audio") },
  { tier: "harder", when: "A bit more complicated, or strict JSON was asked for", model: tierModel("harder") },
  { tier: "everything", when: "Audio AND video in the same prompt", model: tierModel("everything") },
  { tier: "hardest", when: "The hardest questions", model: tierModel("hardest") },
  { tier: "long", when: "Could take too long, or is enormous", model: tierModel("long") },
];

/** The models the router is allowed to reach for, for the ledger and the Toolbox. */
export const ROUTER_MODEL_IDS = ROUTER_MODELS.map((m) => m.id);

/**
 * Anthropic's expensive tier.
 *
 * Named here rather than at the notification so that "what counts as an Opus
 * call" is one fact: the ledger marks it, the dashboard reads the mark.
 */
export function isPremiumClaude(model: string): boolean {
  return /^anthropic\/claude-(opus|fable)/.test(model);
}
