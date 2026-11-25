import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { IDLE_MAX_MS, IDLE_MIN_MS, MOVES, moodOf, nextIdleMs, pickAfterLine, pickIdle } from "./moves";

const fixed = (v: number) => () => v;

describe("the clips and the choreography agree", () => {
  // The audiotypes are positions in tools/alex-moves/clips.json. If someone
  // reorders that file, Alex would wave when he should laugh — so check here.
  it("gives each move the audiotype its clip is installed under", () => {
    const spec = JSON.parse(readFileSync(resolve(__dirname, "../../../../tools/alex-moves/clips.json"), "utf8")) as {
      clips: { id: string; use: string; mood?: string }[];
    };
    const actions = spec.clips.filter((c) => c.use === "action");
    expect(actions.map((c, i) => ({ id: c.id, type: i + 2, mood: c.mood }))).toEqual(
      MOVES.map((m) => ({ id: m.id, type: m.type, mood: m.mood })),
    );
  });
});

describe("moodOf", () => {
  it("hears a greeting", () => {
    expect(moodOf("Hey, welcome back!")).toBe("greeting");
  });
  it("hears something funny", () => {
    expect(moodOf("Haha, that's hilarious")).toBe("happy");
  });
  it("hears surprise", () => {
    expect(moodOf("Wow, really? Tell me more")).toBe("curious");
  });
  it("hears him thinking it over", () => {
    expect(moodOf("Good question. It depends on the budget")).toBe("thinking");
  });
  it("leaves a plain line alone", () => {
    expect(moodOf("Your meeting is at four.")).toBeNull();
  });
  it("does not find a word inside another word", () => {
    expect(moodOf("This is a high priority.")).toBeNull();
  });
});

describe("pickAfterLine", () => {
  it("reacts to a line with a mood, most of the time", () => {
    expect(pickAfterLine("haha", fixed(0.1))?.id).toBe("laugh");
    expect(pickAfterLine("haha", fixed(0.9))).toBeNull();
  });
  it("only now and then sips after a plain line", () => {
    expect(pickAfterLine("Your meeting is at four.", fixed(0.05))?.id).toBe("sip");
    expect(pickAfterLine("Your meeting is at four.", fixed(0.5))).toBeNull();
  });
});

describe("pickIdle", () => {
  it("never waves or laughs at nobody", () => {
    for (let r = 0; r < 1; r += 0.05) expect(["sip", "think", "lean"]).toContain(pickIdle(null, fixed(r)).id);
  });
  it("does not repeat the last move", () => {
    for (let r = 0; r < 1; r += 0.05) expect(pickIdle("sip", fixed(r)).id).not.toBe("sip");
  });
});

describe("nextIdleMs", () => {
  it("stays inside the window", () => {
    expect(nextIdleMs(fixed(0))).toBe(IDLE_MIN_MS);
    expect(nextIdleMs(fixed(1))).toBe(IDLE_MAX_MS);
  });
});
