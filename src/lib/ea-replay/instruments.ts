// ---------------------------------------------------------------------------
// EA World › Replay — the symbols a session can be replayed on.
//
// Two different "points" live here and they are not the same thing:
//  - `dukaScale` turns Dukascopy's integer prices into real prices. That is a
//    property of the data feed.
//  - `point` / `digits` are what an EA calls Point and Digits on a typical
//    MT4 broker. That is a property of the BROKER, and it is what every
//    "EntryDistance = 60" input is measured in, so it has to match the broker
//    the EA will run on, not the data feed.
//
// `range` is a sanity window. If a decoded price lands outside it the scale is
// wrong (Dukascopy has changed scales on some symbols before), and the loader
// tries the other common scales rather than replaying nonsense.
// ---------------------------------------------------------------------------

export type InstrumentKind = "fx" | "metal" | "index" | "crypto";

export interface Instrument {
  id: string;
  /** What the picker shows. */
  label: string;
  kind: InstrumentKind;
  /** Dukascopy datafeed symbol. */
  duka: string;
  /** Divisor from Dukascopy integer price to real price. */
  dukaScale: number;
  /** MT4 Point on a typical 5-digit / 2-digit broker. */
  point: number;
  digits: number;
  /** Units per 1.00 lot. */
  contractSize: number;
  /** "USD" when the quote currency is USD; "JPY" for USDJPY (USD base). */
  quote: "USD" | "JPY";
  /** Plausible price window, used to catch a wrong scale. */
  range: [number, number];
  /** True when the market trades at weekends (data exists for Sat/Sun). */
  weekends?: boolean;
}

export const INSTRUMENTS: Instrument[] = [
  { id: "EURUSD", label: "EUR/USD", kind: "fx", duka: "EURUSD", dukaScale: 1e5, point: 0.00001, digits: 5, contractSize: 100_000, quote: "USD", range: [0.7, 1.6] },
  { id: "GBPUSD", label: "GBP/USD", kind: "fx", duka: "GBPUSD", dukaScale: 1e5, point: 0.00001, digits: 5, contractSize: 100_000, quote: "USD", range: [0.9, 1.9] },
  { id: "AUDUSD", label: "AUD/USD", kind: "fx", duka: "AUDUSD", dukaScale: 1e5, point: 0.00001, digits: 5, contractSize: 100_000, quote: "USD", range: [0.4, 1.1] },
  { id: "USDJPY", label: "USD/JPY", kind: "fx", duka: "USDJPY", dukaScale: 1e3, point: 0.001, digits: 3, contractSize: 100_000, quote: "JPY", range: [80, 220] },
  { id: "XAUUSD", label: "Gold (XAU/USD)", kind: "metal", duka: "XAUUSD", dukaScale: 1e3, point: 0.01, digits: 2, contractSize: 100, quote: "USD", range: [1000, 9000] },
  { id: "US30", label: "US30 (Dow)", kind: "index", duka: "USA30IDXUSD", dukaScale: 1e3, point: 0.1, digits: 1, contractSize: 1, quote: "USD", range: [15000, 90000] },
  { id: "NAS100", label: "NAS100", kind: "index", duka: "USATECHIDXUSD", dukaScale: 1e3, point: 0.1, digits: 1, contractSize: 1, quote: "USD", range: [5000, 60000] },
  { id: "SPX500", label: "S&P 500", kind: "index", duka: "USA500IDXUSD", dukaScale: 1e3, point: 0.1, digits: 1, contractSize: 1, quote: "USD", range: [2000, 15000] },
  { id: "BTCUSD", label: "Bitcoin", kind: "crypto", duka: "BTCUSD", dukaScale: 10, point: 0.01, digits: 2, contractSize: 1, quote: "USD", range: [5000, 500000], weekends: true },
];

export function instrumentById(id: string | null | undefined): Instrument | undefined {
  return INSTRUMENTS.find((i) => i.id === id);
}

/** USD value of a one-point move on one lot, at this price. */
export function pointValuePerLot(inst: Instrument, price: number): number {
  const v = inst.contractSize * inst.point;
  return inst.quote === "JPY" ? v / price : v;
}

/** USD margin for `lots` at this price and leverage. */
export function marginFor(inst: Instrument, lots: number, price: number, leverage: number): number {
  const notionalUsd = inst.quote === "JPY" ? lots * inst.contractSize : lots * inst.contractSize * price;
  return notionalUsd / Math.max(1, leverage);
}

/** Rounds to the instrument's digits, as MT4's NormalizeDouble(x, Digits) does. */
export function normalize(inst: Instrument, price: number): number {
  const f = 10 ** inst.digits;
  return Math.round(price * f) / f;
}
