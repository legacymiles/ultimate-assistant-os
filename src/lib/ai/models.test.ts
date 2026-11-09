import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The catalogue the hub offers, and the one question the provider asks it.
 *
 * Two things are being pinned here. OrcaRouter's model has to be offered even
 * though OpenRouter's list knows nothing about it — otherwise the picker cannot
 * name the model the owner asked for. And its modalities have to be right,
 * because `canRead` is what stops a text-only request being handed a model that
 * cannot see the picture attached to it (and the reverse).
 */
describe("the model catalogue", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            {
              id: "openai/gpt-6-luna-pro",
              name: "GPT-6 Luna Pro",
              architecture: { input_modalities: ["text", "image", "file"], output_modalities: ["text"] },
              pricing: { prompt: "0.0000001", completion: "0.0000005" },
              context_length: 1_050_000,
              supported_parameters: ["response_format"],
              created: 2,
            },
          ],
        }),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers OrcaRouter's model first, then OpenRouter's own", async () => {
    const { listModels } = await import("./models");
    const ids = (await listModels()).map((m) => m.id);
    expect(ids[0]).toBe("orca/orcacyber-flash-1.0");
    expect(ids).toContain("openai/gpt-6-luna-pro");
  });

  it("does not offer it twice when OpenRouter starts serving it too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            {
              id: "orca/orcacyber-flash-1.0",
              name: "Mirrored",
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              pricing: { prompt: "0", completion: "0" },
              context_length: 1000,
              supported_parameters: [],
              created: 1,
            },
          ],
        }),
      ),
    );
    const { listModels } = await import("./models");
    const list = await listModels();
    expect(list.filter((m) => m.id === "orca/orcacyber-flash-1.0")).toHaveLength(1);
  });

  it("knows the abliterated DeepSeek reads pictures but not audio", async () => {
    const { canRead } = await import("./models");
    expect(await canRead("orca/orcacyber-flash-1.0", new Set(["image"]))).toBe(true);
    expect(await canRead("orca/orcacyber-flash-1.0", new Set(["audio"]))).toBe(false);
  });

  it("falls back to OrcaRouter's entry when OpenRouter cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const { listModels } = await import("./models");
    expect((await listModels()).map((m) => m.id)).toEqual(["orca/orcacyber-flash-1.0", "orca/orcacyber-k3.1-pro"]);
  });
});
