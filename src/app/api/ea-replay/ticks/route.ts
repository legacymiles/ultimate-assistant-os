import { NextResponse } from "next/server";
import * as LZMA from "lzma";
import { detectScale, hourUrl, hoursBetween, parseHour, type RawTick } from "@/lib/ea-replay/dukascopy";
import { instrumentById } from "@/lib/ea-replay/instruments";
import { encodeTicks, type TickSeries } from "@/lib/ea-replay/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SPAN_MS = 12 * 3_600_000;
const HOUR = 3_600_000;

// GET /api/ea-replay/ticks?symbol=EURUSD&from=<utc ms|ISO>&to=<utc ms|ISO>
//
// Real bid/ask ticks from Dukascopy's free hourly files, decompressed and
// trimmed to the window, sent as integer points (see TickPayload). Hours that
// could not be fetched are listed in `missing` rather than silently dropped —
// a replay with a hole in it must say so.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const inst = instrumentById(url.searchParams.get("symbol"));
  if (!inst) return NextResponse.json({ error: "Unknown symbol" }, { status: 400 });

  const from = parseTime(url.searchParams.get("from"));
  const to = parseTime(url.searchParams.get("to"));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return NextResponse.json({ error: "from/to must be a valid UTC window" }, { status: 400 });
  }
  if (to - from > MAX_SPAN_MS) {
    return NextResponse.json({ error: "Pick 12 hours or less — a tick replay longer than that will not fit in a browser tab" }, { status: 400 });
  }
  // Dukascopy publishes an hour roughly an hour after it ends.
  const now = Date.now();
  const hours = hoursBetween(from, to).filter((h) => h + HOUR <= now);
  if (!hours.length) {
    return NextResponse.json({ error: "That window has not been published yet — Dukascopy posts each hour about an hour after it closes" }, { status: 404 });
  }

  const missing: string[] = [];
  const perHour: RawTick[][] = new Array(hours.length);
  let next = 0;
  async function worker() {
    while (next < hours.length) {
      const i = next++;
      const h = hours[i];
      try {
        perHour[i] = await fetchHour(inst!.duka, h, inst!);
      } catch (e) {
        perHour[i] = [];
        missing.push(`${new Date(h).toISOString().slice(0, 13)}:00Z (${e instanceof Error ? e.message : "failed"})`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, hours.length) }, worker));

  const all = perHour.flat().filter((t) => t.t >= from && t.t < to);
  if (!all.length) {
    const reason = missing.length === hours.length ? "Dukascopy could not be reached" : "No ticks in that window (market closed or a holiday)";
    return NextResponse.json({ error: reason, missing }, { status: missing.length === hours.length ? 502 : 404 });
  }

  const series: TickSeries = {
    symbol: inst.id,
    time: Float64Array.from(all, (t) => t.t),
    bid: Float64Array.from(all, (t) => t.bid),
    ask: Float64Array.from(all, (t) => t.ask),
    source: "dukascopy",
    note: `Dukascopy · ${hours.length - missing.length}/${hours.length} hourly files · ${all.length.toLocaleString("en-US")} ticks`,
  };
  const payload = encodeTicks(series, inst.point, missing.length ? missing : undefined);
  // A finished hour never changes, so a complete answer can be cached hard.
  const cache = missing.length ? "no-store" : "public, max-age=3600, s-maxage=604800, immutable";
  return NextResponse.json(payload, { headers: { "Cache-Control": cache } });
}

async function fetchHour(duka: string, hourStart: number, inst: NonNullable<ReturnType<typeof instrumentById>>): Promise<RawTick[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(hourUrl(duka, hourStart), {
        signal: AbortSignal.timeout(15_000),
        headers: { "User-Agent": "Mozilla/5.0 (EA World Replay)" },
        cache: "no-store",
      });
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength === 0) return []; // an empty hour: market closed
      const out = LZMA.decompress(buf);
      const bytes = typeof out === "string" ? new Uint8Array(Buffer.from(out, "utf8")) : Uint8Array.from(out, (b) => b & 0xff);
      return parseHour(bytes, hourStart, detectScale(bytes, inst));
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("fetch failed");
}

function parseTime(v: string | null): number {
  if (!v) return NaN;
  if (/^\d+$/.test(v)) return Number(v);
  return Date.parse(v);
}
