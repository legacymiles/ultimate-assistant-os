import { describe, expect, it } from "vitest";
import { parseRead, readSystem, readUser } from "./prompt";
import { numbersFor, type Account, type Setup } from "./setup";

const setup: Setup = {
  instrument: "NAS100",
  direction: "long",
  entry: 18000,
  stop: 17800,
  target: 18600,
  timeframe: "4h",
  thesis: "Held the prior week's high on the retest.",
};
const account: Account = { size: 25_000, riskPct: 1 };

const good = {
  restated: "You are betting the retest holds and the move continues.",
  assumes: ["The prior week's high is still the level buyers defend.", "Volume confirms the retest."],
  invalidatedBy: ["A close back below the level on the 4h.", "The retest failing on rising volume."],
  pushback: ["The thesis treats one touch as confirmation."],
  unanswered: ["You do not say what happens if it ranges for a week."],
};

describe("the system prompt", () => {
  const s = readSystem();

  it("forbids the three things this app must not do", () => {
    expect(s).toMatch(/Never recommend taking, avoiding/);
    expect(s).toMatch(/Never predict a price/);
    expect(s).toMatch(/Never discuss placing, modifying or closing orders/);
  });

  it("tells the model the arithmetic is not its job", () => {
    expect(s).toMatch(/Do not restate the arithmetic/);
  });

  it("names the exact JSON keys the parser reads", () => {
    for (const k of ["restated", "assumes", "invalidatedBy", "pushback", "unanswered"]) {
      expect(s).toContain(k);
    }
  });
});

describe("the user prompt", () => {
  it("hands over the computed figures as fact", () => {
    const text = readUser(setup, numbersFor(setup, account));
    expect(text).toMatch(/do not recompute or restate: 3\.00:1/);
    expect(text).toMatch(/breakeven win rate 25%/);
  });

  it("carries the thesis verbatim", () => {
    expect(readUser(setup, numbersFor(setup, account))).toContain(setup.thesis);
  });

  it("says so rather than inventing one when no thesis was written", () => {
    expect(readUser({ ...setup, thesis: "   " }, null)).toContain("(they wrote none)");
  });

  it("leaves the computed line out entirely when the numbers do not compute", () => {
    expect(readUser(setup, null)).not.toMatch(/do not recompute/);
  });
});

describe("parseRead", () => {
  it("reads a bare JSON answer", () => {
    expect(parseRead(JSON.stringify(good))?.restated).toBe(good.restated);
  });

  it("digs the answer out of prose and fences", () => {
    const wrapped = "Sure, here you go:\n```json\n" + JSON.stringify(good) + "\n```\nHope that helps.";
    expect(parseRead(wrapped)?.assumes).toHaveLength(2);
  });

  it("caps each list at four entries", () => {
    const many = { ...good, assumes: ["a", "b", "c", "d", "e", "f"] };
    expect(parseRead(JSON.stringify(many))?.assumes).toHaveLength(4);
  });

  it("drops blanks and non-strings rather than rendering them", () => {
    const messy = { ...good, pushback: ["real", "   ", 42, null, "also real"] };
    expect(parseRead(JSON.stringify(messy))?.pushback).toEqual(["real", "also real"]);
  });

  it("returns null on a model that gave up, so the UI can say the call failed", () => {
    // One list filled is not a read: rendering it would read as "the agent had
    // nothing to say about your assumptions", which is a flattering lie.
    expect(parseRead(JSON.stringify({ restated: "You are long.", assumes: ["one"] }))).toBeNull();
    expect(parseRead(JSON.stringify({ ...good, restated: "" }))).toBeNull();
  });

  it("returns null on anything that is not JSON", () => {
    expect(parseRead("I'm sorry, I can't help with that.")).toBeNull();
    expect(parseRead("")).toBeNull();
    expect(parseRead("{ not json at all }")).toBeNull();
  });

  it("truncates a runaway entry instead of letting it break the layout", () => {
    const long = { ...good, unanswered: ["x".repeat(900), "short one"] };
    expect(parseRead(JSON.stringify(long))!.unanswered[0].length).toBe(400);
  });
});
