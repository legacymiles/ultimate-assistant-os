import { describe, expect, it } from "vitest";
import { EMPTY_BOARD } from "./leaderboard";
import type { Model, PublicBoard } from "./leaderboard";
import { isOriginal, mergeInbox, runSweep, suggestionsFrom } from "./sweep";
import type { HfModel } from "./sweep";

const NOW = new Date("2026-11-08T12:00:00Z").getTime();
const recent = "2026-11-01T00:00:00.000Z";

function hf(id: string, p: Partial<HfModel> = {}): HfModel {
  return { id, likes: 500, downloads: 100, createdAt: recent, tags: ["license:apache-2.0"], pipeline_tag: "text-to-speech", ...p };
}

describe("isOriginal", () => {
  it("drops quantisations and other people's fine-tunes", () => {
    expect(isOriginal(hf("someone/Kokoro-82M-GGUF"))).toBe(false);
    expect(isOriginal(hf("mlx-community/Kokoro-82M-4bit"))).toBe(false);
    expect(isOriginal(hf("fan/kokoro-tuned", { tags: ["base_model:finetune:hexgrad/Kokoro-82M"] }))).toBe(false);
    expect(isOriginal(hf("x/y", { private: true }))).toBe(false);
  });

  it("keeps a lab's tune of its own earlier model", () => {
    const m = hf("Edge0/Audio8-TTS-Realistic-Air", {
      tags: ["base_model:finetune:Edge0/Audio8-TTS-Preview-0.6b", "license:apache-2.0"],
    });
    expect(isOriginal(m)).toBe(true);
  });
});

describe("suggestionsFrom", () => {
  const onBoard: Model = {
    id: "k", name: "Kokoro-82M", maker: "hexgrad", category: "tts", url: "https://huggingface.co/hexgrad/Kokoro-82M",
    hfId: "hexgrad/Kokoro-82M", summary: "", releasedAt: "2025-01-01", addedAt: "", updatedAt: "",
    openSource: true, runsLocally: true, access: "free", features: [], tags: [],
  };
  const board: PublicBoard = { ...EMPTY_BOARD, models: [onBoard], dismissed: ["nope/Dismissed"] };

  it("keeps only new, noticed originals that aren't already known", () => {
    const list = [
      hf("lab/Brand-New-TTS"),
      hf("hexgrad/Kokoro-82M"),
      hf("nope/dismissed"),
      hf("lab/Too-Quiet", { likes: 3 }),
      hf("lab/Too-Old", { createdAt: "2026-01-01T00:00:00Z" }),
      hf("lab/No-Date", { createdAt: undefined }),
    ];
    const out = suggestionsFrom(list, "text-to-speech", "tts", board, NOW, new Set());
    expect(out.map((i) => i.hfId)).toEqual(["lab/Brand-New-TTS"]);
    expect(out[0]).toMatchObject({ name: "Brand-New-TTS", maker: "lab", license: "apache-2.0", releasedAt: "2026-11-01" });
  });

  it("never files the same repo twice across pipelines", () => {
    const seen = new Set<string>();
    const a = suggestionsFrom([hf("lab/Omni")], "audio-to-audio", "realtime-voice", board, NOW, seen);
    const b = suggestionsFrom([hf("lab/Omni")], "any-to-any", "realtime-voice", board, NOW, seen);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
  });
});

describe("runSweep", () => {
  it("reports pipelines that failed without losing the ones that worked", async () => {
    const fetcher = (async (url: string) => {
      if (String(url).includes("text-to-speech")) {
        return new Response(JSON.stringify([hf("lab/Fresh-Voice")]), { status: 200 });
      }
      if (String(url).includes("text-to-video")) return new Response("busy", { status: 503 });
      return new Response("[]", { status: 200 });
    }) as typeof fetch;
    const r = await runSweep(EMPTY_BOARD, fetcher, NOW);
    expect(r.added.map((i) => i.hfId)).toEqual(["lab/Fresh-Voice"]);
    expect(r.failed).toEqual(["text-to-video"]);
  });

  it("merges newest first", () => {
    const base = { ...EMPTY_BOARD, inbox: [{ id: "a", hfId: "a/a", name: "a", maker: "a", category: "tts", url: "", releasedAt: "2026-10-01", likes: 1, downloads: 0, pipeline: "", foundAt: "" }] };
    const merged = mergeInbox(base, [{ ...base.inbox[0], id: "b", hfId: "b/b", releasedAt: "2026-11-01" }]);
    expect(merged.map((i) => i.hfId)).toEqual(["b/b", "a/a"]);
  });
});
