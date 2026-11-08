// ---------------------------------------------------------------------------
// Which model writes a client's build brief.
//
// The owner picks ONE, from the same kind of menu the Chat has: their own Claude
// plan (through the PC bridge), or any model on OpenRouter with the hub's key.
// The pick lives on the project (`briefModel`); with no pick the old lane
// behaviour stands, so every project made before this menu existed keeps
// working unchanged.
//
// A stored value is one of:
//   ""                        — the project's lane (auto / standard / uncensored)
//   "lane:standard"           — Claude only, never re-routed (only in the menu)
//   "lane:uncensored"         — always the uncensored chain (only in the menu)
//   "claude-subscription:xyz" — the owner's Claude plan, on this PC, asked for model xyz
//   "vendor/model"            — that model on OpenRouter, exactly as named
//
// Lanes are folded into the same menu rather than kept beside it: "which model"
// and "what happens when it refuses" are one decision for the person pressing
// Improve, and two controls that can disagree is worse than one list.
// ---------------------------------------------------------------------------

import type { ClientProject, ContentLane } from "./types";

/** The prefix that marks a pick as "my own plan, on this PC", never a cloud id. */
export const SUBSCRIPTION_PREFIX = "claude-subscription:";

export type BriefModelGroup = "lane" | "subscription" | "cloud";

export interface BriefModelOption {
  value: string;
  label: string;
  /** One line on when to pick it. */
  why: string;
  group: BriefModelGroup;
  /** The model the Claude plan is asked for. Subscription entries only. */
  planModel?: string;
}

const plan = (planModel: string, label: string, why: string): BriefModelOption => ({
  value: SUBSCRIPTION_PREFIX + planModel,
  label,
  why,
  group: "subscription",
  planModel,
});

export const BRIEF_MODELS: BriefModelOption[] = [
  // The old lane control, still here — it is the answer to "Claude said no".
  { value: "", label: "Auto", why: "Claude first; the uncensored model if it refuses.", group: "lane" },
  { value: "lane:standard", label: "Claude only", why: "Claude writes it, or it stays a plain list.", group: "lane" },
  { value: "lane:uncensored", label: "Uncensored only", why: "The abliterated DeepSeek, then DeepSeek V4 Pro, then Grok. For explicit sites.", group: "lane" },

  // The owner's own subscription, through Claude Code on their PC.
  plan("claude-opus-5-5", "Opus 5.5 · my plan", "Your own subscription. Strongest, no extra cost."),
  plan("claude-opus-5", "Opus 5 · my plan", "Your own subscription, the previous Opus."),
  plan("claude-sonnet-5-5", "Sonnet 5.5 · my plan", "Your own subscription, faster than Opus."),
  plan("claude-sonnet-5", "Sonnet 5 · my plan", "Your own subscription, lightest on the plan."),

  // OpenRouter and OrcaRouter, paid per brief with the hub's key.
  {
    value: "orca/orcacyber-flash-1.0",
    label: "DeepSeek 4.1 Flash Abliterated · OrcaRouter",
    why: "Uncensored, so the brief is written rather than declined. Needs ORCAROUTER_API_KEY and Security Research access on that account.",
    group: "cloud",
  },
  { value: "deepseek/deepseek-v4.1-flash-1017", label: "DeepSeek 4.1 Flash 1017", why: "Pennies per brief, fast, sees pictures.", group: "cloud" },
  { value: "deepseek/deepseek-v4.1-flash", label: "DeepSeek 4.1 Flash", why: "The same model, without the October build.", group: "cloud" },
  { value: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", why: "Claude's writing, on the hub's key.", group: "cloud" },
  { value: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", why: "The brief default, on the hub's key.", group: "cloud" },
  { value: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", why: "The strongest Claude, billed per brief.", group: "cloud" },
  { value: "anthropic/claude-opus-5", label: "Claude Opus 5", why: "Opus 5 on the hub's key.", group: "cloud" },
  { value: "openai/gpt-6-luna-pro", label: "GPT-6 Luna Pro", why: "A different house style for the brief.", group: "cloud" },
  { value: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", why: "Long batches, quick and cheap.", group: "cloud" },
  { value: "deepseek/deepseek-v4-pro-0813", label: "DeepSeek V4 Pro 0813", why: "The uncensored lane's first model, by hand.", group: "cloud" },
  { value: "x-ai/grok-4.6", label: "Grok 4.6", why: "The uncensored lane's second model.", group: "cloud" },
];

const BY_VALUE = new Map(BRIEF_MODELS.map((m) => [m.value, m]));

/** "vendor/model" — the shape every OpenRouter id has. */
export function isBriefModelId(v: unknown): boolean {
  return typeof v === "string" && v.length <= 120 && /^[a-z0-9][\w.-]*\/[\w.:-]+$/i.test(v);
}

/** A bare model name the Claude plan is asked for ("claude-opus-5-5") — no vendor slash. */
export function isPlanModelId(v: unknown): boolean {
  return typeof v === "string" && /^[a-z0-9][\w.-]{1,80}$/i.test(v);
}

export function isSubscriptionValue(v: string): boolean {
  return v.startsWith(SUBSCRIPTION_PREFIX);
}

export function isLaneValue(v: string): boolean {
  return v === "" || v.startsWith("lane:");
}

export function laneOfValue(v: string): ContentLane {
  if (v === "lane:standard") return "standard";
  if (v === "lane:uncensored") return "uncensored";
  return "auto";
}

/** What the menu shows for a project: its explicit pick, else its lane. */
export function pickValue(p: Pick<ClientProject, "briefModel" | "lane">): string {
  const picked = (p.briefModel ?? "").trim();
  if (picked) return picked;
  return p.lane === "standard" ? "lane:standard" : p.lane === "uncensored" ? "lane:uncensored" : "";
}

export function labelFor(v: string): string {
  const known = BY_VALUE.get(v);
  if (known) return known.label;
  if (!v) return "Auto";
  if (isSubscriptionValue(v)) return `${v.slice(SUBSCRIPTION_PREFIX.length)} · my plan`;
  return v.split("/").pop() || v;
}

export function whyFor(v: string): string {
  return BY_VALUE.get(v)?.why ?? "A custom model id.";
}

/** Options grouped for the menu, in the order they should be read. */
export function groupedModels(): { group: BriefModelGroup; title: string; note?: string; items: BriefModelOption[] }[] {
  return [
    { group: "lane", title: "What it does when Claude refuses", items: BRIEF_MODELS.filter((m) => m.group === "lane") },
    {
      group: "subscription",
      title: "Your Claude plan · on this PC",
      note: "Runs in Claude Code on your laptop, so the hub pays nothing. Needs the PC helper running.",
      items: BRIEF_MODELS.filter((m) => m.group === "subscription"),
    },
    { group: "cloud", title: "OpenRouter · your key, paid per brief", items: BRIEF_MODELS.filter((m) => m.group === "cloud") },
  ];
}

/**
 * Which badge colour lane an explicit pick belongs to.
 *
 * Only affects the little coloured tag on the finished brief; a model that is
 * not on either uncensored list is treated as standard, because that is what
 * it is.
 */
export function laneForModel(id: string): "standard" | "uncensored" {
  return id.startsWith("orca/") || id.startsWith("deepseek/deepseek-v4-pro") || id.startsWith("x-ai/grok")
    ? "uncensored"
    : "standard";
}

// ---------------------------------------------------------------------------
// Which model does the BUILD.
//
// Everything above picks the model that WRITES the brief. The build itself is
// Claude Code running on the owner's PC, and Claude Code can only be a Claude
// model — so the pick is translated here rather than passed through, and the
// translation is shown on the button instead of happening quietly.
//
//   "claude-subscription:claude-opus-5-5" → claude-opus-5-5   (their plan)
//   "anthropic/claude-opus-5.5"           → claude-opus-5-5   (same model)
//   a lane, or DeepSeek / Grok / GPT      → the default, said out loud
//
// The last case is the honest one. A build cannot run on Grok here, so telling
// the owner "builds with Opus 5.5, Grok wrote the brief" is better than either
// ignoring the pick or refusing to build at all.
// ---------------------------------------------------------------------------

/** What a build runs on when the pick does not name a Claude Code model. */
export const DEFAULT_BUILD_MODEL = "claude-opus-5-5";

/** The OpenRouter ids that ARE a Claude Code model, by the name it answers to. */
const BUILD_BY_CLOUD_ID: Record<string, string> = {
  "anthropic/claude-opus-5.5": "claude-opus-5-5",
  "anthropic/claude-opus-5": "claude-opus-5",
  "anthropic/claude-sonnet-5.5": "claude-sonnet-5-5",
  "anthropic/claude-sonnet-5": "claude-sonnet-5",
};

/** Does this pick name a model the build can actually run on? */
export function buildsWithPick(pick: string): boolean {
  const v = (pick ?? "").trim();
  if (isSubscriptionValue(v)) return isPlanModelId(v.slice(SUBSCRIPTION_PREFIX.length));
  return Boolean(BUILD_BY_CLOUD_ID[v.toLowerCase()]);
}

/** The model id handed to Claude Code for this project's builds. Never empty. */
export function buildModelFor(pick: string): string {
  const v = (pick ?? "").trim();
  if (isSubscriptionValue(v)) {
    const named = v.slice(SUBSCRIPTION_PREFIX.length);
    return isPlanModelId(named) ? named : DEFAULT_BUILD_MODEL;
  }
  return BUILD_BY_CLOUD_ID[v.toLowerCase()] ?? DEFAULT_BUILD_MODEL;
}

/** One line for the build button: what it will run on, and why. */
export function buildModelNote(pick: string): string {
  const model = buildModelFor(pick);
  if (buildsWithPick(pick)) return `Builds on your plan with ${model}.`;
  if (isLaneValue(pick)) return `Builds on your plan with ${model} — pick a Claude model above to build with another.`;
  return `Builds on your plan with ${model}: a build runs Claude Code, which only runs Claude. ${labelFor(pick)} still writes the brief.`;
}
