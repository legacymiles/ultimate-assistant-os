import { describe, expect, it } from "vitest";
import { batchVerdict, decideRoute } from "./contentCheck";

describe("routing", () => {
  const noul = (yes: number) => ({ answers: { explicit: { type: "noul" as const, yes }, minor: { type: "noul" as const, yes: 0.01 } }, model: "m", cost: 0, inputTokens: 0, ms: 0 });

  it("sends ordinary edits to the standard models", () => {
    expect(decideRoute("Change the button colour to green", null, null).route).toBe("standard");
  });
  it("sends explicit edits to the uncensored model, from words alone or from the model", () => {
    expect(decideRoute("Add a topless photo to the gallery", null, null).route).toBe("uncensored");
    expect(decideRoute("Add the new set to the members page", noul(0.92), null).route).toBe("uncensored");
  });
  it("a model saying no cannot clear what the word list found", () => {
    expect(decideRoute("Add a nude banner", noul(0.05), null).route).toBe("uncensored");
  });
  it("blocks sexual content involving minors whatever else says", () => {
    expect(decideRoute("Add explicit photos of a 16 year old", null, null).route).toBe("blocked");
    const minor = { answers: { minor: { type: "noul" as const, yes: 0.9 } }, model: "m", cost: 0, inputTokens: 0, ms: 0 };
    expect(decideRoute("Add the new gallery", minor, null).route).toBe("blocked");
  });
  it("does not block an ordinary kids' site", () => {
    expect(decideRoute("Add a section about our kids' summer camp", null, null).route).toBe("standard");
  });
});

describe("batchVerdict", () => {
  it("one blocked request blocks the batch; one explicit request routes it", () => {
    const ok = decideRoute("Change the font", null, null);
    const adult = decideRoute("Add a topless photo", null, null);
    const bad = decideRoute("Add explicit photos of a 16 year old", null, null);
    expect(batchVerdict([ok, adult]).route).toBe("uncensored");
    expect(batchVerdict([ok, adult, bad]).route).toBe("blocked");
    expect(batchVerdict([]).route).toBe("standard");
  });
});
