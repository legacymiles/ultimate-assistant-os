import { describe, expect, it } from "vitest";
import {
  DEFAULT_STUDIO_CHAIN,
  STUDIO_MODELS,
  cleanStudioChain,
  priceLabel,
  reorderChain,
  studioModel,
  toggleInChain,
} from "./models";

describe("the Studio's five", () => {
  it("are the five the owner named, in the order they named them", () => {
    expect(DEFAULT_STUDIO_CHAIN).toEqual([
      "qwen/qwen3.8-27b:free",
      "deepseek/deepseek-v4.1-flash",
      "openai/gpt-6-luna-pro",
      "qwen/qwen3.8-omni-flash",
      "xiaomi/mimo-v2.6-flash",
    ]);
  });

  it("start free", () => {
    const first = studioModel(DEFAULT_STUDIO_CHAIN[0])!;
    expect(priceLabel(first)).toBe("free");
  });

  // A film built on a reference clip or a track needs a model that can take one,
  // and only two of the five can.
  it("include at least two that can hear a track and watch a clip", () => {
    const omni = STUDIO_MODELS.filter((m) => m.reads.includes("audio") && m.reads.includes("video"));
    expect(omni.map((m) => m.id)).toEqual(["qwen/qwen3.8-omni-flash", "xiaomi/mimo-v2.6-flash"]);
  });

  it("have no duplicate ids", () => {
    const ids = STUDIO_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("cleaning a chain off the client", () => {
  it("drops anything not on the list, because this decides where credit is spent", () => {
    expect(cleanStudioChain(["anthropic/claude-opus-5", "qwen/qwen3.8-27b:free"])).toEqual(["qwen/qwen3.8-27b:free"]);
    expect(cleanStudioChain("not an array")).toEqual([]);
    expect(cleanStudioChain([1, null, {}])).toEqual([]);
  });

  // Every row in the picker must be a control that does something: a cap under
  // the list length leaves a row that silently vanishes on the first edit.
  it("drops duplicates, and keeps every model the picker shows", () => {
    expect(cleanStudioChain(["qwen/qwen3.8-27b:free", "qwen/qwen3.8-27b:free"])).toEqual(["qwen/qwen3.8-27b:free"]);
    expect(cleanStudioChain([...DEFAULT_STUDIO_CHAIN])).toEqual(DEFAULT_STUDIO_CHAIN);
    expect(cleanStudioChain([...DEFAULT_STUDIO_CHAIN, ...DEFAULT_STUDIO_CHAIN])).toHaveLength(STUDIO_MODELS.length);
  });

  it("keeps the owner's order rather than the catalogue's", () => {
    const reversed = [...DEFAULT_STUDIO_CHAIN].reverse().slice(0, 3);
    expect(cleanStudioChain(reversed)).toEqual(reversed);
  });
});

describe("reordering", () => {
  const chain = DEFAULT_STUDIO_CHAIN.slice(0, 3);

  it("swaps a model with its neighbour", () => {
    expect(reorderChain(chain, chain[1], -1)).toEqual([chain[1], chain[0], chain[2]]);
    expect(reorderChain(chain, chain[1], 1)).toEqual([chain[0], chain[2], chain[1]]);
  });

  it("does nothing at the ends, so the buttons never rotate the list", () => {
    expect(reorderChain(chain, chain[0], -1)).toBe(chain);
    expect(reorderChain(chain, chain[2], 1)).toBe(chain);
  });

  it("ignores a model that is not in the chain", () => {
    expect(reorderChain(chain, "xiaomi/mimo-v2.6-flash", -1)).toBe(chain);
  });
});

describe("adding and removing", () => {
  it("removes one that is in, and adds one that is not", () => {
    const two = DEFAULT_STUDIO_CHAIN.slice(0, 2);
    expect(toggleInChain(two, two[0])).toEqual([two[1]]);
    expect(toggleInChain(two, "xiaomi/mimo-v2.6-flash")).toEqual([...two, "xiaomi/mimo-v2.6-flash"]);
  });

  // Inserting into the middle would silently change which model answers next.
  it("adds at the end, not back in its catalogue position", () => {
    const skipped = ["openai/gpt-6-luna-pro", "xiaomi/mimo-v2.6-flash"];
    expect(toggleInChain(skipped, "qwen/qwen3.8-27b:free")).toEqual([...skipped, "qwen/qwen3.8-27b:free"]);
  });

  it("refuses to grow past the list it shows", () => {
    const full = [...DEFAULT_STUDIO_CHAIN];
    expect(toggleInChain(full, "xiaomi/mimo-v2.6-flash")).toEqual(full.filter((m) => m !== "xiaomi/mimo-v2.6-flash"));
    expect(cleanStudioChain(full)).toHaveLength(STUDIO_MODELS.length);
  });

  it("ignores an unknown id", () => {
    const two = DEFAULT_STUDIO_CHAIN.slice(0, 2);
    expect(toggleInChain(two, "anthropic/claude-opus-5")).toBe(two);
  });
});
