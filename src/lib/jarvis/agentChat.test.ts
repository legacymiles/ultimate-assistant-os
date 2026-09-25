import { describe, expect, it } from "vitest";
import { FULL_IMAGES, TOTAL_IMAGES, traceLines, withImageBudget } from "./agentChat";
import type { ChatTurn } from "./types";

const you = (id: string, images: string[] = []): ChatTurn => ({
  id,
  role: "you",
  text: `q${id}`,
  at: "2026-01-01T00:00:00.000Z",
  ...(images.length ? { images } : {}),
});

const jarvis = (id: string): ChatTurn => ({
  id,
  role: "jarvis",
  text: `a${id}`,
  at: "2026-01-01T00:00:00.000Z",
});

describe("withImageBudget", () => {
  it("keeps the order of the conversation", () => {
    const wire = withImageBudget([you("1"), jarvis("2"), you("3")], new Map());
    expect(wire.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(wire.map((t) => t.content)).toEqual(["q1", "a2", "q3"]);
  });

  it("sends the newest pictures full size and the older ones as thumbnails", () => {
    const turns = [you("old", ["thumb-old"]), you("new", ["thumb-new"])];
    const full = new Map([
      ["old", ["full-old"]],
      ["new", ["full-new"]],
    ]);
    const wire = withImageBudget(turns, full);
    // Budgeting walks newest first, so the newest turn gets the full copy.
    expect(wire[1].images).toEqual(["full-new"]);
    expect(wire[0].images).toEqual(["full-old"]);
  });

  it("falls back to the thumbnail once the full-size budget is spent", () => {
    const turns = Array.from({ length: FULL_IMAGES + 2 }, (_, i) => you(`t${i}`, [`thumb${i}`]));
    const full = new Map(turns.map((t, i) => [t.id, [`full${i}`]]));
    const sent = withImageBudget(turns, full).flatMap((t) => t.images);
    expect(sent.filter((u) => u.startsWith("full"))).toHaveLength(FULL_IMAGES);
    expect(sent).toHaveLength(FULL_IMAGES + 2);
  });

  it("leaves the oldest pictures behind rather than blowing the request cap", () => {
    const turns = Array.from({ length: TOTAL_IMAGES + 3 }, (_, i) => you(`t${i}`, [`thumb${i}`]));
    const wire = withImageBudget(turns, new Map());
    const sent = wire.flatMap((t) => t.images);
    expect(sent).toHaveLength(TOTAL_IMAGES);
    // The ones dropped are the oldest, and their text still travels.
    expect(wire[0].images).toEqual([]);
    expect(wire[0].content).toBe("qt0");
    expect(wire[wire.length - 1].images).toEqual([`thumb${TOTAL_IMAGES + 2}`]);
  });

  it("never sends a picture on an assistant turn", () => {
    const answer = { ...jarvis("a"), images: ["thumb"] };
    expect(withImageBudget([answer], new Map())[0].images).toEqual([]);
  });
});

describe("traceLines", () => {
  it("drops empties and starts each step with a capital", () => {
    expect(traceLines(["searched memory for \"rent\" (2 found)", "  ", "ran gmail.list"])).toEqual([
      'Searched memory for "rent" (2 found)',
      "Ran gmail.list",
    ]);
  });

  it("has nothing to show when the agent answered on its own", () => {
    expect(traceLines(undefined)).toEqual([]);
    expect(traceLines([])).toEqual([]);
  });
});
