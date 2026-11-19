import { describe, expect, it } from "vitest";
import { capabilitiesFor, resolveTtsPlan } from "./backend";

/** Only the env keys the resolver reads — nothing inherited from the shell. */
function env(vars: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

describe("resolveTtsPlan", () => {
  it("falls back to browser voices with nothing configured", () => {
    const plan = resolveTtsPlan(env());
    expect(plan.primary.mode).toBe("browser");
    expect(plan.fallback).toBeUndefined();
    expect(capabilitiesFor(plan)).toEqual({ mode: "browser", cloning: false });
  });

  it("uses fish when keyed and no backend is named", () => {
    const plan = resolveTtsPlan(env({ FISH_API_KEY: "k" }));
    expect(plan.primary.mode).toBe("fish-audio");
    expect(plan.primary.url).toBe("https://api.fish.audio/v1/tts");
    expect(plan.primary.wire).toBe("msgpack");
    expect(capabilitiesFor(plan).cloning).toBe(true);
  });

  it("prefers phonon when named, on its default local port", () => {
    const plan = resolveTtsPlan(env({ TTS_BACKEND: "phonon" }));
    expect(plan.primary.mode).toBe("phonon");
    expect(plan.primary.url).toBe("http://127.0.0.1:8123/v1/tts");
    expect(plan.primary.wire).toBe("json");
  });

  it("keeps fish as the net behind phonon when a key exists", () => {
    const plan = resolveTtsPlan(env({ TTS_BACKEND: "phonon", FISH_API_KEY: "k" }));
    expect(plan.primary.mode).toBe("phonon");
    expect(plan.fallback?.mode).toBe("fish-audio");
  });

  it("has no net behind phonon without a fish key", () => {
    const plan = resolveTtsPlan(env({ TTS_BACKEND: "phonon" }));
    expect(plan.fallback).toBeUndefined();
  });

  it("never offers cloning on phonon — its open checkpoints cannot", () => {
    const plan = resolveTtsPlan(env({ TTS_BACKEND: "phonon", FISH_API_KEY: "k" }));
    expect(capabilitiesFor(plan)).toEqual({ mode: "phonon", cloning: false });
  });

  it("honours PHONON_URL and does not double up the /v1/tts path", () => {
    expect(resolveTtsPlan(env({ TTS_BACKEND: "phonon", PHONON_URL: "http://box:9000" })).primary.url).toBe(
      "http://box:9000/v1/tts",
    );
    expect(
      resolveTtsPlan(env({ TTS_BACKEND: "phonon", PHONON_URL: "http://box:9000/v1/tts" })).primary.url,
    ).toBe("http://box:9000/v1/tts");
    expect(resolveTtsPlan(env({ TTS_BACKEND: "phonon", PHONON_URL: "http://box:9000/" })).primary.url).toBe(
      "http://box:9000/v1/tts",
    );
  });

  it("carries PHONON_KEY through as the bearer token", () => {
    const plan = resolveTtsPlan(env({ TTS_BACKEND: "phonon", PHONON_KEY: "secret" }));
    expect(plan.primary.key).toBe("secret");
  });

  it("still resolves the old self-hosted backend, msgpack and all", () => {
    const plan = resolveTtsPlan(
      env({ TTS_BACKEND: "self-hosted", TTS_SELF_HOST_URL: "http://fish-box:8080", FISH_API_KEY: "k" }),
    );
    expect(plan.primary.mode).toBe("self-hosted");
    expect(plan.primary.url).toBe("http://fish-box:8080/v1/tts");
    expect(plan.primary.wire).toBe("msgpack");
    expect(plan.fallback?.mode).toBe("fish-audio");
  });

  it("ignores self-hosted with no URL and uses the fish key instead", () => {
    const plan = resolveTtsPlan(env({ TTS_BACKEND: "self-hosted", FISH_API_KEY: "k" }));
    expect(plan.primary.mode).toBe("fish-audio");
  });

  it("ignores an unknown TTS_BACKEND rather than guessing", () => {
    expect(resolveTtsPlan(env({ TTS_BACKEND: "whisper" })).primary.mode).toBe("browser");
    expect(resolveTtsPlan(env({ TTS_BACKEND: "whisper", FISH_API_KEY: "k" })).primary.mode).toBe(
      "fish-audio",
    );
  });
});
