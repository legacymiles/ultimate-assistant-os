import { describe, expect, it } from "vitest";
import { fromOldBoard } from "./fromOldBoard";
import type { Tool } from "./types";

function tool(p: Partial<Tool>): Tool {
  return {
    id: "t", name: "X", url: "https://x.example", summary: "", group: "AI", category: "Voice", tags: [],
    access: "free", openSource: true, hosting: "self-host", apiKey: "none", haveKey: false, features: [],
    addedAt: "2026-05-04T10:00:00.000Z", updatedAt: "2026-05-04T10:00:00.000Z", ...p,
  };
}

describe("fromOldBoard", () => {
  it("brings AI records across and counts the rest instead of losing them", () => {
    const r = fromOldBoard([
      tool({ name: "Kokoro", url: "https://huggingface.co/hexgrad/Kokoro-82M", rank: 2 }),
      tool({ name: "VS Code", group: "Dev", category: "Editors" }),
      tool({ name: "No link", url: "" }),
    ]);
    expect(r.skipped).toBe(2);
    expect(r.models).toHaveLength(1);
    expect(r.models[0]).toMatchObject({
      name: "Kokoro", category: "tts", hfId: "hexgrad/Kokoro-82M", runsLocally: true, myRating: 9, releasedAt: "2026-05-04",
    });
  });

  it("maps the old seed categories to the new ones", () => {
    const cats = ["LLM", "Image", "Video", "Music", "Agent Coding", "3D", "Tools"].map(
      (c) => fromOldBoard([tool({ category: c })]).models[0]?.category,
    );
    expect(cats).toEqual(["llm", "image", "text-to-video", "music", "coding-agents", "3d", "platforms"]);
  });

  it("keeps the features worth showing and the owner's notes", () => {
    const r = fromOldBoard([
      tool({ notes: "Best local voice", features: [
        { id: "1", text: "Voice cloning", verdict: "love" },
        { id: "2", text: "No streaming", verdict: "miss" },
      ] }),
    ]);
    expect(r.models[0]).toMatchObject({ features: ["Voice cloning"], note: "Best local voice" });
  });
});
