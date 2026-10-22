import { afterEach, describe, expect, it, vi } from "vitest";
import { CLAIM_BATCH_BYTES, CLAIM_BATCH_MAX, DrainError, claimBatches, drainInbox } from "./drainInbox";

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

describe("drainInbox", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("keeps going past a photo it can't bring in, reads the rest, and says so", async () => {
    // Two batches: the first is refused (too big), the second comes in by link.
    const entries = [
      { id: "big", bytes: 2_400_000 },
      { id: "new", bytes: 2_400_000 },
    ];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/claim")) {
        const ids = JSON.parse(String(init?.body)).ids as string[];
        if (ids.includes("big")) return new Response("", { status: 413 });
        return Response.json({ photos: [{ id: "new", name: "IMG_1.jpeg", contentType: "image/jpeg", url: "https://store/x" }] });
      }
      if (u === "https://store/x") return new Response(new Blob(["px"]), { status: 200 });
      return new Response("{}");
    }) as typeof fetch;

    const read = vi.fn();
    const err = await drainInbox(entries, read, undefined, { share: true }).catch((e) => e);
    expect(read).toHaveBeenCalledTimes(1);
    expect((read.mock.calls[0][0] as File[]).map((f) => f.name)).toEqual(["IMG_1.jpeg"]);
    expect(err).toBeInstanceOf(DrainError);
    expect((err as DrainError).brought).toBe(1);
    expect((err as DrainError).failed).toBe(1);
    expect((err as DrainError).message).toMatch(/too big.*rest came in/);
  });
});
