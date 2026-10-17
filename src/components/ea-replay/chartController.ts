// ---------------------------------------------------------------------------
// EA World › Replay — the chart, driven imperatively.
//
// React re-renders at ~8 fps for the side panels; the chart has to move every
// animation frame. So the chart is NOT React state: this controller owns the
// lightweight-charts instance and is told "the engine is here now" once per
// frame. It only appends — the forming candle is updated in place, new ones are
// pushed, and a seek backwards rebuilds from scratch.
// ---------------------------------------------------------------------------

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { ReplayEngine } from "@/lib/ea-replay/engine";
import type { Instrument } from "@/lib/ea-replay/instruments";
import { formatNy } from "@/lib/ea-replay/session";
import type { Candle } from "@/lib/ea-replay/types";

const C = {
  canvas: "#0a0b0f",
  grid: "#141722",
  line: "#262a38",
  text: "#9aa3b5",
  up: "#c3c9d6",
  down: "#3e4558",
  wickUp: "#8b93a7",
  wickDown: "#5a6178",
  ask: "#565e73",
  buy: "#3b82f6",
  sell: "#f59e0b",
  win: "#22c55e",
  loss: "#f87171",
};

interface LineRec {
  line: IPriceLine;
  key: string;
}

export class ChartController {
  private chart: IChartApi;
  private candles: ISeriesApi<"Candlestick">;
  private askSeries: ISeriesApi<"Line">;
  private markers: ISeriesMarkersPluginApi<Time>;
  private lines = new Map<string, LineRec>();
  private tfSec = 15;
  private inst: Instrument | null = null;
  private fed = 0; // ticks already turned into candles
  private bars: Candle[] = [];
  private askLast: { time: number; value: number } | null = null;
  private markerCount = -1;
  private follow = true;

  constructor(host: HTMLElement) {
    this.chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: C.canvas },
        textColor: C.text,
        fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: C.line, scaleMargins: { top: 0.12, bottom: 0.1 } },
      timeScale: {
        borderColor: C.line,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 12,
        barSpacing: 7,
        tickMarkFormatter: (t: Time) => formatNy(Number(t) * 1000, false),
      },
      localization: { timeFormatter: (t: Time) => `${formatNy(Number(t) * 1000)} NY` },
    });
    this.candles = this.chart.addSeries(CandlestickSeries, {
      upColor: C.up,
      downColor: C.down,
      borderVisible: false,
      wickUpColor: C.wickUp,
      wickDownColor: C.wickDown,
      priceLineColor: "#7d859a",
    });
    this.askSeries = this.chart.addSeries(LineSeries, {
      color: C.ask,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      title: "ask",
    });
    this.markers = createSeriesMarkers(this.candles, []);
    // Scrolling back by hand stops the chart chasing the playhead until you return.
    this.chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (!r) return;
      this.follow = r.to >= this.bars.length - 2;
    });
  }

  destroy(): void {
    this.chart.remove();
  }

  /** New tape, timeframe or engine: clear and start feeding from scratch. */
  reset(inst: Instrument, tfSec: number): void {
    this.inst = inst;
    this.tfSec = tfSec;
    this.fed = 0;
    this.bars = [];
    this.askLast = null;
    this.markerCount = -1;
    const precision = inst.digits;
    const fmt = { type: "price" as const, precision, minMove: inst.point };
    this.candles.applyOptions({ priceFormat: fmt });
    this.askSeries.applyOptions({ priceFormat: fmt });
    this.candles.setData([]);
    this.askSeries.setData([]);
    this.markers.setMarkers([]);
    for (const l of this.lines.values()) this.candles.removePriceLine(l.line);
    this.lines.clear();
    this.follow = true;
  }

  /** Bring the chart up to the engine's cursor. Cheap when little has changed. */
  sync(engine: ReplayEngine): void {
    if (!this.inst) return;
    const s = engine.ticks;
    const end = engine.cursor;
    if (end < this.fed) {
      this.reset(this.inst, this.tfSec);
    }
    const tfMs = this.tfSec * 1000;
    const big = end - this.fed > 5000;
    let touched = false;
    for (let i = this.fed; i < end; i++) {
      const bucket = Math.floor(s.time[i] / tfMs) * this.tfSec;
      const px = s.bid[i];
      const last = this.bars[this.bars.length - 1];
      if (!last || last.time !== bucket) {
        if (last && !big) this.candles.update(toBar(last));
        this.bars.push({ time: bucket, open: px, high: px, low: px, close: px, ticks: 1 });
      } else {
        if (px > last.high) last.high = px;
        if (px < last.low) last.low = px;
        last.close = px;
        last.ticks++;
      }
      touched = true;
      this.askLast = { time: bucket, value: s.ask[i] };
    }
    this.fed = end;
    if (touched) {
      if (big) {
        this.candles.setData(this.bars.map(toBar));
        this.askSeries.setData(this.askLine(engine));
      } else {
        const last = this.bars[this.bars.length - 1];
        if (last) this.candles.update(toBar(last));
        if (this.askLast) this.askSeries.update({ time: this.askLast.time as UTCTimestamp, value: this.askLast.value });
      }
      if (this.follow) this.chart.timeScale().scrollToRealTime();
    }
    this.syncLines(engine);
    this.syncMarkers(engine);
  }

  private askLine(engine: ReplayEngine) {
    const s = engine.ticks;
    const tfMs = this.tfSec * 1000;
    const out: { time: UTCTimestamp; value: number }[] = [];
    for (let i = 0; i < engine.cursor; i++) {
      const bucket = (Math.floor(s.time[i] / tfMs) * this.tfSec) as UTCTimestamp;
      const last = out[out.length - 1];
      if (last && last.time === bucket) last.value = s.ask[i];
      else out.push({ time: bucket, value: s.ask[i] });
    }
    return out;
  }

  /** One horizontal line per working price: pending entries, open entries, stops and targets. */
  private syncLines(engine: ReplayEngine): void {
    const want = new Map<string, { price: number; color: string; style: LineStyle; title: string; width: 1 | 2 }>();
    for (const o of engine.broker.live.values()) {
      const buy = o.type === "buy" || o.type === "buystop" || o.type === "buylimit";
      const col = buy ? C.buy : C.sell;
      if (o.status === "pending") {
        want.set(`p${o.ticket}`, { price: o.openPrice, color: col, style: LineStyle.Dashed, title: `${o.type} ${o.lots}`, width: 1 });
      } else {
        want.set(`o${o.ticket}`, { price: o.openPrice, color: col, style: LineStyle.Solid, title: `${o.type} ${o.lots}`, width: 2 });
        if (o.sl > 0) {
          const locked = buy ? o.sl > o.openPrice : o.sl < o.openPrice;
          want.set(`s${o.ticket}`, { price: o.sl, color: locked ? C.win : C.loss, style: LineStyle.Dotted, title: locked ? "trail" : "SL", width: 1 });
        }
        if (o.tp > 0) want.set(`t${o.ticket}`, { price: o.tp, color: C.win, style: LineStyle.Dotted, title: "TP", width: 1 });
      }
    }
    for (const [id, rec] of this.lines) {
      if (!want.has(id)) {
        this.candles.removePriceLine(rec.line);
        this.lines.delete(id);
      }
    }
    for (const [id, w] of want) {
      const key = `${w.price}|${w.color}|${w.title}`;
      const have = this.lines.get(id);
      if (have) {
        if (have.key !== key) {
          have.line.applyOptions({ price: w.price, color: w.color, title: w.title });
          have.key = key;
        }
      } else {
        const line = this.candles.createPriceLine({
          price: w.price,
          color: w.color,
          lineStyle: w.style,
          lineWidth: w.width,
          axisLabelVisible: true,
          title: w.title,
        });
        this.lines.set(id, { line, key });
      }
    }
  }

  /** Fills as arrows at their price, exits as dots coloured by the money. */
  private syncMarkers(engine: ReplayEngine): void {
    const ev = engine.broker.events;
    let n = 0;
    for (const e of ev) if (e.kind === "filled" || e.kind === "closed") n++;
    if (n === this.markerCount) return;
    this.markerCount = n;
    const tf = this.tfSec;
    const out: SeriesMarker<Time>[] = [];
    for (const e of ev) {
      if ((e.kind !== "filled" && e.kind !== "closed") || e.price == null) continue;
      const time = (Math.floor(e.time / 1000 / tf) * tf) as UTCTimestamp;
      if (e.kind === "filled") {
        const buy = e.type === "buy";
        out.push({ time, position: "atPriceMiddle", price: e.price, shape: buy ? "arrowUp" : "arrowDown", color: buy ? C.buy : C.sell, size: 1.2 });
      } else {
        const p = e.profit ?? 0;
        out.push({ time, position: "atPriceMiddle", price: e.price, shape: "circle", color: p >= 0 ? C.win : C.loss, size: 0.9, text: `${p >= 0 ? "+" : ""}${p.toFixed(2)}` });
      }
    }
    out.sort((a, b) => Number(a.time) - Number(b.time));
    this.markers.setMarkers(out);
  }

  /** Re-pin to the playhead (the "follow" button). */
  followNow(): void {
    this.follow = true;
    this.chart.timeScale().scrollToRealTime();
  }
}

function toBar(c: Candle) {
  return { time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close };
}
