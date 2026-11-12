"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check, ClipboardCopy, ExternalLink, Share2, Store } from "lucide-react";
import { Badge, Button, Card } from "../ui";
import { useToast } from "../Providers";
import { fmtMoney, recostMaterials } from "@/lib/buildflip-2/calc";
import type { Project } from "@/lib/buildflip-2/types";
import { cn, hostOf } from "@/lib/buildflip-2/ui";

/**
 * Feature 10 — the store-ready shopping list.
 *
 * Built for one hand in a hardware-store aisle: grouped by aisle, big tap
 * targets, a running total of what's left to buy, and it exports to a note or
 * the share sheet. Checking things off is instant locally and saved in the
 * background, so a dead spot in the store never loses a tick.
 */

export default function ShoppingList({
  project,
  onChange,
  readOnly,
}: {
  project: Project;
  onChange?: (items: { materialId: string; checked: boolean }[]) => void;
  readOnly?: boolean;
}) {
  const { toast } = useToast();
  const materials = useMemo(
    () => recostMaterials(project.materials, project.dimensions),
    [project.materials, project.dimensions],
  );

  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(project.shopping.map((s) => [s.materialId, s.checked])),
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True while a tick is typed but not yet saved. */
  const dirty = useRef(false);
  const latest = useRef(checked);
  latest.current = checked;

  /**
   * Only accept server state when nothing local is pending.
   *
   * The provider replaces `projects` on focus, on reconnect and every 90s, and
   * `project.shopping` is a new array each time. Re-syncing unconditionally
   * meant: tick A → phone wakes → refresh lands → A visually un-ticks and is
   * dropped from local state → tick B → the debounce saves {A:false, B:true}
   * and A's tick is gone for good. In a hardware-store aisle, which is the
   * entire use case.
   */
  useEffect(() => {
    if (dirty.current) return;
    setChecked(Object.fromEntries(project.shopping.map((s) => [s.materialId, s.checked])));
  }, [project.shopping]);

  const flush = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!dirty.current || !onChange) return;
    dirty.current = false;
    onChange(
      materials.map((m) => ({ materialId: m.id, checked: Boolean(latest.current[m.id]) })),
    );
  }, [materials, onChange]);

  // Never lose a pending tick to a navigation or a closed tab (R6).
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flush();
    };
  }, [flush]);

  const toggle = (id: string) => {
    if (readOnly) return;
    const next = { ...checked, [id]: !checked[id] };
    setChecked(next);
    latest.current = next;
    if (!onChange) return;
    dirty.current = true;
    // Debounced so a run of ticks is one write, and a lost connection retries.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      dirty.current = false;
      onChange(
        materials.map((m) => ({ materialId: m.id, checked: Boolean(latest.current[m.id]) })),
      );
    }, 700);
  };

  const byAisle = useMemo(() => {
    const groups = new Map<string, typeof materials>();
    for (const m of materials) {
      const list = groups.get(m.aisle) ?? [];
      list.push(m);
      groups.set(m.aisle, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [materials]);

  const remaining = materials.filter((m) => !checked[m.id] && !m.optional);
  const remainingTotal = remaining.reduce((s, m) => s + m.lineTotal, 0);
  const doneCount = materials.filter((m) => checked[m.id]).length;

  const asText = () =>
    [
      `SHOPPING LIST — ${project.title}`,
      "",
      ...byAisle.flatMap(([aisle, rows]) => [
        `${aisle.toUpperCase()}`,
        ...rows.map(
          (m) =>
            `  [${checked[m.id] ? "x" : " "}] ${m.quantity} ${m.unit} — ${m.name}${
              m.spec ? ` (${m.spec})` : ""
            } — ${fmtMoney(m.lineTotal)}`,
        ),
        "",
      ]),
      `TOTAL STILL TO BUY: ${fmtMoney(remainingTotal)}`,
      "",
      "Priced by BuildFlip",
    ].join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      toast({ tone: "success", message: "Shopping list copied — paste it into a note." });
    } catch {
      toast({
        tone: "error",
        message: "Your browser blocked the clipboard. Try the Share button instead.",
      });
    }
  };

  const share = async () => {
    if (!navigator.share) {
      void copy();
      return;
    }
    try {
      await navigator.share({ title: `Shopping list — ${project.title}`, text: asText() });
    } catch {
      /* the user cancelled the share sheet; nothing to say */
    }
  };

  return (
    <div className="space-y-3">
      <Card className="sticky top-14 z-20 p-3.5 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--ink-3)]">
              Still to buy
            </div>
            <motion.div
              key={remainingTotal}
              initial={{ opacity: 0.4, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              className="num text-[1.375rem] font-semibold leading-none text-[var(--ink)]"
            >
              {fmtMoney(remainingTotal)}
            </motion.div>
            <div className="mt-1 text-[11px] text-[var(--ink-4)]">
              {doneCount} of {materials.length} ticked off
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={copy}
              icon={<ClipboardCopy aria-hidden className="h-3.5 w-3.5" />}
            >
              Copy
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={share}
              icon={<Share2 aria-hidden className="h-3.5 w-3.5" />}
            >
              Share
            </Button>
          </div>
        </div>
      </Card>

      {byAisle.map(([aisle, rows]) => {
        const aisleLeft = rows.filter((m) => !checked[m.id]).length;
        return (
          <Card key={aisle} className="overflow-hidden">
            <header className="flex items-center justify-between gap-2 border-b border-[var(--line-soft)] bg-[var(--surface-2)] px-4 py-2.5">
              <h4 className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ink)]">
                <Store aria-hidden className="h-3.5 w-3.5 text-[var(--ink-3)]" />
                {aisle}
              </h4>
              <Badge tone={aisleLeft === 0 ? "profit" : "neutral"}>
                {aisleLeft === 0 ? "all got" : `${aisleLeft} left`}
              </Badge>
            </header>
            <ul>
              {rows.map((m) => {
                const on = Boolean(checked[m.id]);
                return (
                  <li key={m.id} className="border-b border-[var(--line-soft)] last:border-0">
                    <div className="flex items-stretch">
                      <button
                        type="button"
                        onClick={() => toggle(m.id)}
                        disabled={readOnly}
                        aria-pressed={on}
                        className={cn(
                          // One-handed: the whole row is the target, 56px tall.
                          "flex min-h-[56px] flex-1 items-center gap-3 px-4 py-2.5 text-left transition-colors",
                          on ? "bg-[var(--profit-soft)]" : "hover:bg-[var(--surface-2)]",
                          readOnly && "cursor-default",
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-7 w-7 shrink-0 place-items-center rounded-[8px] border-2 transition-colors",
                            on
                              ? "border-[var(--profit)] bg-[var(--profit)] text-[#06251a]"
                              : "border-[var(--line)] text-transparent",
                          )}
                        >
                          <Check aria-hidden className="h-4 w-4" strokeWidth={3} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block text-[13.5px] font-medium leading-snug",
                              on
                                ? "text-[var(--ink-3)] line-through decoration-[var(--ink-4)]"
                                : "text-[var(--ink)]",
                            )}
                          >
                            {m.name}
                          </span>
                          <span className="num mt-0.5 block text-[11.5px] text-[var(--ink-3)]">
                            {m.quantity} {m.unit} · {fmtMoney(m.lineTotal)}
                            {m.optional && " · optional"}
                          </span>
                        </span>
                      </button>
                      {m.provenance.url && (
                        <a
                          href={m.provenance.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          aria-label={`Open the listing for ${m.name} on ${hostOf(m.provenance.url)}`}
                          className="grid w-12 shrink-0 place-items-center border-l border-[var(--line-soft)] text-[var(--ink-4)] transition hover:bg-[var(--surface-2)] hover:text-[var(--accent)]"
                        >
                          <ExternalLink aria-hidden className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
