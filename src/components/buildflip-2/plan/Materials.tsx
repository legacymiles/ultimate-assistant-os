"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, Pencil, RefreshCw, Ruler } from "lucide-react";
import SourceChip from "../SourceChip";
import { Badge, Button, Card, fieldClass } from "../ui";
import { fmtMoney, materialsTotal, recostMaterials } from "@/lib/buildflip-2/calc";
import type { Dimension, Material, Project } from "@/lib/buildflip-2/types";
import { cn, hostOf } from "@/lib/buildflip-2/ui";

/**
 * Feature 3 — materials at live prices, and the dimension dials that drive them.
 *
 * Every row carries its unit price, where that price came from, when it was
 * checked, a link to buy, and a running total. Change a dimension and the
 * quantities re-count with a digit-roll, and the rows that changed flash — so
 * it is obvious which numbers moved and which didn't.
 */

export default function Materials({
  project,
  onDimensions,
  onPrice,
  onReprice,
  repricing,
  canReprice,
  readOnly,
}: {
  project: Project;
  onDimensions?: (next: { key: string; value: number }[]) => void;
  onPrice?: (id: string, unitPrice: number) => void;
  onReprice?: () => void;
  repricing?: boolean;
  canReprice?: boolean;
  readOnly?: boolean;
}) {
  // Local dimension state so dragging a slider is instant; the save is debounced.
  const [dims, setDims] = useState<Dimension[]>(project.dimensions);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const latest = useRef(dims);
  latest.current = dims;

  /**
   * Don't let a background refresh yank the slider back mid-drag. The provider
   * re-fetches on focus and on a heartbeat; accepting that while a change is
   * pending would both jump the handle and lose the user's new value.
   */
  useEffect(() => {
    if (dirty.current) return;
    setDims(project.dimensions);
  }, [project.dimensions]);

  const flush = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!dirty.current || !onDimensions) return;
    dirty.current = false;
    onDimensions(latest.current.map((d) => ({ key: d.key, value: d.value })));
  }, [onDimensions]);

  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flush();
    };
  }, [flush]);

  const materials = useMemo(() => recostMaterials(project.materials, dims), [
    project.materials,
    dims,
  ]);
  const baseline = useMemo(
    () => recostMaterials(project.materials, project.dimensions),
    [project.materials, project.dimensions],
  );
  const changedIds = useMemo(() => {
    const map = new Map(baseline.map((m) => [m.id, m.quantity]));
    return new Set(materials.filter((m) => map.get(m.id) !== m.quantity).map((m) => m.id));
  }, [materials, baseline]);

  const total = materialsTotal(materials);
  const optionalTotal = materialsTotal(materials, true) - total;

  const setDim = (key: string, value: number) => {
    const next = dims.map((d) => (d.key === key ? { ...d, value } : d));
    setDims(next);
    latest.current = next;
    if (!onDimensions) return;
    dirty.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      dirty.current = false;
      onDimensions(latest.current.map((d) => ({ key: d.key, value: d.value })));
    }, 450);
  };

  const byAisle = useMemo(() => {
    const groups = new Map<string, Material[]>();
    for (const m of materials) {
      const list = groups.get(m.aisle) ?? [];
      list.push(m);
      groups.set(m.aisle, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [materials]);

  const lastChecked = materials[0]?.provenance.checkedAt;
  const anyDemo = materials.some((m) => m.provenance.demo);

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------- dimension dials */}
      {dims.length > 0 && (
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Ruler aria-hidden className="h-4 w-4 text-[var(--accent)]" />
            <h3 className="text-[13px] font-semibold text-[var(--ink)]">
              Size it for your build
            </h3>
            {changedIds.size > 0 && (
              <Badge tone="accent">
                {changedIds.size} quantit{changedIds.size === 1 ? "y" : "ies"} changed
              </Badge>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {dims.map((d) => (
              <div key={d.key}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <label
                    htmlFor={`dim-${d.key}`}
                    className="text-[12px] font-medium text-[var(--ink-2)]"
                  >
                    {d.label}
                  </label>
                  <span className="num text-[13px] font-semibold text-[var(--ink)]">
                    {d.value}
                    <span className="ml-0.5 text-[11px] text-[var(--ink-3)]">{d.unit}</span>
                    {d.value !== d.baseline && (
                      <span className="ml-1.5 text-[10.5px] font-normal text-[var(--accent)]">
                        was {d.baseline}
                      </span>
                    )}
                  </span>
                </div>
                <input
                  id={`dim-${d.key}`}
                  type="range"
                  min={d.min}
                  max={d.max}
                  step={d.step}
                  value={d.value}
                  disabled={readOnly}
                  onChange={(e) => setDim(d.key, Number(e.target.value))}
                  aria-valuetext={`${d.value} ${d.unit}`}
                  className="h-11 w-full cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ accentColor: "var(--accent)" }}
                />
                <div className="num flex justify-between text-[10px] text-[var(--ink-4)]">
                  <span>
                    {d.min}
                    {d.unit}
                  </span>
                  <span>
                    {d.max}
                    {d.unit}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {!readOnly && (
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--ink-4)]">
              Quantities re-count as you drag. Prices stay as last checked — hit Re-price to
              check today&apos;s listings.
            </p>
          )}
        </Card>
      )}

      {/* ---------------------------------------------------- the materials */}
      <Card>
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line-soft)] px-4 py-3">
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--ink)]">
              Materials · {materials.length} item{materials.length === 1 ? "" : "s"}
            </h3>
            <p className="mt-0.5 text-[11px] text-[var(--ink-4)]">
              {anyDemo
                ? "Demo catalog prices — every one is labelled."
                : lastChecked
                  ? "Tap any price to see the listing it came from."
                  : "Prices not yet checked."}
            </p>
          </div>
          {onReprice && (
            <Button
              size="sm"
              variant="secondary"
              loading={repricing}
              onClick={onReprice}
              icon={<RefreshCw aria-hidden className="h-3.5 w-3.5" />}
            >
              Re-price{!canReprice && " · Pro"}
            </Button>
          )}
        </header>

        <div className="divide-y divide-[var(--line-soft)]">
          {byAisle.map(([aisle, rows]) => (
            <div key={aisle}>
              <div className="sticky top-14 z-10 flex items-center justify-between gap-2 bg-[var(--surface-2)] px-4 py-1.5">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[var(--ink-3)]">
                  {aisle}
                </span>
                <span className="num text-[10.5px] text-[var(--ink-4)]">
                  {fmtMoney(rows.reduce((s, m) => s + (m.optional ? 0 : m.lineTotal), 0))}
                </span>
              </div>
              {rows.map((m) => (
                <MaterialRow
                  key={m.id}
                  material={m}
                  flash={changedIds.has(m.id)}
                  onPrice={onPrice}
                  readOnly={readOnly}
                />
              ))}
            </div>
          ))}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ink-3)]">
              Materials total
            </div>
            {optionalTotal > 0 && (
              <div className="text-[10.5px] text-[var(--ink-4)]">
                plus {fmtMoney(optionalTotal)} of optional extras
              </div>
            )}
          </div>
          <motion.span
            key={total}
            initial={{ opacity: 0.4, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            className="num text-[1.25rem] font-semibold text-[var(--ink)]"
          >
            {fmtMoney(total)}
          </motion.span>
        </footer>
      </Card>
    </div>
  );
}

function MaterialRow({
  material: m,
  flash,
  onPrice,
  readOnly,
}: {
  material: Material;
  flash?: boolean;
  onPrice?: (id: string, unitPrice: number) => void;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(m.unitPrice));

  const save = () => {
    const value = Number(draft);
    setEditing(false);
    if (!Number.isFinite(value) || value < 0 || value === m.unitPrice) return;
    onPrice?.(m.id, Math.round(value * 100) / 100);
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-2.5 transition-colors",
        flash && "flash",
        m.unitPrice === 0 && "bg-[color-mix(in_srgb,var(--warn)_7%,transparent)]",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-medium text-[var(--ink)]">{m.name}</span>
          {m.optional && <Badge>optional</Badge>}
          {m.userOverride && <Badge tone="accent">your price</Badge>}
        </div>
        {m.spec && (
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--ink-3)]">{m.spec}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[var(--ink-4)]">
          <span className="num">
            {m.quantity} {m.unit}
            {m.quantity === 1 ? "" : m.unit.endsWith("s") ? "" : "s"}
          </span>
          <span>×</span>
          {m.unitPrice > 0 ? (
            <SourceChip provenance={m.provenance} className="num text-[11px]">
              {fmtMoney(m.unitPrice)}
            </SourceChip>
          ) : (
            <span className="text-[var(--warn)]">no price found</span>
          )}
          {m.provenance.url && (
            <a
              href={m.provenance.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-0.5 text-[var(--ink-3)] underline-offset-2 hover:text-[var(--accent)] hover:underline"
            >
              {hostOf(m.provenance.url)}
              <ArrowUpRight aria-hidden className="h-2.5 w-2.5" />
            </a>
          )}
          {!readOnly && onPrice && (
            <button
              type="button"
              onClick={() => {
                setDraft(String(m.unitPrice));
                setEditing(true);
              }}
              className="inline-flex min-h-6 items-center gap-1 rounded px-1 text-[var(--ink-3)] hover:text-[var(--accent)]"
            >
              <Pencil aria-hidden className="h-2.5 w-2.5" />
              set my price
            </button>
          )}
        </div>

        {editing && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[13px] text-[var(--ink-3)]">$</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
              aria-label={`Your price for ${m.name}`}
              className={cn(fieldClass, "w-24 py-1.5")}
            />
            <Button size="sm" variant="primary" onClick={save}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>

      <motion.span
        key={m.lineTotal}
        initial={{ opacity: 0.35, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="num shrink-0 pt-0.5 text-[13.5px] font-semibold text-[var(--ink)]"
      >
        {fmtMoney(m.lineTotal)}
      </motion.span>
    </div>
  );
}
