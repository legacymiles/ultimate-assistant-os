"use client";

// Agents — the ledger of every money agent, and the workspace of the one open.

import { useEffect, useRef, useState } from "react";
import { compact, money, needsPersona, newAgent, summarize } from "@/lib/money-agents/logic";
import type { MoneyAgents } from "@/lib/money-agents/useMoneyAgents";
import { AGENT_KINDS, type AgentKind } from "@/lib/money-agents/types";
import { AgentWorkspace } from "./AgentWorkspace";

export function AgentsTab({ m, focus, onFocus }: { m: MoneyAgents; focus: string | null; onFocus: (id: string | null) => void }) {
  const [adding, setAdding] = useState(m.board.agents.length === 0);
  const work = useRef<HTMLDivElement>(null);
  const open = m.board.agents.find((a) => a.id === focus) ?? null;

  useEffect(() => {
    if (open) work.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = (kind: AgentKind) => {
    const personaId = m.personas.length === 1 ? m.personas[0].id : null;
    const a = newAgent(kind, {
      personaId,
      accountIds: personaId ? m.personas[0].accounts.map((x) => x.id) : [],
    });
    m.saveAgent(a);
    setAdding(false);
    onFocus(a.id);
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {m.board.agents.length > 0 && (
        <div className="mas-table-wrap">
          <table className="mas-table stack">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Kind</th>
                <th>Posts as</th>
                <th className="num">Waiting</th>
                <th className="num">Live</th>
                <th className="num">Views</th>
                <th className="num">Est.</th>
                <th className="num">Paid</th>
              </tr>
            </thead>
            <tbody>
              {m.board.agents.map((a) => {
                const s = summarize(a, m.board, m.personas);
                const persona = m.personas.find((p) => p.id === a.personaId);
                return (
                  <tr key={a.id} data-click="true" data-on={a.id === focus} onClick={() => onFocus(a.id === focus ? null : a.id)}>
                    <td className="title">
                      {a.name}
                      {a.status === "paused" && (
                        <span className="mas-pill" data-stage="paused" style={{ marginLeft: 8 }}>
                          paused
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="mas-pill" data-kind={a.kind}>
                        {AGENT_KINDS.find((k) => k.id === a.kind)?.short}
                      </span>
                    </td>
                    <td data-hide-sm="true">{persona ? persona.name : <span className="mas-warn">pick a persona</span>}</td>
                    <td className="num mas-gold">{s.waiting || "—"}</td>
                    <td className="num" data-hide-sm="true">{s.live || "—"}</td>
                    <td className="num" data-hide-sm="true">{s.views ? compact(s.views) : "—"}</td>
                    <td className="num mas-mint" data-hide-sm="true">{s.estimated ? money(s.estimated) : "—"}</td>
                    <td className="num mas-gold">{s.paid ? money(s.paid) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding ? (
        <section>
          <h2 className="mas-h2">{m.board.agents.length ? "New agent" : "Make your first money agent"}</h2>
          <p className="mas-sub">Pick what it does. You can change everything after.</p>
          <div className="mas-doors">
            {AGENT_KINDS.map((k) => (
              <button key={k.id} type="button" className="mas-door" onClick={() => create(k.id)}>
                <span className="mas-pill" data-kind={k.id}>
                  {k.short}
                </span>
                <strong>{k.label}</strong>
                <p>{k.blurb}</p>
              </button>
            ))}
          </div>
          {m.board.agents.length > 0 && (
            <button type="button" className="mas-btn" data-tone="ghost" style={{ marginTop: 10 }} onClick={() => setAdding(false)}>
              Cancel
            </button>
          )}
        </section>
      ) : (
        <div className="mas-row">
          <button type="button" className="mas-btn" data-tone="go" onClick={() => setAdding(true)}>
            + New agent
          </button>
          {!open && <span className="mas-muted">Press an agent to open it.</span>}
        </div>
      )}

      <div ref={work}>
        {open && (
          <>
            {needsPersona(open, m.personas) && (
              <p className="mas-note" style={{ marginBottom: 12 }}>
                This agent has nowhere to post yet. Pick a persona in its settings below — it posts through that persona&rsquo;s accounts in
                Personas Studio.
              </p>
            )}
            <AgentWorkspace key={open.id} m={m} agent={open} onClose={() => onFocus(null)} />
          </>
        )}
      </div>
    </div>
  );
}
