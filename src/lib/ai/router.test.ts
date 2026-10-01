import { describe, expect, it } from "vitest";
import { ROUTER_MODELS, capable, difficultyOf, isLong, planRoute, readRequest, routerModel } from "./router";

/** A chat-completions body, as a route in this hub would build one. */
function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { model: "anthropic/claude-opus-5", messages: [{ role: "user", content: "Tag this note." }], ...over };
}

function text(n: number): string {
  return "x".repeat(n);
}

const plan = (over: Record<string, unknown> = {}) => planRoute(readRequest(body(over)));

describe("reading a request", () => {
  it("finds every modality a body carries", () => {
    const req = readRequest(
      body({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "what is in these" },
              { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
              { type: "input_audio", input_audio: { data: "AAAA", format: "mp3" } },
              { type: "video_url", video_url: { url: "https://example.com/a.mp4" } },
              { type: "file", file: { filename: "a.pdf", file_data: "AAAA" } },
            ],
          },
        ],
      }),
    );
    expect(req.need.sort()).toEqual(["audio", "file", "image", "video"]);
  });

  it("does not count a base64 image as prompt text", () => {
    // The trap this guards: a 2MB data URL is 2 million characters. Counted as
    // text it would read as the hardest question in the hub and route a photo
    // tag to the reasoning model.
    const req = readRequest(
      body({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "tag it" },
              { type: "image_url", image_url: { url: `data:image/png;base64,${text(2_000_000)}` } },
            ],
          },
        ],
      }),
    );
    expect(req.chars).toBe(6);
    expect(difficultyOf(req)).toBe("simple");
  });

  it("counts the fields of a requested schema, however deep", () => {
    const req = readRequest(
      body({
        response_format: {
          type: "json_schema",
          json_schema: {
            schema: {
              type: "object",
              properties: {
                a: { type: "string" },
                b: { type: "object", properties: { c: { type: "string" }, d: { type: "string" } } },
              },
            },
          },
        },
      }),
    );
    expect(req.json).toBe(true);
    expect(req.schemaFields).toBe(4);
  });
});

describe("how hard it is", () => {
  it("treats ordinary short work as simple", () => {
    expect(difficultyOf(readRequest(body()))).toBe("simple");
  });

  it("reads structure, not words: two questions with the same keywords rank the same", () => {
    const why = (q: string) => difficultyOf(readRequest(body({ messages: [{ role: "user", content: q }] })));
    expect(why("why did my deploy fail")).toBe(why("why is the sky blue"));
  });

  // Tools are NOT a signal: the chat and the Studio agent always carry them, and
  // counting them meant neither ever reached the free rung.
  it("does not escalate a request just because it carries tools", () => {
    expect(difficultyOf(readRequest(body({ tools: [{ type: "function", function: { name: "f" } }] })))).toBe("simple");
    expect(plan({ tools: [{ type: "function", function: { name: "f" } }] }).models[0]).toBe("qwen/qwen3.8-27b:free");
  });

  it("counts a long conversation and a chapter-length prompt", () => {
    expect(difficultyOf(readRequest(body({ messages: Array(9).fill({ role: "user", content: "hi" }) })))).toBe("harder");
    expect(difficultyOf(readRequest(body({ messages: [{ role: "user", content: text(7_000) }] })))).toBe("harder");
    expect(difficultyOf(readRequest(body({ messages: [{ role: "user", content: text(41_000) }] })))).toBe("hardest");
    expect(difficultyOf(readRequest(body({ reasoning: { effort: "high" } })))).toBe("hardest");
  });

  it("lets a caller declare what the heuristic cannot see", () => {
    expect(difficultyOf(readRequest(body({ task: { difficulty: "hardest" } })))).toBe("hardest");
    expect(isLong(readRequest(body({ task: { long: true } })))).toBe(true);
  });

  // 8000 is the Studio agent's ordinary budget for a shot table. A threshold on
  // it would hand every Studio call to the router model.
  it("calls a request long only when it asks for an answer bigger than this hub's ordinary ceiling", () => {
    expect(isLong(readRequest(body({ max_tokens: 20_000 })))).toBe(true);
    expect(isLong(readRequest(body({ max_tokens: 8_000 })))).toBe(false);
    expect(isLong(readRequest(body({ max_tokens: 2_000 })))).toBe(false);
  });
});

describe("the owner's rules", () => {
  it("sends ordinary text to the free model", () => {
    expect(plan().models[0]).toBe("qwen/qwen3.8-27b:free");
  });

  it("sends an image or a video prompt to the free model too, because it is free", () => {
    const withImage = plan({
      messages: [{ role: "user", content: [{ type: "text", text: "a" }, { type: "image_url", image_url: { url: "u" } }] }],
    });
    const withVideo = plan({
      messages: [{ role: "user", content: [{ type: "text", text: "a" }, { type: "video_url", video_url: { url: "u" } }] }],
    });
    expect(withImage.models[0]).toBe("qwen/qwen3.8-27b:free");
    expect(withVideo.models[0]).toBe("qwen/qwen3.8-27b:free");
  });

  it("sends audio to the free model that listens", () => {
    const p = plan({
      messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: "A", format: "mp3" } }] }],
    });
    expect(p.models[0]).toBe("thinkingmachines/inkling:free");
  });

  it("sends a bit more complicated to DeepSeek", () => {
    expect(plan({ task: { difficulty: "harder" } }).models[0]).toBe("deepseek/deepseek-v4.1-flash");
  });

  it("sends the hardest questions to Luna Pro", () => {
    expect(plan({ task: { difficulty: "hardest" } }).models[0]).toBe("openai/gpt-6-luna-pro");
  });

  it("sends audio AND video in one prompt to the model that reads all four", () => {
    const p = plan({
      messages: [
        {
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: "A", format: "mp3" } },
            { type: "video_url", video_url: { url: "u" } },
          ],
        },
      ],
    });
    expect(p.models[0]).toBe("xiaomi/mimo-v2.6-flash");
  });

  it("gives a task that could take too long to Jev", () => {
    expect(plan({ task: { long: true } }).models[0]).toBe("typesafe/jev-router");
    expect(plan({ max_tokens: 20_000 }).models[0]).toBe("typesafe/jev-router");
    expect(plan({ max_tokens: 8_000 }).models[0]).not.toBe("typesafe/jev-router");
  });
});

describe("what outranks what", () => {
  it("strict JSON beats free, because neither free model has a JSON mode", () => {
    const p = plan({ response_format: { type: "json_object" } });
    expect(p.models[0]).toBe("deepseek/deepseek-v4.1-flash");
    expect(p.why).toContain("no JSON mode");
    // And the free models never appear as a retry either — they would fail the
    // same way the pick would have.
    expect(p.models).not.toContain("qwen/qwen3.8-27b:free");
    expect(p.models).not.toContain("thinkingmachines/inkling:free");
  });

  it("a modality the tier cannot read beats the difficulty", () => {
    // Luna Pro is the hardest-question model and cannot watch video.
    const p = plan({
      task: { difficulty: "hardest" },
      messages: [{ role: "user", content: [{ type: "video_url", video_url: { url: "u" } }] }],
    });
    expect(p.models[0]).not.toBe("openai/gpt-6-luna-pro");
    expect(routerModel(p.models[0])!.reads).toContain("video");
    expect(p.why).toContain("cannot read");
  });

  it("audio plus strict JSON skips the free listener and lands on the all-four model", () => {
    const p = plan({
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: "A", format: "mp3" } }] }],
    });
    expect(p.models[0]).toBe("xiaomi/mimo-v2.6-flash");
  });

  it("a prompt too big for the free window moves up rather than failing", () => {
    // 262k tokens of context, so ~1.05M characters is past it.
    const p = plan({ messages: [{ role: "user", content: text(1_200_000) }] });
    expect(p.models[0]).not.toBe("qwen/qwen3.8-27b:free");
    expect(routerModel(p.models[0])!.context).toBeGreaterThan(262_144);
  });

  it("every plan names at least one model, and only models it can actually use", () => {
    const awkward = plan({
      response_format: { type: "json_schema", json_schema: { schema: { type: "object", properties: { a: {} } } } },
      messages: [
        {
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: "A", format: "mp3" } },
            { type: "video_url", video_url: { url: "u" } },
            { type: "file", file: { filename: "a.pdf", file_data: "A" } },
          ],
        },
      ],
    });
    expect(awkward.models.length).toBeGreaterThan(0);
    const req = readRequest(
      body({
        response_format: { type: "json_schema", json_schema: { schema: { type: "object", properties: { a: {} } } } },
        messages: [
          {
            role: "user",
            content: [
              { type: "input_audio", input_audio: { data: "A", format: "mp3" } },
              { type: "video_url", video_url: { url: "u" } },
              { type: "file", file: { filename: "a.pdf", file_data: "A" } },
            ],
          },
        ],
      }),
    );
    for (const id of awkward.models) expect(capable(routerModel(id)!, req)).toBe(true);
  });
});

describe("retries", () => {
  it("never drops below the rank that was picked", () => {
    const p = plan({ task: { difficulty: "hardest" } });
    const picked = routerModel(p.models[0])!;
    for (const id of p.models.slice(1)) {
      expect(routerModel(id)!.rank).toBeGreaterThanOrEqual(picked.rank);
    }
  });

  it("gives the free tier somewhere to go when it is rate-limited", () => {
    const p = plan();
    expect(p.models.length).toBeGreaterThan(1);
    expect(p.models[1]).not.toBe(p.models[0]);
  });
});

describe("the ladder itself", () => {
  it("has one model per rung and no duplicate ids", () => {
    const tiers = ROUTER_MODELS.map((m) => m.tier);
    expect(new Set(tiers).size).toBe(tiers.length);
    const ids = ROUTER_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ends with a model that reads everything, so nothing can dead-end", () => {
    const universal = ROUTER_MODELS.filter(
      (m) => m.json && (["image", "audio", "video"] as const).every((n) => m.reads.includes(n)),
    );
    expect(universal.length).toBeGreaterThan(0);
  });
});
