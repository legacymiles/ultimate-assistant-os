"use client";

// Pipeline — every item every agent is working on, newest first, one table.

import { useMemo, useState } from "react";
import { compact, estimate, formatTime, itemViews, money } from "@/lib/money-agents/logic";
import type { MoneyAgents } from "@/lib/money-agents/useMoneyAgents";
import { STAGES, type Item, type ItemStage } from "@/lib/money-agents/types";

const LABEL: Record<ItemStage, string> = {
  idea: "Idea",
  script: "Script",
  rendering: "Making",
  ready: "Approve",
  approved: "Sent",
  posted: "Posted",
  rejected: "Skipped",
};

export function PipelineTab({
  m,
  stage,
  onStage,
  onOpenAgent,
}: {
  m: MoneyAgents;
  stage: ItemStage | "all";
  onStage: (s: ItemStage | "all") => void;
  onOpenAgent: (id: string) => void;
}) {
  const [agentId, setAgentId] = useState<string>("all");
  const [sel, setSel] = useState<string[]>([]);
  const agents = useMemo(() => new Map(m.board.agents.map((a) => [a.id, a])), [m.board.agents]);

  const rows = m.board.items.filter(
    (i) => agents.has(i.agentId) && (stage === "all" ? i.stage !== "rejected" : i.stage === stage) && (agentId === "all" || i.agentId === agentId),
  );
  const chosen = rows.filter((r) => sel.includes(r.id));
  const makeable = chosen.filter((i) => i.stage === "idea" || i.stage === "script");

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="mas-row">
        <div className="mas-checks" role="group" aria-label="Stage">
          {(["all", ...STAGES.map((s) => s.id), "rejected"] as (ItemStage | "all")[]).map((s) => (
            <button key={s} type="button" className="mas-check" data-on={stage === s} onClick={() => onStage(s)}>
              {s === "all" ? "All" : LABEL[s]}
            </button>
          ))}
        </div>
        <span className="mas-grow" />
        <select className="mas-select" style={{ width: "auto" }} value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Agent">
          <option value="all">Every agent</option>
          {m.board.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {chosen.length > 0 && (
        <div className="mas-row mas-panel mas-pad" style={{ padding: "10px 12px" }}>
          <strong>{chosen.length} selected</strong>
          <span className="mas-grow" />
          <button type="button" className="mas-btn" data-tone="go" data-size="sm" disabled={!makeable.length} onClick={() => void m.make(makeable).then(() => setSel([]))}>
            Make {makeable.length || ""} on my PC
          </button>
          <button
            type="button"
            className="mas-btn"
            data-size="sm"
            onClick={() => {
              chosen.forEach((i) => m.reject(i));
              setSel([]);
            }}
          >
            Skip
          </button>
          <button type="button" className="mas-btn" data-size="sm" data-tone="ghost" onClick={() => setSel([])}>
            Clear
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="mas-panel mas-empty">
          <h3>Nothing here</h3>
          <p>{m.board.agents.length ? "Open an agent to find moments or ideas — they land here." : "Make your first agent in Agents."}</p>
        </div>
      ) : (
        <div className="mas-table-wrap">
          <table className="mas-table stack">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={rows.length > 0 && rows.every((r) => sel.includes(r.id))}
                    onChange={(e) => setSel(e.target.checked ? rows.map((r) => r.id) : [])}
                  />
                </th>
                <th>Title</th>
                <th>Agent</th>
                <th>Stage</th>
                <th className="num">Score</th>
                <th className="num">Views</th>
                <th className="num">Est.</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <Row key={i.id} i={i} m={m} on={sel.includes(i.id)} toggle={() => toggle(i.id)} onOpenAgent={onOpenAgent} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ i, m, on, toggle, onOpenAgent }: { i: Item; m: MoneyAgents; on: boolean; toggle: () => void; onOpenAgent: (id: string) => void }) {
  const agent = m.board.agents.find((a) => a.id === i.agentId)!;
  const views = itemViews(i, m.personas);
  const est = estimate(i, agent, m.personas);
  const [editViews, setEditViews] = useState(false);
  return (
    <tr data-on={on}>
      <td>
        <input type="checkbox" checked={on} onChange={toggle} aria-label={`Select ${i.title}`} />
      </td>
      <td className="title clip" title={i.why}>
        {i.title || i.hook || "Untitled"}
        {i.start !== null && <span className="mas-muted mas-mono" style={{ fontSize: 11.5, marginLeft: 8 }}>{formatTime(i.start)}</span>}
      </td>
      <td data-hide-sm="true">
        <button type="button" className="mas-btn" data-size="sm" data-tone="ghost" onClick={() => onOpenAgent(agent.id)}>
          {agent.name}
        </button>
      </td>
      <td>
        <span className="mas-pill" data-stage={i.stage}>
          {LABEL[i.stage]}
        </span>
      </td>
      <td className="num" data-hide-sm="true">
        {i.score !== null ? <span className="mas-score" data-low={i.score < 60}>{i.score}</span> : "—"}
      </td>
      <td className="num">
        {editViews ? (
          <input
            className="mas-input"
            style={{ width: 96 }}
            type="number"
            min={0}
            autoFocus
            defaultValue={i.manualViews ?? views}
            onBlur={(e) => {
              const n = Number(e.target.value);
              m.patchItem(i.id, { manualViews: Number.isFinite(n) && n >= 0 ? n : null });
              setEditViews(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        ) : i.stage === "posted" || i.stage === "approved" ? (
          <button type="button" className="mas-btn" data-size="sm" data-tone="ghost" title="Type the views by hand" onClick={() => setEditViews(true)}>
            {compact(views)}
          </button>
        ) : (
          "—"
        )}
      </td>
      <td className="num mas-mint" data-hide-sm="true">{est ? money(est) : "—"}</td>
      <td className="num">
        {(i.stage === "idea" || i.stage === "script") && (
          <button type="button" className="mas-btn" data-size="sm" data-tone="go" onClick={() => void m.make([i])}>
            Make
          </button>
        )}
        {i.stage === "rejected" && (
          <button type="button" className="mas-btn" data-size="sm" onClick={() => m.restore(i)}>
            Bring back
          </button>
        )}
        {i.stage !== "approved" && i.stage !== "posted" && (
          <button type="button" className="mas-btn" data-size="sm" data-tone="ghost" aria-label="Delete" onClick={() => m.deleteItem(i)}>
            ×
          </button>
        )}
      </td>
    </tr>
  );
}
