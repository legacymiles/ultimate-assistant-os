"use client";

import { useEffect, useMemo, useState } from "react";
import { EMPTY_PROFILE, qualify, type CheckState, type ClientProfile } from "@/lib/bible/funding/qualify";

const KEY = "financial-bible:funding:client";

const VERDICT: Record<string, { word: string; line: string }> = {
  ready: { word: "Ready to fund", line: "Clean enough to run a sequence now." },
  almost: { word: "Almost", line: "Fundable, but fix the warnings first and the number goes up." },
  "not-yet": { word: "Not yet", line: "Something below blocks approvals. Fix it before any application." },
  incomplete: { word: "Enter the report numbers", line: "Score, utilization and seasoned cards are the minimum to judge a file." },
};

const MARK: Record<CheckState, string> = { pass: "✓", warn: "!", fail: "✕", unknown: "–" };

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

type NumKey = {
  [K in keyof ClientProfile]: ClientProfile[K] extends number | null ? K : never;
}[keyof ClientProfile];

const NUM_FIELDS: { key: NumKey; label: string; hint: string; step?: number }[] = [
  { key: "score", label: "Lowest FICO", hint: "of the three bureaus" },
  { key: "utilization", label: "Utilization %", hint: "overall revolving" },
  { key: "availableCredit", label: "Personal available credit $", hint: "total card limits in their name", step: 1000 },
  { key: "seasonedCards", label: "Seasoned bank cards", hint: "2+ yrs old, $2,500+ limit" },
  { key: "avgAgeYears", label: "Average account age (yrs)", hint: "" },
  { key: "recentInquiries", label: "Hard inquiries, 6 months", hint: "all bureaus" },
  { key: "newAccounts", label: "New accounts, 6 months", hint: "" },
  { key: "tibMonths", label: "Months in business", hint: "0 if not formed" },
  { key: "monthlyRevenue", label: "Monthly deposits $", hint: "business account", step: 1000 },
  { key: "bankBalance", label: "90-day avg balance $", hint: "business checking", step: 500 },
];

function load(): ClientProfile {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return { ...EMPTY_PROFILE, ...(JSON.parse(raw) as Partial<ClientProfile>) };
  } catch {
    /* storage blocked — start empty */
  }
  return EMPTY_PROFILE;
}

export function QualifyTab({ onOpenLender }: { onOpenLender: (id: string) => void }) {
  const [p, setP] = useState<ClientProfile>(EMPTY_PROFILE);
  useEffect(() => setP(load()), []);
  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* fine — the form still works */
    }
  }, [p]);

  const r = useMemo(() => qualify(p), [p]);
  const v = VERDICT[r.verdict];
  const set = <K extends keyof ClientProfile>(k: K, val: ClientProfile[K]) => setP((x) => ({ ...x, [k]: val }));

  return (
    <div className="fund-qualify">
      <form className="bible-form fund-form" onSubmit={(e) => e.preventDefault()}>
        <h2>The client&rsquo;s numbers</h2>
        <p>Read these off the three-bureau report and their bank statements. Saved on this device until you clear it.</p>
        <div className="fund-grid">
          {NUM_FIELDS.map((f) => (
            <div className="bible-field" key={f.key}>
              <label htmlFor={`q-${f.key}`}>
                {f.label} {f.hint && <em>{f.hint}</em>}
              </label>
              <input
                id={`q-${f.key}`}
                type="number"
                inputMode="decimal"
                step={f.step ?? 1}
                value={p[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
          ))}
          <div className="bible-field">
            <label htmlFor="q-state">
              State <em>2 letters</em>
            </label>
            <input id="q-state" type="text" maxLength={2} value={p.state} onChange={(e) => set("state", e.target.value.toUpperCase())} />
          </div>
        </div>
        <div className="bible-choice fund-flags">
          <label>
            <input type="checkbox" checked={p.latesIn24} onChange={(e) => set("latesIn24", e.target.checked)} /> Late payment in 24 months
          </label>
          <label>
            <input type="checkbox" checked={p.derogatories} onChange={(e) => set("derogatories", e.target.checked)} /> Bankruptcy / collection / charge-off
          </label>
          <label>
            <input type="checkbox" checked={p.bankFlag} onChange={(e) => set("bankFlag", e.target.checked)} /> ChexSystems or Early Warning flag
          </label>
        </div>
        <div className="bible-form-actions">
          <button type="button" className="bb" data-tone="ghost" onClick={() => setP(EMPTY_PROFILE)}>
            Clear client
          </button>
        </div>
      </form>

      <article className="bible-sheet fund-verdict" aria-live="polite">
        <div className="bible-pin-head">
          <div className="bible-total">
            <span className="bible-total-k">Verdict</span>
            <span className="fund-verdict-word" data-v={r.verdict}>
              {v.word}
            </span>
          </div>
          {r.estimate && (
            <div className="bible-total">
              <span className="bible-total-k">Likely business funding</span>
              <span className="bible-total-v" data-range="true">
                {money(r.estimate.low)}–{money(r.estimate.high)}
              </span>
            </div>
          )}
        </div>
        <div className="bible-sheet-body">
          <p className="bible-summary">{v.line}</p>
          {r.estimate && <p className="fund-basis">Basis: {r.estimate.basis}. Your 10% on the midpoint ≈ {money(Math.round((r.estimate.low + r.estimate.high) / 20))}.</p>}

          <div className="bible-block">
            <h3>Checks</h3>
            <ul className="fund-checks">
              {r.checks.map((c) => (
                <li key={c.id} data-s={c.state}>
                  <span className="fund-mark" aria-label={c.state}>
                    {MARK[c.state]}
                  </span>
                  <div>
                    <b>{c.label}</b> <span>{c.detail}</span>
                    {c.fix && <p>{c.fix}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {r.lenders.length > 0 && (
            <div className="bible-block">
              <h3>
                Where to apply — {r.lenders.length} fit · soft pulls first · spread: EX {r.bureauSpread.EX} · TU {r.bureauSpread.TU} · EQ{" "}
                {r.bureauSpread.EQ}
              </h3>
              <table className="fund-short">
                <tbody>
                  {r.lenders.slice(0, 40).map((m) => (
                    <tr key={m.lender.id} onClick={() => onOpenLender(m.lender.id)}>
                      <td>
                        <button type="button" className="fund-link" onClick={() => onOpenLender(m.lender.id)}>
                          {m.lender.name}
                        </button>
                      </td>
                      <td>{m.lender.bureaus.join("/") || "—"}</td>
                      <td>{m.lender.pull === "hard" ? "hard" : m.lender.pull ? "soft" : "—"}</td>
                      <td className="fund-why">{m.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </article>
    </div>
  );
}
