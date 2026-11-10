// ---------------------------------------------------------------------------
// "Powered by" — the one list of models a harness thread can run on.
//
// Every place that starts work on the harness (24/7 agents, In Queue's Run
// now, the harness start panel) offers THIS list, so "Opus 5.5 · API" means
// the same thing on every screen. The bridge turns the value into a model and
// a login in tools/jarvis-bridge/harness-models.mjs; the prefixes here and
// there must match.
//
// Two ways to pay for the same Claude, shown side by side on purpose:
//   your plan  — Claude Code on your PC, signed in as you. No per-token cost.
//   API        — the same model through OpenRouter, paid per token on your
//                key. Works when the plan is rate-limited.
// ---------------------------------------------------------------------------

import type { HarnessChoice } from "./types";

export const SUBSCRIPTION_PREFIX = "claude-subscription:";
export const OPENROUTER_PREFIX = "openrouter:";

export type PickRoute = "subscription" | "openrouter" | "deepseek";

export interface HarnessModel {
  /** What is stored and sent to the bridge. */
  value: string;
  /** Short, for a chip: "Opus 5.5 · plan". */
  short: string;
  /** Full, for the menu: "Claude Opus 5.5 — subscription". */
  label: string;
  route: PickRoute;
  /** One line on when to pick it. */
  why: string;
}

const sub = (model: string, name: string, why: string): HarnessModel => ({
  value: SUBSCRIPTION_PREFIX + model,
  short: `${name} · plan`,
  label: `Claude ${name} — subscription`,
  route: "subscription",
  why,
});

const api = (id: string, name: string, why: string): HarnessModel => ({
  value: OPENROUTER_PREFIX + id,
  short: `${name} · API`,
  label: `Claude ${name} — API via OpenRouter`,
  route: "openrouter",
  why,
});

export const HARNESS_MODELS: HarnessModel[] = [
  sub("claude-opus-5-5", "Opus 5.5", "The strongest Claude, on your own plan. No extra cost."),
  sub("claude-opus-5", "Opus 5", "The previous Opus, on your own plan."),
  sub("claude-sonnet-5-5", "Sonnet 5.5", "Faster and lighter on your plan's limits."),
  sub("claude-sonnet-5", "Sonnet 5", "The lightest on your plan."),
  api("anthropic/claude-opus-5.5", "Opus 5.5", "The strongest Claude, paid per token. Keeps going when your plan is rate-limited."),
  api("anthropic/claude-opus-5", "Opus 5", "Opus 5, paid per token on your OpenRouter key."),
  api("anthropic/claude-sonnet-5.5", "Sonnet 5.5", "Cheaper per token than Opus, still strong at code."),
  api("anthropic/claude-sonnet-5", "Sonnet 5", "The cheapest Claude for long-running agents."),
  {
    value: "deepseek",
    short: "DeepSeek",
    label: "DeepSeek harness",
    route: "deepseek",
    why: "DeepSeek's own harness (dsh) on this PC.",
  },
];

/** What a new agent or task runs on when nobody has picked. */
export const DEFAULT_PICK = SUBSCRIPTION_PREFIX + "claude-opus-5-5";

export const PICK_KEY = "nj.harness-pick:v1";

const BY_VALUE = new Map(HARNESS_MODELS.map((m) => [m.value, m]));

export const ROUTE_TITLE: Record<PickRoute, string> = {
  subscription: "Claude subscription · your plan",
  openrouter: "Claude API · OpenRouter",
  deepseek: "DeepSeek",
};

export function routeOf(value: string): PickRoute {
  if (value === "deepseek") return "deepseek";
  if (value.startsWith(OPENROUTER_PREFIX)) return "openrouter";
  return "subscription";
}

/** Only values this list or the bridge understands; anything else → "". */
export function cleanPick(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (BY_VALUE.has(s)) return s;
  if (s.startsWith(SUBSCRIPTION_PREFIX) && /^[a-z0-9][\w.-]{1,80}$/i.test(s.slice(SUBSCRIPTION_PREFIX.length))) return s;
  if (s.startsWith(OPENROUTER_PREFIX) && /^[a-z0-9][\w.-]*\/[\w.:-]{1,80}$/i.test(s.slice(OPENROUTER_PREFIX.length))) return s;
  return "";
}

export function pickModel(value: string): HarnessModel | undefined {
  return BY_VALUE.get(value);
}

/** "Opus 5.5 · API" — falls back to the raw model name for a custom id. */
export function pickShort(value: string): string {
  const known = BY_VALUE.get(value);
  if (known) return known.short;
  const v = cleanPick(value) || DEFAULT_PICK;
  const tail = v.slice(v.indexOf(":") + 1);
  return `${tail.split("/").pop()} · ${routeOf(v) === "openrouter" ? "API" : "plan"}`;
}

export function pickLabel(value: string): string {
  return BY_VALUE.get(value)?.label ?? pickShort(value);
}

export interface RouteState {
  available: boolean;
  why: string;
}

/**
 * Whether each route can run right now, from the bridge's /harness/list.
 *
 * With the bridge off nothing is known, so every route reads "unknown" rather
 * than unavailable: a 24/7 agent is filed from a phone with the PC asleep, and
 * greying the whole menu then would make it impossible to file one at all.
 */
export function routeStates(choices: HarnessChoice[] | null): Record<PickRoute, RouteState | null> {
  if (!choices || !choices.length) return { subscription: null, openrouter: null, deepseek: null };
  const claude = choices.find((c) => c.id === "claude");
  const deepseek = choices.find((c) => c.id === "deepseek");
  const fromClaude = (k: "subscription" | "openrouter"): RouteState => {
    const r = claude?.routes?.[k];
    if (r) return r;
    // An older bridge that does not report routes: the plan works when Claude
    // does; OpenRouter is unknown, so say how to find out.
    return k === "subscription"
      ? { available: Boolean(claude?.available), why: claude?.why ?? "" }
      : { available: false, why: "Update the PC helper to use the API route (it reports routes from this version on)." };
  };
  return {
    subscription: fromClaude("subscription"),
    openrouter: fromClaude("openrouter"),
    deepseek: deepseek ? { available: deepseek.available, why: deepseek.why } : null,
  };
}

/** Grouped in reading order for a menu. */
export function groupedPicks(): { route: PickRoute; title: string; items: HarnessModel[] }[] {
  return (["subscription", "openrouter", "deepseek"] as PickRoute[]).map((route) => ({
    route,
    title: ROUTE_TITLE[route],
    items: HARNESS_MODELS.filter((m) => m.route === route),
  }));
}
