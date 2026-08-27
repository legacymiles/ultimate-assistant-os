"use client";

import type { Order, OrderResult, Side } from "@/lib/calculator/engine";
import { Icon } from "../icons";

interface Props {
  order: Order;
  result?: OrderResult;
  pricePrecision: number;
  index: number;
  onChange: (patch: Partial<Order>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

export function OrderRow({
  order,
  result,
  pricePrecision,
  index,
  onChange,
  onDelete,
  onDuplicate,
}: Props) {
  const isBuy = order.side === "buy";
  const pnl = result?.pnl ?? 0;
  const pnlColor =
    pnl > 0 ? "text-core" : pnl < 0 ? "text-red-400" : "text-ink-faint";

  return (
    <div className="rounded-2xl border border-line bg-panel p-3 sm:p-3.5">
      <div className="grid grid-cols-12 items-center gap-2">
        <div className="col-span-1 text-center text-[11px] font-semibold text-ink-faint">
          #{index + 1}
        </div>

        {/* Side */}
        <div className="col-span-3 sm:col-span-2">
          <SideToggle
            value={order.side}
            onChange={(side) => onChange({ side })}
          />
        </div>

        {/* Lots */}
        <div className="col-span-4 sm:col-span-2">
          <NumberInput
            value={order.lots}
            onChange={(lots) => onChange({ lots })}
            placeholder="Lots"
            step={0.01}
            min={0}
            decimals={2}
          />
        </div>

        {/* Entry */}
        <div className="col-span-4 sm:col-span-3">
          <NumberInput
            value={order.entryPrice}
            onChange={(entryPrice) => onChange({ entryPrice })}
            placeholder="Entry"
            step={0.01}
            min={0}
            decimals={pricePrecision}
          />
        </div>

        {/* P/L */}
        <div className="col-span-9 sm:col-span-3 text-right">
          <div className={`text-sm font-semibold tabular-nums ${pnlColor}`}>
            {fmtMoney(pnl)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-ink-faint">
            {isBuy ? "Long" : "Short"} P/L
          </div>
        </div>

        {/* Actions */}
        <div className="col-span-3 sm:col-span-1 flex items-center justify-end gap-1">
          <button
            onClick={onDuplicate}
            className="rounded-lg p-1.5 text-ink-faint transition hover:bg-canvas hover:text-ink"
            title="Duplicate order"
            aria-label="Duplicate order"
          >
            <Icon.Plus width={15} height={15} />
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg p-1.5 text-ink-faint transition hover:bg-red-500/10 hover:text-red-400"
            title="Delete order"
            aria-label="Delete order"
          >
            <Icon.Trash width={15} height={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function SideToggle({
  value,
  onChange,
}: {
  value: Side;
  onChange: (v: Side) => void;
}) {
  return (
    <div className="flex rounded-lg border border-line p-0.5 text-xs">
      <button
        onClick={() => onChange("buy")}
        className={
          "flex-1 rounded-md py-1 font-semibold transition " +
          (value === "buy"
            ? "bg-core/20 text-core"
            : "text-ink-faint hover:text-ink")
        }
      >
        BUY
      </button>
      <button
        onClick={() => onChange("sell")}
        className={
          "flex-1 rounded-md py-1 font-semibold transition " +
          (value === "sell"
            ? "bg-red-500/20 text-red-400"
            : "text-ink-faint hover:text-ink")
        }
      >
        SELL
      </button>
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  placeholder,
  step,
  min,
  decimals,
}: {
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
  step?: number;
  min?: number;
  decimals?: number;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      value={Number.isFinite(value) && value !== 0 ? value : value === 0 ? "" : ""}
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
      step={step}
      min={min}
      className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-right text-sm tabular-nums text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
      style={{ MozAppearance: "textfield" } as React.CSSProperties}
      aria-label={placeholder}
      data-decimals={decimals}
    />
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
