import { describe, expect, it } from "vitest";
import { applyAction, cleanModel } from "./boardActions";
import { EMPTY_BOARD } from "./leaderboard";
import type { InboxItem, PublicBoard } from "./leaderboard";

const NOW = "2026-11-08T12:00:00.000Z";

const item: InboxItem = {
  id: "hf:lab/New-Voice", hfId: "lab/New-Voice", name: "New-Voice", maker: "lab", category: "tts",
  url: "https://huggingface.co/lab/New-Voice", releasedAt: "2026-11-02", likes: 300, downloads: 50,
  license: "apache-2.0", pipeline: "text-to-speech", foundAt: NOW,
};

function withModel(): PublicBoard {
  const r = applyAction(EMPTY_BOARD, { type: "upsert", model: { name: "Kokoro", category: "tts", url: "huggingface.co/hexgrad/Kokoro-82M", hfId: "hexgrad/Kokoro-82M" } }, NOW);
  if (!r.ok) throw new Error(r.error);
  return { ...r.board, inbox: [item] };
}

describe("cleanModel", () => {
  it("refuses a model with no name, category or link, in plain words", () => {
    expect(cleanModel({ category: "tts", url: "https://x.com" }, NOW)).toBe("Give it a name.");
    expect(cleanModel({ name: "X", category: "spreadsheets", url: "https://x.com" }, NOW)).toBe("Pick a category.");
    expect(cleanModel({ name: "X", category: "tts", url: "javascript:alert(1)" }, NOW)).toBe("Add a link to its page.");
  });

  it("keeps ratings to 1–10 in half steps and drops nonsense scores", () => {
    const m = cleanModel({ name: "X", category: "tts", url: "https://x.com", myRating: 8.26, publicScore: { value: Number.NaN } as never }, NOW);
    expect(typeof m).toBe("object");
    if (typeof m === "object") {
      expect(m.myRating).toBe(8.5);
      expect(m.publicScore).toBeUndefined();
    }
    const bad = cleanModel({ name: "X", category: "tts", url: "https://x.com", myRating: 40 }, NOW);
    expect(typeof bad === "object" && bad.myRating).toBeUndefined();
  });
});

describe("applyAction", () => {
  it("refuses a duplicate add", () => {
    const r = applyAction(withModel(), { type: "upsert", model: { name: "kokoro", category: "tts", url: "https://other.example" } }, NOW);
    expect(r).toEqual({ ok: false, error: "Kokoro is already on the board." });
  });

  it("edits in place without changing when it was added", () => {
    const b = withModel();
    const id = b.models[0].id;
    const r = applyAction(b, { type: "upsert", model: { id, summary: "Tiny open TTS", myRating: 9 } }, "2026-12-01T00:00:00.000Z");
    expect(r.ok && r.board.models[0]).toMatchObject({ id, summary: "Tiny open TTS", myRating: 9, addedAt: NOW });
  });

  it("approves an inbox item into an open, local, free model and clears it from the inbox", () => {
    const r = applyAction(withModel(), { type: "approve", inboxId: item.id, category: "realtime-voice" }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.board.inbox).toHaveLength(0);
    expect(r.board.models[0]).toMatchObject({ name: "New Voice", category: "realtime-voice", openSource: true, runsLocally: true, access: "free", hfId: "lab/New-Voice", releasedAt: "2026-11-02" });
  });

  it("remembers dismissals so the sweep never offers them again", () => {
    const r = applyAction(withModel(), { type: "dismiss", inboxId: item.id }, NOW);
    expect(r.ok && r.board.dismissed).toEqual(["lab/New-Voice"]);
  });

  it("imports only what isn't on the board yet", () => {
    const r = applyAction(withModel(), {
      type: "import",
      models: [
        { name: "Kokoro", category: "tts", url: "https://huggingface.co/hexgrad/Kokoro-82M" },
        { name: "Brand new", category: "music", url: "https://music.example" },
        { name: "", category: "music", url: "https://broken.example" },
      ],
    }, NOW);
    expect(r.ok && r.message).toBe("Imported 1");
  });

  it("says so when the model was already deleted elsewhere", () => {
    expect(applyAction(EMPTY_BOARD, { type: "delete", id: "gone" }, NOW)).toEqual({ ok: false, error: "That model isn't on the board any more." });
  });
});
