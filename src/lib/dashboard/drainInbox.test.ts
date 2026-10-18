import { describe, expect, it } from "vitest";
import { CLAIM_BATCH_BYTES, CLAIM_BATCH_MAX, claimBatches } from "./drainInbox";

describe("claimBatches", () => {
  it("keeps every batch under the response budget", () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, bytes: 600_000 }));
    const batches = claimBatches(entries);
    expect(batches.flat().map((e) => e.id)).toEqual(entries.map((e) => e.id));
    for (const b of batches) {
      expect(b.reduce((n, e) => n + e.bytes, 0)).toBeLessThanOrEqual(CLAIM_BATCH_BYTES);
      expect(b.length).toBeLessThanOrEqual(CLAIM_BATCH_MAX);
    }
    // base64 inflates by 4/3; a full batch must still fit Vercel's 4.5 MB.
    expect((CLAIM_BATCH_BYTES * 4) / 3).toBeLessThan(4_500_000);
  });

  it("gives an oversized photo a batch of its own", () => {
    const batches = claimBatches([
      { id: "a", bytes: 100_000 },
      { id: "big", bytes: 5_000_000 },
      { id: "b", bytes: 100_000 },
    ]);
    expect(batches.map((b) => b.map((e) => e.id))).toEqual([["a"], ["big"], ["b"]]);
  });

  it("budgets photos with no size and caps the count", () => {
    const batches = claimBatches(Array.from({ length: 13 }, (_, i) => ({ id: `n${i}`, bytes: 10 })));
    expect(batches.map((b) => b.length)).toEqual([6, 6, 1]);
    expect(claimBatches([{ id: "x" }, { id: "y" }, { id: "z" }, { id: "w" }])).toHaveLength(2);
  });

  it("returns nothing for an empty inbox", () => {
    expect(claimBatches([])).toEqual([]);
  });
});
