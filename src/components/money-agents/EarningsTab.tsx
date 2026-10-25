"use client";

// Earnings — what actually arrived (gold) next to what views say should (mint).

import { useState } from "react";
import { compact, dailyPaid, localDay, money, summarize } from "@/lib/money-agents/logic";
import type { MoneyAgents } from "@/lib/money-agents/useMoneyAgents";
import { AGENT_KINDS, PAYOUT_SOURCES, type PayoutSource } from "@/lib/money-agents/types";

export function EarningsTab({ m, onOpenAgent }: { m: MoneyAgents; onOpenAgent: (id: string) => void }) {
  const days = dailyPaid(m.board.payouts, 30);
  const peak = Math.max(1, ...days.map((d) => d.amount));
  const rows = m.board.agents
    .map((a) => ({ a, s: summarize(a, m.board, m.personas) }))
    .sort((x, y) => y.s.paid - x.s.paid || y.s.estimated - x.s.estimated);

  const [agentId, setAgentId] = useState(m.board.agents[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(localDay());
  const [source, setSource] = useState<PayoutSource>("campaign");
  const [note, setNote] = useState("");
  const value = Number(amount);
  const canLog = Boolean(agentId) && Number.isFinite(value) && value > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="mas-panel mas-pad">
        <div className="mas-row">
          <h2 className="mas-h2 mas-grow" style={{ margin: 0 }}>
            Last 30 days
          </h2>
          <span className="mas-gold mas-mono">{money(days.reduce((s, d) => s + d.amount, 0))}</span>
        </div>
        <div className="mas-chart" role="img" aria-label="Money paid per day for the last 30 days">
          {days.map((d) => (
            <div
              key={d.day}
              className="mas-chart-bar"
              data-paid={d.amount > 0}
              style={{ height: `${d.amount ? Math.max(6, (d.amount / peak) * 100) : 3}%` }}
              title={`${d.day}: ${money(d.amount)}`}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mas-h2">By agent</h2>
        <p className="mas-sub">Paid is money you logged. Estimated is views × each agent&rsquo;s rate per 1K — a guide, not money.</p>
        {rows.length === 0 ? (
          <div className="mas-panel mas-empty">
            <p>No agents yet.</p>
          </div>
        ) : (
          <div className="mas-table-wrap">
            <table className="mas-table stack">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Kind</th>
                  <th className="num">Live</th>
                  <th className="num">Views</th>
                  <th className="num">Est.</th>
                  <th className="num">Paid</th>
                  <th className="num">Paid / video</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ a, s }) => (
                  <tr key={a.id} data-click="true" onClick={() => onOpenAgent(a.id)}>
                    <td className="title">{a.name}</td>
                    <td data-hide-sm="true">
                      <span className="mas-pill" data-kind={a.kind}>
                        {AGENT_KINDS.find((k) => k.id === a.kind)?.short}
                      </span>
                    </td>
                    <td className="num" data-hide-sm="true">{s.live || "—"}</td>
                    <td className="num">{s.views ? compact(s.views) : "—"}</td>
                    <td className="num mas-mint" data-hide-sm="true">{s.estimated ? money(s.estimated) : "—"}</td>
                    <td className="num mas-gold">{s.paid ? money(s.paid) : "—"}</td>
                    <td className="num" data-hide-sm="true">{s.perVideo ? money(s.perVideo) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mas-panel mas-pad" style={{ display: "grid", gap: 10 }}>
        <h2 className="mas-h2" style={{ margin: 0 }}>
          Log money that came in
        </h2>
        <div className="mas-grid-4">
          <label className="mas-field">
            <span>Agent</span>
            <select className="mas-select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {!m.board.agents.length && <option value="">Make an agent first</option>}
              {m.board.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mas-field">
            <span>Amount ($)</span>
            <input className="mas-input" type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="mas-field">
            <span>Date</span>
            <input className="mas-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="mas-field">
            <span>From</span>
            <select className="mas-select" value={source} onChange={(e) => setSource(e.target.value as PayoutSource)}>
              {PAYOUT_SOURCES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mas-row">
          <input className="mas-input mas-grow" style={{ flexBasis: 220 }} value={note} placeholder="Note (optional)" onChange={(e) => setNote(e.target.value)} />
          <button
            type="button"
            className="mas-btn"
            data-tone="gold"
            disabled={!canLog}
            onClick={() => {
              m.logPayout({ agentId, amount: Math.round(value * 100) / 100, date, source, note: note.trim() });
              setAmount("");
              setNote("");
            }}
          >
            Log payout
          </button>
        </div>
      </section>

      {m.board.payouts.length > 0 && (
        <section>
          <h2 className="mas-h2">Payouts</h2>
          <div className="mas-table-wrap">
            <table className="mas-table stack">
              <tbody>
                {m.board.payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="mas-mono mas-muted">{p.date}</td>
                    <td className="title">{m.board.agents.find((a) => a.id === p.agentId)?.name ?? "—"}</td>
                    <td data-hide-sm="true" className="mas-muted">
                      {PAYOUT_SOURCES.find((s) => s.id === p.source)?.label}
                      {p.note ? ` · ${p.note}` : ""}
                    </td>
                    <td className="num mas-gold">{money(p.amount)}</td>
                    <td className="num">
                      <button type="button" className="mas-btn" data-size="sm" data-tone="ghost" aria-label="Remove payout" onClick={() => m.deletePayout(p.id)}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
