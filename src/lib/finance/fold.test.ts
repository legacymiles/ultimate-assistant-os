import { describe, expect, it } from "vitest";
import { fold } from "./fold";
import type { Txn } from "./types";

function txn(over: Partial<Txn> = {}): Txn {
  return {
    id: "t1",
    accountId: "a1",
    date: "2026-09-12",
    amount: 9.99,
    currency: "GBP",
    merchantRaw: "SPOTIFY",
    merchantNorm: "spotify",
    pending: false,
    pendingTxnId: null,
    removedAt: null,
    category: null,
    ...over,
  };
}

describe("fold", () => {
  it("drops the pending row when its posted twin is present", () => {
    const pending = txn({ id: "pend-1", pending: true });
    const posted = txn({ id: "post-1", pendingTxnId: "pend-1" });
    const out = fold([pending, posted]);
    expect(out.map((t) => t.id)).toEqual(["post-1"]);
  });

  it("keeps a pending row whose posted twin has not arrived", () => {
    const pending = txn({ id: "pend-1", pending: true });
    expect(fold([pending]).map((t) => t.id)).toEqual(["pend-1"]);
  });

  it("drops a row a TRANSACTIONS_REMOVED webhook named", () => {
    const gone = txn({ id: "gone", removedAt: "2026-09-13T10:00:00Z" });
    const live = txn({ id: "live" });
    expect(fold([gone, live]).map((t) => t.id)).toEqual(["live"]);
  });

  it("folds a pair whose posted amount differs from the pending one", () => {
    // A restaurant tip or a fuel hold posts at a different amount. The link is
    // the id, never the amount, so the pair still folds.
    const pending = txn({ id: "pend-1", pending: true, amount: 50 });
    const posted = txn({ id: "post-1", pendingTxnId: "pend-1", amount: 58.5 });
    const out = fold([pending, posted]);
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(58.5);
  });

  it("folds several independent pairs at once", () => {
    const out = fold([
      txn({ id: "p1", pending: true }),
      txn({ id: "o1", pendingTxnId: "p1" }),
      txn({ id: "p2", pending: true, merchantNorm: "tesco" }),
      txn({ id: "o2", pendingTxnId: "p2", merchantNorm: "tesco" }),
    ]);
    expect(out.map((t) => t.id).sort()).toEqual(["o1", "o2"]);
  });

  it("leaves two genuinely separate charges alone", () => {
    const a = txn({ id: "a", date: "2026-09-12" });
    const b = txn({ id: "b", date: "2026-09-13" });
    expect(fold([a, b])).toHaveLength(2);
  });

  it("does not drop a posted row whose pending twin was already removed", () => {
    // The usual steady state: the pending row is gone from the feed entirely.
    const posted = txn({ id: "post-1", pendingTxnId: "pend-1" });
    expect(fold([posted]).map((t) => t.id)).toEqual(["post-1"]);
  });

  it("returns a new array and does not mutate the input", () => {
    const input = [txn({ id: "a" }), txn({ id: "b", removedAt: "x" })];
    const out = fold(input);
    expect(input).toHaveLength(2);
    expect(out).not.toBe(input);
  });
});
