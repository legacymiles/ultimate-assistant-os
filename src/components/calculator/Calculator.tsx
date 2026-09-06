"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  evaluateBasket,
  sampleProfitCurve,
  solveExitPriceForPnl,
  suggestPriceWindow,
  type BasketSettings,
  type Order,
} from "@/lib/calculator/engine";
import { DEFAULT_SYMBOL, SYMBOLS, getSymbol } from "@/lib/calculator/symbols";
import {
  KEY as SCENARIOS_KEY,
  type Scenario,
  deleteScenario,
  downloadFile,
  duplicateScenario,
  loadScenarios,
  ordersToCsv,
  renameScenario,
  uid,
  upsertScenario,
} from "@/lib/calculator/storage";
import { useRemotePull } from "@/lib/sync/useSync";
import { Icon } from "../icons";
import { OrderRow } from "./OrderRow";
import { ProfitChart } from "./ProfitChart";

type Mode = "exit-to-pnl" | "pnl-to-exit";

const blankOrder = (side: "buy" | "sell" = "buy"): Order => ({
  id: uid("o"),
  side,
  lots: 0.1,
  entryPrice: 0,
});

const initialOrders = (): Order[] => [
  { ...blankOrder("buy"), entryPrice: 2380.0 },
  { ...blankOrder("buy"), entryPrice: 2378.5 },
  { ...blankOrder("buy"), entryPrice: 2376.0 },
];

const initialSettings = (): BasketSettings => ({
  symbol: DEFAULT_SYMBOL,
  targetPrice: 2390,
  currentPrice: 2382,
  spread: 0.3,
  commission: 0,
  swap: 0,
  accountCurrency: "USD",
});

export function Calculator() {
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [settings, setSettings] = useState<BasketSettings>(initialSettings);
  const [mode, setMode] = useState<Mode>("exit-to-pnl");
  const [desiredPnl, setDesiredPnl] = useState<number>(2000);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);

  useEffect(() => {
    setScenarios(loadScenarios());
  }, []);

  // Scenarios saved on another device land in localStorage first, then here.
  useRemotePull(SCENARIOS_KEY, () => setScenarios(loadScenarios()));

  const sym = getSymbol(settings.symbol);

  // For "Desired Profit → Required Exit", solve and treat result as target.
  const solvedTargetPrice = useMemo(() => {
    if (mode !== "pnl-to-exit") return null;
    return solveExitPriceForPnl(orders, settings, desiredPnl);
  }, [orders, settings, mode, desiredPnl]);

  const effectiveSettings: BasketSettings = useMemo(
    () =>
      mode === "pnl-to-exit" && solvedTargetPrice != null
        ? { ...settings, targetPrice: solvedTargetPrice }
        : settings,
    [settings, mode, solvedTargetPrice],
  );

  const result = useMemo(
    () => evaluateBasket(orders, effectiveSettings),
    [orders, effectiveSettings],
  );

  const priceRange = useMemo(() => suggestPriceWindow(orders, effectiveSettings), [orders, effectiveSettings]);
  const chartPoints = useMemo(
    () => (priceRange ? sampleProfitCurve(orders, effectiveSettings, { ...priceRange, samples: 240 }) : []),
    [orders, effectiveSettings, priceRange],
  );
  const chartMarkers = useMemo(() => {
    const m: { price: number; label: string; color: string }[] = [];
    if (result.breakEvenPrice != null) m.push({ price: result.breakEvenPrice, label: "BE", color: "#9aa3b5" });
    if (effectiveSettings.targetPrice != null) m.push({ price: effectiveSettings.targetPrice, label: "Target", color: "#6366f1" });
    if (settings.currentPrice != null) m.push({ price: settings.currentPrice, label: "Now", color: "#f59e0b" });
    return m;
  }, [result.breakEvenPrice, effectiveSettings.targetPrice, settings.currentPrice]);

  // ----- order CRUD -------------------------------------------------------
  const addOrder = () => setOrders((xs) => [...xs, blankOrder(xs.at(-1)?.side ?? "buy")]);
  const updateOrder = (id: string, patch: Partial<Order>) =>
    setOrders((xs) => xs.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const deleteOrder = (id: string) =>
    setOrders((xs) => (xs.length > 1 ? xs.filter((o) => o.id !== id) : xs));
  const duplicateOrder = (id: string) =>
    setOrders((xs) => {
      const i = xs.findIndex((o) => o.id === id);
      if (i < 0) return xs;
      const copy = { ...xs[i], id: uid("o") };
      return [...xs.slice(0, i + 1), copy, ...xs.slice(i + 1)];
    });

  // ----- scenarios --------------------------------------------------------
  const saveCurrent = () => {
    const fallback = "Untitled basket";
    const name = typeof window !== "undefined"
      ? window.prompt("Name this basket", fallback) ?? fallback
      : fallback;
    const id = activeScenarioId ?? uid("sc");
    const now = new Date().toISOString();
    const sc: Scenario = {
      id,
      name: name || fallback,
      orders,
      settings,
      mode,
      desiredPnl,
      created_at: now,
      updated_at: now,
    };
    setScenarios(upsertScenario(sc));
    setActiveScenarioId(id);
  };

  const loadScenario = (sc: Scenario) => {
    setOrders(sc.orders.map((o) => ({ ...o })));
    setSettings({ ...sc.settings });
    setMode(sc.mode);
    if (sc.desiredPnl != null) setDesiredPnl(sc.desiredPnl);
    setActiveScenarioId(sc.id);
  };

  const onDuplicateScenario = (id: string) => setScenarios(duplicateScenario(id));
  const onDeleteScenario = (id: string) => {
    setScenarios(deleteScenario(id));
    if (activeScenarioId === id) setActiveScenarioId(null);
  };
  const onRenameScenario = (id: string) => {
    const sc = scenarios.find((x) => x.id === id);
    if (!sc || typeof window === "undefined") return;
    const name = window.prompt("Rename basket", sc.name);
    if (name) setScenarios(renameScenario(id, name));
  };

  // ----- export -----------------------------------------------------------
  const exportCsv = () =>
    downloadFile(`basket-${Date.now()}.csv`, ordersToCsv(orders, settings), "text/csv");
  const exportJson = () =>
    downloadFile(
      `basket-${Date.now()}.json`,
      JSON.stringify({ orders, settings, mode, desiredPnl }, null, 2),
      "application/json",
    );

  return (
    <div className="min-h-dvh">
      {/* Top bar with Hub link */}
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2.5 sm:px-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          aria-label="Back to hub"
        >
          <Icon.ArrowLeft width={14} height={14} />
          <span className="hidden sm:inline">Hub</span>
        </Link>
        <span className="ml-1 text-sm font-semibold text-ink">Multi-Order Calculator</span>
        <span className="ml-2 rounded-md bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand">
          {settings.symbol}
        </span>
      </div>

      <div className="mx-auto grid max-w-6xl gap-4 px-3 py-4 sm:px-5 sm:py-6 lg:grid-cols-3">
        {/* Left two columns: orders + chart */}
        <div className="space-y-4 lg:col-span-2">
          {/* Mode + symbol */}
          <section className="rounded-2xl border border-line bg-panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <SymbolPicker
                  value={settings.symbol}
                  onChange={(symbol) => setSettings((s) => ({ ...s, symbol }))}
                />
                <span className="text-[10px] uppercase tracking-wider text-ink-faint">
                  Contract: {sym.contractSize} oz/lot · 1 pt = ${sym.pointSize.toFixed(2)} move
                </span>
              </div>
              <ModeToggle value={mode} onChange={setMode} />
            </div>
          </section>

          {/* Orders */}
          <section className="rounded-2xl border border-line bg-panel/60 p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Basket Orders</h2>
              <button
                onClick={addOrder}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-2"
              >
                <Icon.Plus width={13} height={13} />
                Add Order
              </button>
            </div>
            <div className="space-y-2">
              {orders.map((o, i) => (
                <OrderRow
                  key={o.id}
                  order={o}
                  result={result.orders[i]}
                  pricePrecision={sym.pricePrecision}
                  index={i}
                  onChange={(p) => updateOrder(o.id, p)}
                  onDelete={() => deleteOrder(o.id)}
                  onDuplicate={() => duplicateOrder(o.id)}
                />
              ))}
            </div>
          </section>

          {/* Basket settings */}
          <section className="rounded-2xl border border-line bg-panel p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Basket Settings</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {mode === "exit-to-pnl" ? (
                <Labeled label="Target Exit Price">
                  <Num
                    value={settings.targetPrice}
                    onChange={(v) => setSettings((s) => ({ ...s, targetPrice: v }))}
                    placeholder="2390.00"
                    decimals={sym.pricePrecision}
                  />
                </Labeled>
              ) : (
                <Labeled label="Desired Profit ($)">
                  <Num
                    value={desiredPnl}
                    onChange={(v) => setDesiredPnl(v)}
                    placeholder="2000"
                    decimals={2}
                  />
                </Labeled>
              )}
              <Labeled label="Current Price">
                <Num
                  value={settings.currentPrice}
                  onChange={(v) => setSettings((s) => ({ ...s, currentPrice: v }))}
                  placeholder="optional"
                  decimals={sym.pricePrecision}
                />
              </Labeled>
              <Labeled label="Spread">
                <Num
                  value={settings.spread}
                  onChange={(v) => setSettings((s) => ({ ...s, spread: v }))}
                  placeholder="optional"
                  decimals={2}
                />
              </Labeled>
              <Labeled label="Commission / lot ($)">
                <Num
                  value={settings.commission}
                  onChange={(v) => setSettings((s) => ({ ...s, commission: v }))}
                  placeholder="optional"
                  decimals={2}
                />
              </Labeled>
              <Labeled label="Swap / lot ($)">
                <Num
                  value={settings.swap}
                  onChange={(v) => setSettings((s) => ({ ...s, swap: v }))}
                  placeholder="optional"
                  decimals={2}
                />
              </Labeled>
              <Labeled label="Account Currency">
                <input
                  value={settings.accountCurrency}
                  onChange={(e) => setSettings((s) => ({ ...s, accountCurrency: e.target.value.toUpperCase() }))}
                  className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm uppercase text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
              </Labeled>
            </div>
          </section>

          {/* Profit chart */}
          <section className="rounded-2xl border border-line bg-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Profit Curve</h2>
              <span className="text-[10px] text-ink-faint">
                Hover to inspect price → P/L
              </span>
            </div>
            <ProfitChart
              points={chartPoints}
              markers={chartMarkers}
              pricePrecision={sym.pricePrecision}
            />
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ink-faint">
              <Legend color="#6b7385" label="Break-even" />
              <Legend color="#6366f1" label="Target" />
              <Legend color="#f59e0b" label="Current price" />
            </div>
          </section>
        </div>

        {/* Right column: results + scenarios */}
        <div className="space-y-4">
          {/* Headline P/L */}
          <section className="overflow-hidden rounded-2xl border border-brand/30 bg-gradient-to-b from-brand/10 to-panel p-5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {mode === "exit-to-pnl" ? "Basket P/L at target" : "Required exit price"}
            </div>
            {mode === "exit-to-pnl" ? (
              <div
                className={
                  "mt-1 text-4xl font-bold tabular-nums " +
                  (result.netPnl > 0 ? "text-core" : result.netPnl < 0 ? "text-red-400" : "text-ink")
                }
              >
                {fmtMoney(result.netPnl)}
              </div>
            ) : (
              <div className="mt-1 text-4xl font-bold tabular-nums text-ink">
                {solvedTargetPrice != null
                  ? solvedTargetPrice.toFixed(sym.pricePrecision)
                  : "—"}
                {solvedTargetPrice == null && (
                  <div className="mt-1 text-xs font-medium text-red-400">
                    Basket is hedged — no single exit price reaches that profit.
                  </div>
                )}
              </div>
            )}
            <div className="mt-1 text-xs text-ink-muted">
              {mode === "exit-to-pnl"
                ? `at ${result.evaluationPrice.toFixed(sym.pricePrecision)} (${settings.accountCurrency})`
                : `to hit ${fmtMoney(desiredPnl)} (${settings.accountCurrency})`}
            </div>
          </section>

          {/* Metrics */}
          <section className="rounded-2xl border border-line bg-panel p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Live Metrics
            </h3>
            <Metric label="Gross P/L" value={fmtMoney(result.grossPnl)} />
            <Metric
              label={`Commission (${result.totalLots.toFixed(2)} lots)`}
              value={result.totalCommission ? "−" + fmtMoney(result.totalCommission).replace(/^[+−]/, "") : "—"}
            />
            <Metric
              label="Swap"
              value={result.totalSwap ? fmtMoney(result.totalSwap) : "—"}
            />
            <Metric
              label="Spread cost"
              value={result.spreadCost ? "−" + fmtMoney(result.spreadCost).replace(/^[+−]/, "") : "—"}
            />
            <Divider />
            <Metric label="Total Lots" value={result.totalLots.toFixed(2)} />
            <Metric
              label="Net Lots (Buy − Sell)"
              value={`${result.netLots >= 0 ? "+" : ""}${result.netLots.toFixed(2)}`}
            />
            <Metric
              label="Weighted Avg Entry"
              value={
                result.weightedAverageEntry
                  ? result.weightedAverageEntry.toFixed(sym.pricePrecision)
                  : "—"
              }
            />
            <Metric
              label="Break-Even Price"
              value={
                result.breakEvenPrice != null
                  ? result.breakEvenPrice.toFixed(sym.pricePrecision)
                  : "hedged"
              }
            />
            <Divider />
            <Metric label="$ per point" value={fmtMoney(result.dollarPerPoint)} />
            <Metric label="$ per pip" value={fmtMoney(result.dollarPerPip)} />
            <Metric
              label="Distance to target"
              value={
                result.distanceToTarget != null
                  ? `${result.distanceToTarget >= 0 ? "+" : ""}${result.distanceToTarget.toFixed(sym.pricePrecision)} (${Math.round(Math.abs(result.distanceToTarget) / sym.pointSize)} pts)`
                  : "—"
              }
            />
          </section>

          {/* Scenarios + export */}
          <section className="rounded-2xl border border-line bg-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                Saved Baskets
              </h3>
              <button
                onClick={saveCurrent}
                className="rounded-lg bg-brand px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-brand-2"
              >
                Save
              </button>
            </div>
            {scenarios.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[11px] text-ink-faint">
                No saved baskets yet.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {scenarios.map((s) => {
                  const active = s.id === activeScenarioId;
                  return (
                    <li
                      key={s.id}
                      className={
                        "group flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs transition " +
                        (active
                          ? "border-brand/40 bg-brand/10"
                          : "border-line hover:bg-panel-2")
                      }
                    >
                      <button onClick={() => loadScenario(s)} className="min-w-0 flex-1 text-left">
                        <div className="truncate font-medium text-ink">{s.name}</div>
                        <div className="text-[10px] text-ink-faint">
                          {s.orders.length} orders · {s.settings.symbol}
                        </div>
                      </button>
                      <button
                        onClick={() => onRenameScenario(s.id)}
                        className="rounded p-1 text-ink-faint opacity-0 transition hover:text-ink group-hover:opacity-100"
                        title="Rename"
                        aria-label="Rename"
                      >
                        <Icon.Edit width={12} height={12} />
                      </button>
                      <button
                        onClick={() => onDuplicateScenario(s.id)}
                        className="rounded p-1 text-ink-faint opacity-0 transition hover:text-ink group-hover:opacity-100"
                        title="Duplicate"
                        aria-label="Duplicate"
                      >
                        <Icon.Plus width={12} height={12} />
                      </button>
                      <button
                        onClick={() => onDeleteScenario(s.id)}
                        className="rounded p-1 text-ink-faint opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                        title="Delete"
                        aria-label="Delete"
                      >
                        <Icon.Trash width={12} height={12} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={exportCsv}
                className="flex-1 rounded-lg border border-line py-1.5 text-[11px] font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
              >
                Export CSV
              </button>
              <button
                onClick={exportJson}
                className="flex-1 rounded-lg border border-line py-1.5 text-[11px] font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
              >
                Export JSON
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ----- small UI atoms ------------------------------------------------------

function SymbolPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm font-semibold text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
    >
      {Object.values(SYMBOLS).map((s) => (
        <option key={s.code} value={s.code}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

function ModeToggle({ value, onChange }: { value: Mode; onChange: (v: Mode) => void }) {
  return (
    <div className="flex rounded-lg border border-line p-0.5 text-xs">
      <button
        onClick={() => onChange("exit-to-pnl")}
        className={
          "rounded-md px-2.5 py-1 font-medium transition " +
          (value === "exit-to-pnl" ? "bg-brand text-white" : "text-ink-muted hover:text-ink")
        }
      >
        Exit → P/L
      </button>
      <button
        onClick={() => onChange("pnl-to-exit")}
        className={
          "rounded-md px-2.5 py-1 font-medium transition " +
          (value === "pnl-to-exit" ? "bg-brand text-white" : "text-ink-muted hover:text-ink")
        }
      >
        P/L → Exit
      </button>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}

function Num({
  value,
  onChange,
  placeholder,
  decimals,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  placeholder?: string;
  decimals?: number;
}) {
  const display = value === undefined || value === 0 ? "" : String(value);
  return (
    <input
      type="number"
      inputMode="decimal"
      value={display}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") {
          onChange(0);
          return;
        }
        const n = parseFloat(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
      placeholder={placeholder}
      step={decimals && decimals > 0 ? 1 / Math.pow(10, decimals) : 1}
      className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm tabular-nums text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
    />
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-[12px]">
      <span className="text-ink-muted">{label}</span>
      <span className="font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="my-2 h-px bg-line" />;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2 w-3 rounded" style={{ background: color }} />
      {label}
    </span>
  );
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
