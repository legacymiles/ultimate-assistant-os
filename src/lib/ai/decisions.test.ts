import { describe, expect, it } from "vitest";
import { buildDecisionBody, confidentChoice, readDecisionResponse, yesNo } from "./decisions";

const sample = {
  id: "gen-dec-1",
  model: "typesafe/jev-1.13-20260917",
  answers: {
    is_bug: { type: "noul", noul: 0.96 },
    team: { type: "choice", choice: "payments", confidence: 0.67, probabilities: { payments: 0.78, frontend: 0.22 } },
    urgency: { type: "score", score: 1.99, confidence: 0.99, probabilities: { "0": 0, "1": 0, "2": 1 } },
    junk: { type: "choice", choice: 5 },
  },
  usage: { input_tokens: 476, output_tokens: 70, cost: 0.00002 },
};

describe("readDecisionResponse", () => {
  it("reads all three answer types and the usage", () => {
    const r = readDecisionResponse(sample, 120);
    expect(r.answers.is_bug).toEqual({ type: "noul", yes: 0.96 });
    expect(r.answers.team).toMatchObject({ type: "choice", choice: "payments", confidence: 0.67 });
    expect(r.answers.urgency).toMatchObject({ type: "score", score: 1.99 });
    expect(r.cost).toBe(0.00002);
    expect(r.inputTokens).toBe(476);
    expect(r.ms).toBe(120);
  });

  it("leaves out malformed answers instead of guessing", () => {
    expect(readDecisionResponse(sample).answers.junk).toBeUndefined();
    expect(readDecisionResponse(null).answers).toEqual({});
  });
});

describe("reading answers safely", () => {
  const r = readDecisionResponse(sample);
  it("only returns a choice above the confidence bar", () => {
    expect(confidentChoice(r, "team", 0.6)).toBe("payments");
    expect(confidentChoice(r, "team", 0.8)).toBeNull();
    expect(confidentChoice(null, "team")).toBeNull();
  });
  it("keeps a wide unsure band for yes/no", () => {
    expect(yesNo(r, "is_bug")).toBe("yes");
    expect(yesNo(readDecisionResponse({ answers: { x: { type: "noul", noul: 0.5 } } }), "x")).toBe("unsure");
    expect(yesNo(r, "missing")).toBe("unsure");
  });
});

describe("buildDecisionBody", () => {
  it("drops questions the model cannot answer", () => {
    const body = buildDecisionBody({
      model: "respan/span-01-lite:free",
      state: { text: "x".repeat(20_000) },
      questions: {
        flag: { type: "noul", instructions: "?", criteria: { true: "a", false: "b" } },
        path: { type: "choice", instructions: "?", criteria: { a: "a", b: "b" } },
      },
    });
    expect(Object.keys(body.questions)).toEqual(["flag"]);
    expect((body.state.text as string).length).toBe(8_000);
  });
});
