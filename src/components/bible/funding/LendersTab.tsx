"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { LENDERS, type Lender, type LenderKind } from "@/lib/seed-content/financial-bible";

const KINDS: { id: LenderKind | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "bank", label: "Banks" },
  { id: "credit-union", label: "Credit unions" },
  { id: "issuer", label: "Card issuers" },
  { id: "fintech", label: "Fintech lines" },
  { id: "alt-lender", label: "Alt & personal loans" },
];

const money = (n?: number) => (n ? (n >= 1_000_000 ? `$${n / 1_000_000}M` : `$${Math.round(n / 1000)}k`) : "");

function products(l: Lender) {
  return l.products
    .map((p) => `${p.side === "business" ? "Biz" : "Personal"} ${p.kind.replace("-", " ")}${p.max ? ` ≤${money(p.max)}` : ""}${p.docs === "none" ? " · no doc" : ""}`)
    .join(", ");
}

function mins(l: Lender) {
  return [l.minScore && `${l.minScore}+`, l.minTibMonths && `${l.minTibMonths} mo`, l.minMonthlyRevenue && `${money(l.minMonthlyRevenue)}/mo`]
    .filter(Boolean)
    .join(" · ");
}

export function LendersTab({ focus }: { focus: string | null }) {
  const [kind, setKind] = useState<LenderKind | "all">("all");
  const [side, setSide] = useState<"any" | "personal" | "business">("any");
  const [bureau, setBureau] = useState<"any" | "EX" | "TU" | "EQ">("any");
  const [softOnly, setSoftOnly] = useState(false);
  const [noDoc, setNoDoc] = useState(false);
  const [state, setState] = useState("");
  const [open, setOpen] = useState<string | null>(focus);

  useEffect(() => {
    if (focus) {
      setOpen(focus);
      setKind("all");
    }
  }, [focus]);

  const rows = useMemo(() => {
    const st = state.trim().toUpperCase();
    return LENDERS.filter(
      (l) =>
        (kind === "all" || l.kind === kind) &&
        (side === "any" || l.products.some((p) => p.side === side)) &&
        (bureau === "any" || l.bureaus.includes(bureau)) &&
        (!softOnly || l.pull === "soft" || l.pull === "soft-prequal") &&
        (!noDoc || l.products.some((p) => p.docs === "none")) &&
        (!st || !l.states?.length || l.states.includes(st)),
    );
  }, [kind, side, bureau, softOnly, noDoc, state]);

  return (
    <div>
      <div className="fund-filters">
        <div className="bible-choice" role="radiogroup" aria-label="Lender type">
          {KINDS.map((k) => (
            <label key={k.id}>
              <input type="radio" name="kind" checked={kind === k.id} onChange={() => setKind(k.id)} />
              {k.label}
            </label>
          ))}
        </div>
        <div className="fund-filter-row">
          <select value={side} onChange={(e) => setSide(e.target.value as typeof side)} aria-label="Personal or business">
            <option value="any">Personal + business</option>
            <option value="personal">Personal products</option>
            <option value="business">Business products</option>
          </select>
          <select value={bureau} onChange={(e) => setBureau(e.target.value as typeof bureau)} aria-label="Bureau pulled">
            <option value="any">Any bureau</option>
            <option value="EX">Pulls Experian</option>
            <option value="TU">Pulls TransUnion</option>
            <option value="EQ">Pulls Equifax</option>
          </select>
          <label className="fund-check">
            <input type="checkbox" checked={softOnly} onChange={(e) => setSoftOnly(e.target.checked)} /> Soft pull / prequal
          </label>
          <label className="fund-check">
            <input type="checkbox" checked={noDoc} onChange={(e) => setNoDoc(e.target.checked)} /> Has a no-doc product
          </label>
          <input className="fund-state" value={state} maxLength={2} onChange={(e) => setState(e.target.value)} placeholder="State" aria-label="Client state" />
          <span className="fund-count">{rows.length} lenders</span>
        </div>
      </div>

      <div className="bible-table-wrap fund-table-wrap">
        <table className="bible-table fund-table">
          <thead>
            <tr>
              <th>Lender</th>
              <th>Products</th>
              <th>Pull</th>
              <th>Bureaus</th>
              <th>Minimums</th>
              <th>States</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const isOpen = open === l.id;
              return (
                <Fragment key={l.id}>
                  <tr data-kb={l.id} data-open={isOpen} onClick={() => setOpen(isOpen ? null : l.id)} aria-expanded={isOpen}>
                    <td>
                      <div className="bible-idea-title">{l.name}</div>
                      {l.verify && <div className="fund-verify">Check: {l.verify}</div>}
                    </td>
                    <td className="fund-products">{products(l)}</td>
                    <td>{l.pull === "hard" ? "Hard" : l.pull ? "Soft" : <span className="bible-muted">—</span>}</td>
                    <td className="bible-num">{l.bureaus.join(" ") || <span className="bible-muted">—</span>}</td>
                    <td className="bible-num">{mins(l) || <span className="bible-muted">—</span>}</td>
                    <td className="fund-states">{l.states?.join(" ") || <span className="bible-muted">All</span>}</td>
                  </tr>
                  {isOpen && (
                    <tr className="fund-detail-row">
                      <td colSpan={6}>
                        <div className="fund-detail">
                          {l.products.some((p) => p.note) && (
                            <section>
                              <h4>Products</h4>
                              <ul>
                                {l.products.map((p, i) => (
                                  <li key={i}>
                                    {p.side} {p.kind}
                                    {p.max ? ` up to ${money(p.max)}` : ""}
                                    {p.docs ? ` · ${p.docs === "none" ? "no" : p.docs}-doc` : ""}
                                    {p.note ? ` — ${p.note}` : ""}
                                  </li>
                                ))}
                              </ul>
                            </section>
                          )}
                          {l.rules?.length ? (
                            <section>
                              <h4>Rules</h4>
                              <ul>{l.rules.map((r) => <li key={r}>{r}</li>)}</ul>
                            </section>
                          ) : null}
                          {l.tips?.length ? (
                            <section>
                              <h4>Tips</h4>
                              <ul>{l.tips.map((r) => <li key={r}>{r}</li>)}</ul>
                            </section>
                          ) : null}
                          {(l.membership || l.commission) && (
                            <section>
                              {l.membership && (
                                <p>
                                  <b>How to join:</b> {l.membership}
                                </p>
                              )}
                              {l.commission && (
                                <p>
                                  <b>Pays brokers:</b> {l.commission}
                                </p>
                              )}
                            </section>
                          )}
                          <p className="fund-src">From {l.src.join(", ")}</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
