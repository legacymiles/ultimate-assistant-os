// ---------------------------------------------------------------------------
// Which Claude a harness thread runs on, and who pays for it.
//
// Every "Powered by" dropdown in the hub (24/7 agents, In Queue, the harness
// start panel) sends ONE string. This file is the only place that string turns
// into a model name and a login, so the page and the wake runner cannot
// disagree about what "Opus 5.5 · API" means.
//
//   "claude-subscription:claude-opus-5-5"  → your own Claude plan. Claude Code
//                                             uses the login on this PC.
//   "openrouter:anthropic/claude-opus-5.5" → the Claude API, through OpenRouter,
//                                             paid per token on your key.
//   "deepseek"                             → the DeepSeek harness (dsh).
//   ""                                     → your plan, Claude Code's default.
//
// The OpenRouter route works because OpenRouter speaks Anthropic's Messages
// API at https://openrouter.ai/api, so Claude Code only needs a different base
// URL and token. ANTHROPIC_API_KEY is set to "" on purpose: Claude Code prefers
// it over the token when present, and a stray key would bill the wrong account.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_REPO } from "./worktree.mjs";

export const SUBSCRIPTION_PREFIX = "claude-subscription:";
export const OPENROUTER_PREFIX = "openrouter:";
export const OPENROUTER_BASE = "https://openrouter.ai/api";

/** Said when there is no key anywhere on this PC. Points at the ONE place to enter it. */
export const NO_KEY =
  "No OpenRouter key on this PC yet. Add it once in Jarvis › Dashboard › Profile › Connections (Thinking) — every harness run uses it from then on.";

/** A bare Claude Code model name, or an OpenRouter "vendor/model" id. */
const SAFE_ID = /^[a-z0-9][\w.:/-]{1,100}$/i;

/**
 * The OpenRouter key this PC can use, or "".
 *
 * Looked for where the owner already keeps it — the bridge's own environment,
 * then the repo's .env.local — so there is never a second copy to paste.
 */
export function openRouterKey({ env = process.env, repos = [DEFAULT_REPO] } = {}) {
  const direct = String(env.OPENROUTER_API_KEY ?? "").trim();
  if (direct) return direct;
  for (const repo of repos) {
    for (const name of [".env.local", ".env"]) {
      const file = join(repo, name);
      if (!existsSync(file)) continue;
      try {
        const m = /^\s*OPENROUTER_API_KEY\s*=\s*["']?([^"'\r\n#]+)["']?/m.exec(readFileSync(file, "utf8"));
        if (m && m[1].trim()) return m[1].trim();
      } catch {
        /* an unreadable env file is the same as no key */
      }
    }
  }
  return "";
}

/** Whether each Claude route can run on this PC, and why not. */
export function routes({ sdk = true, key = openRouterKey() } = {}) {
  const sdkWhy = sdk ? "" : "The Claude Agent SDK is not installed — run `npm install` in tools/jarvis-bridge.";
  return {
    subscription: { available: sdk, why: sdkWhy },
    openrouter: {
      available: sdk && Boolean(key),
      why:
        sdkWhy ||
        (key
          ? ""
          : NO_KEY),
    },
  };
}

/**
 * Turn a dropdown pick into what the harness needs.
 *
 * Returns `{ harness, model, route, env }`. `env` is the EXTRA environment for
 * the Claude Code child — empty for your plan, the OpenRouter redirect for the
 * API. Throws a plain sentence for a pick it cannot run, never a stack.
 */
export function resolvePick(pick, { key } = {}) {
  const v = String(pick ?? "").trim();

  if (!v || v === "claude" || v === "claude-subscription") {
    return { harness: "claude", model: "", route: "subscription", env: {} };
  }
  if (v === "deepseek") return { harness: "deepseek", model: "", route: "deepseek", env: {} };

  if (v.startsWith(SUBSCRIPTION_PREFIX)) {
    const model = v.slice(SUBSCRIPTION_PREFIX.length);
    if (!SAFE_ID.test(model) || model.includes("/")) {
      throw Object.assign(new Error(`"${model}" isn't a Claude model name.`), { status: 400 });
    }
    return { harness: "claude", model, route: "subscription", env: {} };
  }

  if (v.startsWith(OPENROUTER_PREFIX)) {
    const model = v.slice(OPENROUTER_PREFIX.length);
    if (!SAFE_ID.test(model) || !model.includes("/")) {
      throw Object.assign(new Error(`"${model}" isn't an OpenRouter model id.`), { status: 400 });
    }
    const token = key ?? openRouterKey();
    if (!token) {
      throw Object.assign(
        new Error(NO_KEY),
        { status: 400 },
      );
    }
    return {
      harness: "claude",
      model,
      route: "openrouter",
      env: {
        ANTHROPIC_BASE_URL: OPENROUTER_BASE,
        ANTHROPIC_AUTH_TOKEN: token,
        ANTHROPIC_API_KEY: "",
        // Claude Code also calls a small model for titles and summaries; on
        // OpenRouter it must be an OpenRouter id or every background call fails.
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "anthropic/claude-haiku-5.5",
        ANTHROPIC_SMALL_FAST_MODEL: "anthropic/claude-haiku-5.5",
      },
    };
  }

  // A bare model name from an older caller ("claude-opus-5-5") is your plan.
  if (SAFE_ID.test(v) && !v.includes("/")) return { harness: "claude", model: v, route: "subscription", env: {} };
  throw Object.assign(new Error(`"${v}" isn't a model the harness knows how to run.`), { status: 400 });
}

/** How a pick reads in a log line: "claude-opus-5-5 on your plan". */
export function describePick(pick) {
  try {
    const r = resolvePick(pick, { key: "x" });
    if (r.route === "deepseek") return "DeepSeek";
    const name = r.model || "Claude Code's default model";
    return r.route === "openrouter" ? `${name} via OpenRouter` : `${name} on your Claude plan`;
  } catch {
    return String(pick || "Claude");
  }
}
