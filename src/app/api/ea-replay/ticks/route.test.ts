import { afterEach, describe, expect, it, vi } from "vitest";
import * as LZMA from "lzma";
import { GET } from "./route";
import { decodeTicks, type TickPayload } from "@/lib/ea-replay/types";

// A real round trip through the route: build an hour of records, LZMA-compress
// them exactly as Dukascopy does, and serve them through a mocked fetch.
function body(records: [number, number, number][]): ArrayBuffer {
  const u = bi5(records);
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function bi5(records: [number, number, number][]): Uint8Array {
  const raw = new Uint8Array(records.length * 20);
  const v = new DataView(raw.buffer);
  records.forEach(([ms, ask, bid], i) => {
    v.setUint32(i * 20, ms);
    v.setUint32(i * 20 + 4, ask);
    v.setUint32(i * 20 + 8, bid);
    v.setFloat32(i * 20 + 12, 1.5);
    v.setFloat32(i * 20 + 16, 2.25);
  });
  const compressed = (LZMA as unknown as { compress(d: number[], mode: number): number[] }).compress(Array.from(raw), 1);
  return Uint8Array.from(compressed, (b) => b & 0xff);
}

afterEach(() => vi.unstubAllGlobals());

describe("GET /api/ea-replay/ticks", () => {
  it("fetches, decompresses, trims and encodes Dukascopy hours", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      if (url.includes("/12h_")) return new Response(body([[1000, 117012, 117010], [3_599_000, 117020, 117018]]));
      if (url.includes("/13h_")) return new Response(body([[500, 117030, 117028]]));
      return new Response(null, { status: 404 });
    });
    const from = Date.UTC(2026, 8, 16, 12, 0, 0, 500);
    const to = Date.UTC(2026, 8, 16, 14);
    const res = await GET(new Request(`http://x/api/ea-replay/ticks?symbol=EURUSD&from=${from}&to=${to}`));
    expect(res.status).toBe(200);
    const s = decodeTicks((await res.json()) as TickPayload);
    expect(calls[0]).toContain("/EURUSD/2026/08/16/12h_ticks.bi5");
    expect(Array.from(s.bid)).toEqual([1.1701, 1.17018, 1.17028]);
    expect(Array.from(s.ask)).toEqual([1.17012, 1.1702, 1.1703]);
    expect(s.time[0]).toBe(Date.UTC(2026, 8, 16, 12, 0, 1));
  });

  it("says when Dukascopy cannot be reached", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });
    const res = await GET(new Request(`http://x/api/ea-replay/ticks?symbol=EURUSD&from=${Date.UTC(2026, 8, 16, 12)}&to=${Date.UTC(2026, 8, 16, 13)}`));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/could not be reached/);
  }, 10_000);

  it("refuses long windows and unknown symbols", async () => {
    expect((await GET(new Request("http://x/api/ea-replay/ticks?symbol=NOPE&from=1&to=2"))).status).toBe(400);
    expect((await GET(new Request(`http://x/api/ea-replay/ticks?symbol=EURUSD&from=0&to=${13 * 3_600_000}`))).status).toBe(400);
  });
});
