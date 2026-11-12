"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Lock, Plus, Receipt as ReceiptIcon, Target, Trash2 } from "lucide-react";
import { Badge, Button, Card, Empty, ErrorNote, Label, Sheet, fieldClass } from "../ui";
import { estimateAccuracy, fmtMoney, fmtPct, materialsTotal, recostMaterials } from "@/lib/buildflip-2/calc";
import type { Project } from "@/lib/buildflip-2/types";
import { cn, shortDate } from "@/lib/buildflip-2/ui";

/**
 * Feature 7 — track real cost as you build.
 *
 * Log what you actually paid, see estimate against reality side by side, and
 * every logged receipt feeds back into future estimates for this build type.
 * That loop is the point: the app gets more accurate the more it is used.
 */

export default function Receipts({
  project,
  onAdd,
  onDelete,
  locked,
  onUnlock,
  busy,
}: {
  project: Project;
  onAdd?: (input: {
    materialId: string | null;
    label: string;
    amount: number;
    store?: string;
    paidAt?: string;
  }) => Promise<string | null>;
  onDelete?: (receiptId: string) => void;
  /** Pro gate. */
  locked?: boolean;
  onUnlock?: () => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [materialId, setMaterialId] = useState<string>("");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [store, setStore] = useState("");
  const [error, setError] = useState<string | null>(null);

  const materials = recostMaterials(project.materials, project.dimensions);
  const estimate = materialsTotal(materials);
  const acc = estimateAccuracy(project);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!label.trim()) {
      setError("Give the purchase a name, like “oak boards”.");
      return;
    }
    if (!Number.isFinite(value) || value < 0) {
      setError("Put in what you paid, in dollars.");
      return;
    }
    setError(null);
    const err = await onAdd?.({
      materialId: materialId || null,
      label: label.trim(),
      amount: Math.round(value * 100) / 100,
      store: store.trim() || undefined,
    });
    if (err) {
      setError(err);
      return;
    }
    setOpen(false);
    setLabel("");
    setAmount("");
    setStore("");
    setMaterialId("");
  };

  if (locked) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <Lock aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" />
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold text-[var(--ink)]">
              Track what you actually paid
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--ink-2)]">
              Log each purchase as you make it and BuildFlip shows the estimate against
              reality, line by line. Your real receipts also sharpen every future estimate
              for this kind of build — yours and everyone else&apos;s.
            </p>
            <Button variant="primary" size="md" className="mt-3.5" onClick={onUnlock}>
              Unlock cost tracking
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* ------------------------------------------- estimate vs reality */}
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--ink)]">
            <Target aria-hidden className="h-3.5 w-3.5 text-[var(--accent)]" />
            Estimate vs reality
          </h3>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setOpen(true)}
            icon={<Plus aria-hidden className="h-3.5 w-3.5" />}
          >
            Log a purchase
          </Button>
        </div>

        {!acc ? (
          <Empty
            icon={<ReceiptIcon aria-hidden className="h-6 w-6" />}
            title="No receipts yet"
            body={`We estimated ${fmtMoney(estimate)} of materials. Log what you actually pay as you buy and this turns into a real side-by-side — and makes the next estimate sharper.`}
            action={
              <Button size="sm" onClick={() => setOpen(true)}>
                Log the first purchase
              </Button>
            }
            className="border-0 py-6"
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Figure label="We estimated" value={fmtMoney(acc.estimate)} />
              <Figure label="You've paid" value={fmtMoney(acc.actual)} />
              <Figure
                label="Difference"
                value={`${acc.delta >= 0 ? "+" : ""}${fmtMoney(acc.delta)}`}
                tone={acc.within15 ? "profit" : "loss"}
              />
              <Figure
                label="Off by"
                value={`${acc.deltaPct >= 0 ? "+" : ""}${fmtPct(acc.deltaPct)}`}
                tone={acc.within15 ? "profit" : "loss"}
              />
            </div>

            {/* the two bars, same scale */}
            <div className="mt-4 space-y-2">
              <Bar label="Estimated" value={acc.estimate} max={Math.max(acc.estimate, acc.actual)} tone="estimate" />
              <Bar label="Actual" value={acc.actual} max={Math.max(acc.estimate, acc.actual)} tone="actual" />
            </div>

            <p className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--ink-3)]">
              <Badge tone={acc.within15 ? "profit" : "warn"}>
                {acc.within15 ? "within 15%" : "outside 15%"}
              </Badge>
              <span>
                {Math.round(acc.coverage * 100)}% of the planned list bought so far.
                {acc.coverage >= 0.8
                  ? " The verdict above now uses your real spend."
                  : " The verdict blends your receipts with the estimate for what's left."}
              </span>
            </p>
          </>
        )}
      </Card>

      {/* ------------------------------------------------------- the list */}
      {project.receipts.length > 0 && (
        <Card>
          <header className="border-b border-[var(--line-soft)] px-4 py-2.5">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--ink-3)]">
              What you&apos;ve paid · newest first
            </h4>
          </header>
          <ul className="divide-y divide-[var(--line-soft)]">
            {project.receipts.map((r) => {
              const material = materials.find((m) => m.id === r.materialId);
              const diff = material ? r.amount - material.lineTotal : null;
              return (
                <li key={r.id} className="flex items-start gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-[var(--ink)]">{r.label}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[11px] text-[var(--ink-4)]">
                      <span className="num">{shortDate(r.paidAt)}</span>
                      {r.store && <span>{r.store}</span>}
                      {material && (
                        <span>
                          vs {fmtMoney(material.lineTotal)} estimated
                          {diff != null && (
                            <span
                              className={cn(
                                "num ml-1 font-medium",
                                diff > 0 ? "text-[var(--loss)]" : "text-[var(--profit)]",
                              )}
                            >
                              {diff >= 0 ? "+" : ""}
                              {fmtMoney(diff)}
                            </span>
                          )}
                        </span>
                      )}
                      {!r.materialId && <span>not on the plan</span>}
                    </div>
                  </div>
                  <span className="num shrink-0 pt-0.5 text-[13.5px] font-semibold text-[var(--ink)]">
                    {fmtMoney(r.amount)}
                  </span>
                  {onDelete && (
                    <button
                      type="button"
                      onClick={() => onDelete(r.id)}
                      aria-label={`Remove the receipt for ${r.label}`}
                      className="-mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-[8px] text-[var(--ink-4)] transition hover:bg-[var(--loss-soft)] hover:text-[var(--loss)]"
                    >
                      <Trash2 aria-hidden className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* --------------------------------------------------------- sheet */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Log what you paid"
        description="Tie it to a line on the materials list and we can show you exactly where the estimate was off."
      >
        <form onSubmit={submit} className="space-y-3.5">
          <div>
            <Label htmlFor="r-material" hint="optional">
              Which item?
            </Label>
            <select
              id="r-material"
              value={materialId}
              onChange={(e) => {
                setMaterialId(e.target.value);
                const m = materials.find((x) => x.id === e.target.value);
                if (m && !label) setLabel(m.name);
              }}
              className={fieldClass}
            >
              <option value="">Something not on the list</option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — estimated {fmtMoney(m.lineTotal)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="r-label">What was it?</Label>
            <input
              id="r-label"
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, 120))}
              placeholder="Oak boards"
              required
              className={fieldClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="r-amount">What you paid</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--ink-4)]">
                  $
                </span>
                <input
                  id="r-amount"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  required
                  className={cn(fieldClass, "pl-7")}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="r-store" hint="optional">
                Where
              </Label>
              <input
                id="r-store"
                value={store}
                onChange={(e) => setStore(e.target.value.slice(0, 80))}
                placeholder="Home Depot"
                className={fieldClass}
              />
            </div>
          </div>

          {error && <ErrorNote>{error}</ErrorNote>}

          <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
            Save it
          </Button>
          <p className="text-center text-[11.5px] leading-relaxed text-[var(--ink-4)]">
            Receipts are pooled anonymously by build type to improve estimates. Your titles,
            photos and plans are never shared.
          </p>
        </form>
      </Sheet>
    </div>
  );
}

function Figure({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "profit" | "loss";
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--ink-3)]">
        {label}
      </div>
      <div
        className={cn(
          "num mt-0.5 text-[1rem] font-semibold leading-tight",
          tone === "profit" && "text-[var(--profit)]",
          tone === "loss" && "text-[var(--loss)]",
          tone === "neutral" && "text-[var(--ink)]",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Bar({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: "estimate" | "actual";
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[11px]">
        <span className="text-[var(--ink-3)]">{label}</span>
        <span className="num font-medium text-[var(--ink-2)]">{fmtMoney(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            "h-full rounded-full",
            tone === "estimate" ? "bg-[var(--ink-4)]" : "bg-[var(--accent)]",
          )}
        />
      </div>
    </div>
  );
}
