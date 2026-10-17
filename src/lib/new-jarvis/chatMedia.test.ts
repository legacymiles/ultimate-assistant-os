import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/jarvis/chatImages", () => ({ toAttachment: vi.fn() }));

import { MEDIA_BUDGET, buildUserContent, type ChatMedia } from "./chatMedia";
import { isModelId, modelLabel } from "./chatModels";
import { revive } from "./persist";

const img = (id: string, size: number): ChatMedia => ({
  id,
  kind: "image",
  name: `${id}.jpg`,
  thumb: "t",
  parts: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64," + "a".repeat(size) } }],
  note: "",
});
const rec = (id: string, size: number): ChatMedia => ({
  id,
  kind: "audio",
  name: `${id}.m4a`,
  thumb: "t",
  parts: [{ type: "input_audio", input_audio: { data: "b".repeat(size), format: "wav" } }],
  note: "measured facts",
});

describe("buildUserContent", () => {
  it("is plain text with nothing attached", () => {
    expect(buildUserContent("hi", []).content).toBe("hi");
  });

  it("puts the words first, numbers each attachment, then the media", () => {
    const { content } = buildUserContent("what is this?", [img("a", 10), rec("b", 10)]);
    expect(Array.isArray(content)).toBe(true);
    const parts = content as Exclude<typeof content, string>;
    expect(parts[0].type).toBe("text");
    expect((parts[0] as { text: string }).text).toMatch(/what is this\?[\s\S]*Attachment 1: image[\s\S]*Attachment 2: audio "b.m4a"\] measured facts/);
    expect(parts.slice(1).map((p) => p.type)).toEqual(["image_url", "input_audio"]);
  });

  it("drops sound before pictures to fit the request, and says so", () => {
    const big = Math.floor(MEDIA_BUDGET * 0.6);
    const { content, trimmed } = buildUserContent("", [img("a", big), rec("b", big)]);
    const parts = content as Exclude<typeof content, string>;
    expect(parts.map((p) => p.type)).toEqual(["text", "image_url"]);
    expect(trimmed[0]).toMatch(/b\.m4a: sound left out/);
    expect((parts[0] as { text: string }).text).toMatch(/Look at what I attached[\s\S]*Too big to send whole/);
  });
});

describe("chat model ids", () => {
  it("accepts OpenRouter-shaped ids only", () => {
    expect(isModelId("deepseek/deepseek-v4.1-flash")).toBe(true);
    expect(isModelId("qwen/qwen3.8-27b:free")).toBe(true);
    expect(isModelId("")).toBe(false);
    expect(isModelId("no-slash")).toBe(false);
    expect(isModelId("a/b c")).toBe(false);
    expect(isModelId("https://evil.example/x")).toBe(false);
  });
  it("labels presets, and anything else by its name", () => {
    expect(modelLabel("")).toBe("Claude · cloud");
    expect(modelLabel("claude-subscription")).toBe("Claude · my subscription");
    expect(isModelId("claude-subscription")).toBe(false); // never sent to the cloud route
    expect(modelLabel("deepseek/deepseek-v4.1-flash")).toBe("DeepSeek V4.1 Flash");
    expect(modelLabel("vendor/some-model")).toBe("some-model");
  });
});

describe("stored blocks", () => {
  it("keep attachment previews and the model, and older blocks still load", () => {
    const [b] = revive([{ id: "b1", command: "x", status: "done", steps: [], media: [{ kind: "audio", name: "memo", thumb: "data:x" }], model: "deepseek/deepseek-v4.1-flash" }]);
    expect(b.media).toEqual([{ kind: "audio", name: "memo", thumb: "data:x" }]);
    expect(b.model).toBe("deepseek/deepseek-v4.1-flash");
    const [old] = revive([{ id: "b0", command: "y", status: "done", steps: [] }]);
    expect(old.media).toBeUndefined();
  });
});
