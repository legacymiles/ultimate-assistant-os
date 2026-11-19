// ---------------------------------------------------------------------------
// Which TTS backend /api/tts should use, resolved from env.
//
// Pure and env-injected so it can be tested without a running server: the
// route passes process.env, the tests pass a literal.
// ---------------------------------------------------------------------------

import type { TtsCapabilities } from "./types";

export type TtsMode = TtsCapabilities["mode"];

export interface TtsTarget {
  mode: TtsMode;
  /** Absolute URL to POST to. Empty for "browser". */
  url: string;
  /** Bearer token, when the backend wants one. */
  key?: string;
  /** Wire format the target speaks. Phonon is plain JSON; fish is msgpack. */
  wire: "json" | "msgpack" | "none";
}

export interface TtsPlan {
  /** Where to send the request. */
  primary: TtsTarget;
  /**
   * Where to send it if the primary is unreachable. Phonon runs on the owner's
   * own machine, so "the laptop is asleep" is a normal state, not an outage —
   * when a fish key exists Jarvis should still speak rather than drop to the
   * browser's robot voice.
   */
  fallback?: TtsTarget;
}

const FISH_URL = "https://api.fish.audio/v1/tts";
const DEFAULT_PHONON_URL = "http://127.0.0.1:8123";

const BROWSER: TtsTarget = { mode: "browser", url: "", wire: "none" };

/** Append the path a backend listens on, unless the URL already carries it. */
function withTtsPath(base: string): string {
  const trimmed = base.replace(/\/$/, "");
  return /\/tts\/?$/.test(trimmed) ? trimmed : `${trimmed}/v1/tts`;
}

function fishTarget(env: NodeJS.ProcessEnv): TtsTarget | null {
  return env.FISH_API_KEY
    ? { mode: "fish-audio", url: FISH_URL, key: env.FISH_API_KEY, wire: "msgpack" }
    : null;
}

/**
 * Resolve the backend chain.
 *
 * Precedence is explicit, never guessed: TTS_BACKEND names the backend, and
 * only a configured one is used. An unset TTS_BACKEND keeps the old behaviour
 * (fish when keyed, else browser), so adding Phonon changed nobody's setup.
 */
export function resolveTtsPlan(env: NodeJS.ProcessEnv): TtsPlan {
  const backend = env.TTS_BACKEND;

  if (backend === "phonon") {
    const primary: TtsTarget = {
      mode: "phonon",
      url: withTtsPath(env.PHONON_URL || DEFAULT_PHONON_URL),
      key: env.PHONON_KEY,
      wire: "json",
    };
    return { primary, fallback: fishTarget(env) ?? undefined };
  }

  if (backend === "self-hosted" && env.TTS_SELF_HOST_URL) {
    return {
      primary: {
        mode: "self-hosted",
        url: withTtsPath(env.TTS_SELF_HOST_URL),
        key: env.TTS_SELF_HOST_KEY,
        wire: "msgpack",
      },
      fallback: fishTarget(env) ?? undefined,
    };
  }

  return { primary: fishTarget(env) ?? BROWSER };
}

/** What the client is told the backend can do. */
export function capabilitiesFor(plan: TtsPlan): TtsCapabilities {
  const { mode } = plan.primary;
  return {
    mode,
    // Phonon's open checkpoints carry fixed voices and cannot clone locally,
    // so cloning is only offered when fish can actually serve it.
    cloning: mode === "fish-audio" || mode === "self-hosted",
  };
}
