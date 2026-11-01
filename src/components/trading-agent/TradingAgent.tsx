"use client";

// ---------------------------------------------------------------------------
// The Trading Agent — reads a setup, argues with the reasoning, signs nothing.
//
// The screen is split on purpose, and the split is the point. The LEFT side is
// arithmetic: computed on this machine by src/lib/trading-agent/setup.ts, correct
// whether or not a key is set, whether or not the network is up, and whether or
// not a model feels like answering. The RIGHT side is argument: the only part
// that needs a model, and the only part that can be wrong.
//
// Keeping them apart is what makes the thing honest. A single pane where a
// language model reports both would make a confident paragraph out of a figure
// it might have fumbled, and the figures here are about money.
//
// It has no broker connection and places no orders. That is not a missing
// integration; it is the design, and the banner says so where a reader could
// otherwise assume the opposite.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import {
  expectancy,
  flawsIn,
  numbersFor,
  precisionOf,
  type Direction,
  type Setup,
} from "@/lib/trading-agent/setup";
import type { Read } from "@/lib/trading-agent/prompt";
import { Icon } from "../icons";

const WIN_RATES = [0.3, 0.4, 0.5, 0.6, 0.7];

const money = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

const BLANK: Setup = {
  instrument: "",
  direction: "long",
  entry: Number.NaN,
  stop: Number.NaN,
  target: Number.NaN,
  timeframe: "",
  thesis: "",
};

/** A price field holds what was typed, so a half-typed "1.08" is not NaN yet. */
type Typed = { entry: string; stop: string; target: string; size: string; riskPct: string };

const TYPED: Typed = { entry: "", stop: "", target: "", size: "10000", riskPct: "1" };

export function TradingAgent() {
  const [setup, setSetup] = useState<Setup>(BLANK);
  const [typed, setTyped] = useState<Typed>(TYPED);
  const [read, setRead] = useState<Read | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const account = useMemo(
    () => ({ size: Number(typed.size), riskPct: Number(typed.riskPct) }),
    [typed.size, typed.riskPct],
  );
  const priced = useMemo<Setup>(
    () => ({
      ...setup,
      entry: typed.entry === "" ? Number.NaN : Number(typed.entry),
      stop: typed.stop === "" ? Number.NaN : Number(typed.stop),
      target: typed.target === "" ? Number.NaN : Number(typed.target),
    }),
    [setup, typed.entry, typed.stop, typed.target],
  );

  const numbers = useMemo(() => numbersFor(priced, account), [priced, account]);
  const flaws = useMemo(() => flawsIn(priced, account), [priced, account]);
  const dp = useMemo(() => precisionOf(priced), [priced]);
  // Nothing has been typed yet — a wall of "has to be a number" on an empty
  // form is nagging, not help.
  const untouched = typed.entry === "" && typed.stop === "" && typed.target === "";

  const ask = async () => {
    setBusy(true);
    setNote(null);
    setRead(null);
    try {
      const res = await fetch("/api/trading-agent/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...priced, size: account.size, riskPct: account.riskPct }),
      });
      const data = (await res.json()) as { read?: Read; offline?: boolean; error?: string };
      if (data.offline) {
        setNote(
          "No AI key is set, so the reasoning half is offline. The arithmetic is unaffected — it never needed one.",
        );
      } else if (data.error) {
        setNote(data.error);
      } else if (data.read) {
        setRead(data.read);
      }
    } catch {
      setNote("Could not reach the agent. The arithmetic is unaffected.");
    } finally {
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none";
  const label = "block text-[10px] uppercase tracking-wider text-ink-faint mb-1";

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      {/* What this is, and what it refuses to be. First thing on the screen,
          because a tool with "trading agent" on it invites exactly the
          assumption this sentence removes. */}
      <div className="flex flex-none items-center gap-2 border-b border-line-soft bg-panel px-3 py-2">
        <Icon.Lock width={13} height={13} className="shrink-0 text-amber-400" />
        <p className="text-[11px] leading-snug text-ink-muted">
          <span className="font-semibold text-ink">Reads setups. Places nothing.</span> No broker is
          connected and none can be — this agent has no order path, by design. The numbers are
          computed on this machine; the reasoning is a second opinion, not a recommendation.
        </p>
      </div>

      <div className="grid min-h-0 flex-1 gap-0 overflow-auto lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* ---- the arithmetic ------------------------------------------- */}
        <div className="border-line-soft p-3 lg:border-r">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className={label} htmlFor="ta-instrument">Instrument</label>
              <input
                id="ta-instrument"
                className={field}
                placeholder="EURUSD, NAS100, BTC…"
                value={setup.instrument}
                onChange={(e) => setSetup((s) => ({ ...s, instrument: e.target.value }))}
              />
            </div>
            <div>
              <span className={label}>Direction</span>
              <div className="flex rounded-lg border border-line p-0.5">
                {(["long", "short"] as Direction[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={setup.direction === d}
                    onClick={() => setSetup((s) => ({ ...s, direction: d }))}
                    className={`flex-1 rounded-md px-2 py-1 text-xs capitalize transition ${
                      setup.direction === d ? "bg-panel-2 text-ink" : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={label} htmlFor="ta-tf">Timeframe</label>
              <input
                id="ta-tf"
                className={field}
                placeholder="4h"
                value={setup.timeframe}
                onChange={(e) => setSetup((s) => ({ ...s, timeframe: e.target.value }))}
              />
            </div>
            {(
              [
                ["entry", "Entry"],
                ["stop", "Stop"],
                ["target", "Target"],
              ] as const
            ).map(([k, l]) => (
              <div key={k} className={k === "target" ? "col-span-2" : ""}>
                <label className={label} htmlFor={`ta-${k}`}>{l}</label>
                <input
                  id={`ta-${k}`}
                  className={field}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={typed[k]}
                  onChange={(e) => setTyped((t) => ({ ...t, [k]: e.target.value }))}
                />
              </div>
            ))}
            <div>
              <label className={label} htmlFor="ta-size">Account</label>
              <input
                id="ta-size"
                className={field}
                inputMode="decimal"
                value={typed.size}
                onChange={(e) => setTyped((t) => ({ ...t, size: e.target.value }))}
              />
            </div>
            <div>
              <label className={label} htmlFor="ta-risk">Risk per trade %</label>
              <input
                id="ta-risk"
                className={field}
                inputMode="decimal"
                value={typed.riskPct}
                onChange={(e) => setTyped((t) => ({ ...t, riskPct: e.target.value }))}
              />
            </div>
          </div>

          {/* The figures. A dense table rather than cards: these are numbers to
              read across, not headlines. */}
          <table className="mt-4 w-full border-collapse text-xs">
            <tbody>
              {(
                [
                  ["Risk / unit", numbers && numbers.riskPerUnit.toFixed(dp)],
                  ["Reward / unit", numbers && numbers.rewardPerUnit.toFixed(dp)],
                  ["Reward : risk", numbers && `${numbers.rr.toFixed(2)} : 1`],
                  [
                    "Breakeven win rate",
                    numbers && `${(numbers.breakevenWinRate * 100).toFixed(1)}%`,
                    "What has to be true for this to pay for itself, before costs",
                  ],
                  ["Risked", numbers && money(numbers.riskAmount)],
                  ["Position size", numbers && numbers.units.toLocaleString(undefined, { maximumFractionDigits: 4 })],
                  ["Returned at target", numbers && money(numbers.rewardAmount)],
                ] as const
              ).map(([k, v, hint]) => (
                <tr key={k} className="border-b border-line-soft last:border-0">
                  <th
                    scope="row"
                    className="py-1.5 pr-2 text-left font-normal text-ink-faint"
                    title={hint ?? undefined}
                  >
                    {k}
                    {hint && <span className="ml-1 text-ink-faint/60">·</span>}
                  </th>
                  <td className="py-1.5 text-right font-mono text-ink tabular-nums">{v ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {numbers && (
            <>
              <p className="mt-4 text-[10px] uppercase tracking-wider text-ink-faint">
                Per trade, at an assumed win rate
              </p>
              <table className="mt-1.5 w-full border-collapse text-xs">
                <tbody>
                  {WIN_RATES.map((w) => {
                    const e = expectancy(numbers, w);
                    return (
                      <tr key={w} className="border-b border-line-soft last:border-0">
                        <th scope="row" className="py-1 pr-2 text-left font-normal text-ink-faint">
                          {Math.round(w * 100)}%
                        </th>
                        <td
                          className={`py-1 text-right font-mono tabular-nums ${
                            e > 0 ? "text-emerald-400" : e < 0 ? "text-rose-400" : "text-ink-muted"
                          }`}
                        >
                          {e > 0 ? "+" : ""}
                          {money(e)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-1.5 text-[10px] leading-snug text-ink-faint">
                Win rates are your assumption, not a measurement. Spreads, commission and slippage
                are excluded.
              </p>
            </>
          )}

          {!untouched && flaws.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {flaws.map((f, i) => (
                <li
                  key={i}
                  className={`flex gap-2 rounded-lg border px-2.5 py-2 text-[11px] leading-snug ${
                    f.blocking
                      ? "border-rose-500/30 bg-rose-500/5 text-rose-200"
                      : "border-amber-500/25 bg-amber-500/5 text-amber-100/90"
                  }`}
                >
                  <Icon.Flag width={12} height={12} className="mt-0.5 shrink-0" />
                  {f.message}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ---- the argument -------------------------------------------- */}
        <div className="flex min-h-0 flex-col p-3">
          <label className={label} htmlFor="ta-thesis">
            Why you think this works
          </label>
          <textarea
            id="ta-thesis"
            className={`${field} min-h-28 resize-y font-normal leading-relaxed`}
            placeholder="Held the prior week's high on the retest, and the daily is still above the 50…"
            value={setup.thesis}
            onChange={(e) => setSetup((s) => ({ ...s, thesis: e.target.value }))}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={ask}
              disabled={busy || !setup.thesis.trim() || !numbers}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon.Bot width={13} height={13} />
              {busy ? "Reading…" : "Read it back to me"}
            </button>
            {!numbers && (
              <span className="text-[11px] text-ink-faint">
                Fill in prices that agree with each other first.
              </span>
            )}
          </div>

          {note && (
            <p className="mt-3 rounded-lg border border-line bg-panel-2 px-3 py-2 text-[11px] leading-snug text-ink-muted">
              {note}
            </p>
          )}

          {read && (
            <div className="mt-4 space-y-4">
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-ink-faint">
                  The bet, without the reasons
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-ink">{read.restated}</p>
              </section>
              {(
                [
                  ["What it assumes", read.assumes, "Sparkles"],
                  ["What would kill it before your stop does", read.invalidatedBy, "Flag"],
                  ["Where the argument is weakest", read.pushback, "Target"],
                  ["What you did not say", read.unanswered, "Note"],
                ] as const
              ).map(([heading, items, icon]) => {
                if (items.length === 0) return null;
                const Glyph = Icon[icon as keyof typeof Icon] ?? Icon.Square;
                return (
                  <section key={heading}>
                    <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink-faint">
                      <Glyph width={11} height={11} />
                      {heading}
                    </h3>
                    <ul className="mt-1.5 space-y-1.5">
                      {items.map((x, i) => (
                        <li
                          key={i}
                          className="rounded-lg border border-line-soft bg-panel px-3 py-2 text-xs leading-relaxed text-ink-muted"
                        >
                          {x}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              <p className="text-[10px] leading-snug text-ink-faint">
                A second opinion on your reasoning, from a language model with no market data. It is
                not advice, not a forecast, and not a verdict on the trade.
              </p>
            </div>
          )}

          {!read && !note && !busy && (
            <p className="mt-6 max-w-prose text-xs leading-relaxed text-ink-faint">
              Write the thesis and the agent will restate the bet without your reasons attached,
              name what it rests on, and say where it thinks the argument is weakest. It will not
              tell you whether to take it — that question is yours, and a tool that answered it is a
              tool you would stop thinking next to.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
