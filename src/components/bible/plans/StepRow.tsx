"use client";

// ---------------------------------------------------------------------------
// One step.
//
// Three behaviours here carry the design's weight:
//
//   * Ticking draws an ink line across the row and the pinned total re-counts
//     at the same moment. Crossing something off paper, with the money moving.
//   * Editing any price sets that item's provenance to `user`, and the tag
//     changing to YOURS is the feedback that says "nothing will overwrite this
//     now" — which is a promise ops.ts and verify.ts both keep.
//   * A legal flag is a question with somebody to ask, rendered as red thread
//     in the margin, and it cannot be collapsed away.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { fmtMoney, stepCost } from "@/lib/bible/totals";
import type { Material, Money, Provenance, Step } from "@/lib/bible/types";

export function StepRow({
  step,
  index,
  readOnly,
  onChange,
}: {
  step: Step;
  index: number;
  readOnly: boolean;
  onChange: (step: Step) => void;
}) {
  const [open, setOpen] = useState(false);
  const cost = stepCost(step);
  const hasMore =
    step.materials.length > 0
    || step.suppliers.length > 0
    || !!step.check
    || !!step.legal
    || !!step.note
    || !readOnly;

  return (
    <div
      className="bible-step"
      data-done={step.done}
      data-skipped={step.skipped}
      data-legal={!!step.legal}
    >
      <span className="bible-step-strike" aria-hidden="true" />
      <span className="bible-step-n">{index}.</span>

      <button
        type="button"
        className="bible-tick"
        data-on={step.done}
        disabled={readOnly}
        aria-pressed={step.done}
        aria-label={step.done ? `Mark "${step.title}" not done` : `Mark "${step.title}" done`}
        onClick={() => onChange({ ...step, done: !step.done })}
      />

      <div className="bible-step-main">
        <div className="bible-step-title">
          {hasMore ? (
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
              {step.title}
            </button>
          ) : (
            step.title
          )}
        </div>
        {step.detail && <p className="bible-step-detail">{step.detail}</p>}
        {step.hours ? (
          <p className="bible-step-detail" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
            {step.hours}h hands-on
          </p>
        ) : null}
      </div>

      <div className="bible-step-cost">
        <b>{fmtMoney(cost)}</b>
        {step.costNote && <small>{step.costNote}</small>}
        {cost && <span className="bible-prov" data-p={step.provenance}>{provLabel(step.provenance)}</span>}
      </div>

      {open && (
        <div className="bible-step-more">
          {!!step.materials.length && (
            <>
              <p className="bible-mini-h">Materials</p>
              <table className="bible-mat">
                <tbody>
                  {step.materials.map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td style={{ whiteSpace: "nowrap", color: "var(--ink-2)" }}>
                        {m.qty} {m.unit}
                      </td>
                      <td>
                        {readOnly ? (
                          <>
                            {fmtMoney(m.unitCost ?? null)}{" "}
                            <span className="bible-prov" data-p={m.provenance}>
                              {provLabel(m.provenance)}
                            </span>
                          </>
                        ) : (
                          <MoneyInput
                            money={m.unitCost}
                            provenance={m.provenance}
                            onSet={(unitCost) =>
                              onChange({
                                ...step,
                                materials: step.materials.map((x): Material =>
                                  x.id === m.id ? { ...x, unitCost, provenance: "user" } : x),
                              })
                            }
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {!!step.suppliers.length && (
            <>
              <p className="bible-mini-h">Where to buy it</p>
              {step.suppliers.map((s) => (
                <div key={s.id} className="bible-sup">
                  <b>{s.name}</b>
                  {s.what && <span> — {s.what}</span>}
                  {s.price && <span> · {fmtMoney(s.price)}</span>}
                  {s.where && <div><span>{s.where}</span></div>}
                  {s.phone && <div><span>{s.phone}</span></div>}
                  {s.url && (
                    <div>
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        {hostOf(s.url)}
                      </a>
                    </div>
                  )}
                  {/* The receipt: a verified price says where it was read and when. */}
                  {s.source && (
                    <span className="bible-src" title={s.source}>
                      ✓ found at {hostOf(s.source)}
                      {s.foundAt ? ` on ${new Date(s.foundAt).toLocaleDateString()}` : ""}
                    </span>
                  )}
                </div>
              ))}
            </>
          )}

          {step.check && (
            <p className="bible-check">
              <b>How you know it is right</b>
              {step.check}
            </p>
          )}

          {step.legal && (
            <div className="bible-legal">
              <b>Check this before you rely on it</b>
              {step.legal.question}
              <div className="bible-legal-ask">
                Ask: <b>{step.legal.whoToAsk}</b>. This app does not know the rules where you are and
                will not pretend to.
              </div>
            </div>
          )}

          {!readOnly && (
            <>
              {!step.materials.length && (
                <>
                  <p className="bible-mini-h">What this step costs</p>
                  <div style={{ marginBottom: 14 }}>
                    <MoneyInput
                      money={step.cost}
                      provenance={step.provenance}
                      onSet={(cost) => onChange({ ...step, cost, provenance: "user" })}
                    />
                  </div>
                </>
              )}

              <p className="bible-mini-h">Your note</p>
              <textarea
                className="bible-note"
                rows={2}
                value={step.note ?? ""}
                placeholder="What you actually did, what it really cost, who you spoke to"
                onChange={(e) => onChange({ ...step, note: e.target.value })}
              />

              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="bb"
                  onClick={() => onChange({ ...step, skipped: !step.skipped })}
                >
                  {step.skipped ? "Put this step back" : "Skip this step"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function provLabel(p: Provenance): string {
  return p === "user" ? "yours" : p;
}

/**
 * A low–high pair, because every cost in this app is a range.
 *
 * Typing in either box marks the value `user`, which is the one provenance
 * nothing else may overwrite. Leaving both empty clears the cost rather than
 * writing a zero — a step that costs nothing and a step nobody has priced are
 * different facts and the total treats them differently.
 */
function MoneyInput({
  money,
  provenance,
  onSet,
}: {
  money?: Money;
  provenance: Provenance;
  onSet: (money: Money | undefined) => void;
}) {
  const currency = money?.currency ?? "USD";
  const [low, setLow] = useState(money ? String(money.low) : "");
  const [high, setHigh] = useState(money ? String(money.high) : "");

  const commit = (nextLow: string, nextHigh: string) => {
    const l = Number(nextLow);
    const h = Number(nextHigh === "" ? nextLow : nextHigh);
    if (nextLow === "" && nextHigh === "") {
      onSet(undefined);
      return;
    }
    if (!Number.isFinite(l) || !Number.isFinite(h)) return;
    onSet({ low: Math.min(l, h), high: Math.max(l, h), currency });
  };

  return (
    <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
      <input
        type="number"
        min={0}
        value={low}
        aria-label="Lowest it could cost"
        onChange={(e) => setLow(e.target.value)}
        onBlur={() => commit(low, high)}
      />
      <span style={{ color: "var(--ink-3)" }}>–</span>
      <input
        type="number"
        min={0}
        value={high}
        aria-label="Highest it could cost"
        onChange={(e) => setHigh(e.target.value)}
        onBlur={() => commit(low, high)}
      />
      <span className="bible-prov" data-p={provenance}>{provLabel(provenance)}</span>
    </span>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}
