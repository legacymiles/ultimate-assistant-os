"use client";

// One agent, opened: what it does, where it posts, and its work.

import { useState } from "react";
import { accountsOf, formatTime } from "@/lib/money-agents/logic";
import type { MoneyAgents } from "@/lib/money-agents/useMoneyAgents";
import { AGENT_KINDS, type Agent, type Aspect, type ItemStage } from "@/lib/money-agents/types";
import { PLATFORM_NAME } from "@/lib/social-personas/types";
import { ClipWork } from "./ClipWork";
import { FacelessWork } from "./FacelessWork";

const STAGE_LABEL: Record<ItemStage, string> = {
  idea: "Idea",
  script: "Script",
  rendering: "Making",
  ready: "Approve",
  approved: "Sent",
  posted: "Posted",
  rejected: "Skipped",
};

export function AgentWorkspace({ m, agent, onClose }: { m: MoneyAgents; agent: Agent; onClose: () => void }) {
  const set = (patch: Partial<Agent>) => m.saveAgent({ ...agent, ...patch });
  const setCampaign = (patch: Partial<NonNullable<Agent["campaign"]>>) =>
    set({ campaign: { ...(agent.campaign ?? { url: "", brand: "", budget: 0, minViews: 0, platforms: [], contentUrls: [], endsOn: "" }), ...patch } });
  const kind = AGENT_KINDS.find((k) => k.id === agent.kind)!;
  const accounts = accountsOf(m.personas, agent.personaId);
  const items = m.board.items.filter((i) => i.agentId === agent.id && i.stage !== "rejected");
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(0, 12);
  const firstRun = !agent.niche && !agent.sources.length && !items.length;

  return (
    <section className="mas-work mas-panel mas-pad" aria-label={agent.name}>
      <div className="mas-work-head">
        <span className="mas-pill" data-kind={agent.kind}>
          {kind.label}
        </span>
        <input
          className="mas-input"
          style={{ maxWidth: 320, fontSize: 17, fontWeight: 650, background: "transparent", border: "1px solid transparent" }}
          value={agent.name}
          aria-label="Agent name"
          onChange={(e) => set({ name: e.target.value })}
        />
        <span className="mas-grow" />
        <button type="button" className="mas-btn" data-size="sm" onClick={() => set({ status: agent.status === "active" ? "paused" : "active" })}>
          {agent.status === "active" ? "Pause" : "Resume"}
        </button>
        <button type="button" className="mas-btn" data-size="sm" data-tone="danger" onClick={() => m.deleteAgent(agent.id)}>
          Delete
        </button>
        <button type="button" className="mas-btn" data-size="sm" data-tone="ghost" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <details className="mas-details" open={firstRun || !agent.personaId}>
        <summary>Settings — what it makes and where it posts</summary>
        <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
          <div className="mas-grid-2">
            <label className="mas-field">
              <span>Posts as (a Personas Studio persona)</span>
              <select
                className="mas-select"
                value={agent.personaId ?? ""}
                onChange={(e) => {
                  const id = e.target.value || null;
                  set({ personaId: id, accountIds: accountsOf(m.personas, id).map((a) => a.id) });
                }}
              >
                <option value="">{m.personas.length ? "Pick a persona" : "No personas yet — make one in Personas Studio"}</option>
                {m.personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.niche ? ` — ${p.niche}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="mas-field">
              <span>{agent.kind === "faceless" ? "Channel niche" : "What it clips"}</span>
              <input
                className="mas-input"
                value={agent.niche}
                placeholder={agent.kind === "faceless" ? "e.g. Space facts, Money myths, Dark history" : "e.g. Money podcasts, Gym motivation"}
                onChange={(e) => set({ niche: e.target.value })}
              />
            </label>
          </div>
          {accounts.length > 0 && (
            <div className="mas-checks" role="group" aria-label="Accounts it posts to">
              {accounts.map((a) => {
                const on = agent.accountIds.includes(a.id);
                return (
                  <label key={a.id} className="mas-check" data-on={on}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => set({ accountIds: on ? agent.accountIds.filter((x) => x !== a.id) : [...agent.accountIds, a.id] })}
                    />
                    {PLATFORM_NAME[a.platform]} {a.handle}
                  </label>
                );
              })}
            </div>
          )}
          <div className="mas-grid-4">
            <label className="mas-field">
              <span>Shape</span>
              <select className="mas-select" value={agent.aspect} onChange={(e) => set({ aspect: e.target.value as Aspect })}>
                <option value="9:16">9:16 — Shorts, TikTok, Reels</option>
                <option value="16:9">16:9 — YouTube</option>
                <option value="1:1">1:1 — square</option>
              </select>
            </label>
            <label className="mas-field">
              <span>Shortest (seconds)</span>
              <input className="mas-input" type="number" min={5} value={agent.minSeconds} onChange={(e) => set({ minSeconds: Math.max(5, Number(e.target.value) || 5) })} />
            </label>
            <label className="mas-field">
              <span>Longest (seconds)</span>
              <input
                className="mas-input"
                type="number"
                min={agent.minSeconds}
                value={agent.maxSeconds}
                onChange={(e) => set({ maxSeconds: Math.max(agent.minSeconds, Number(e.target.value) || agent.minSeconds) })}
              />
            </label>
            <label className="mas-field">
              <span>{agent.kind === "campaign" ? "Campaign pays $ per 1K views" : "Your $ per 1K views (for estimates)"}</span>
              <input className="mas-input" type="number" min={0} step="0.01" value={agent.ratePer1k} onChange={(e) => set({ ratePer1k: Math.max(0, Number(e.target.value) || 0) })} />
            </label>
          </div>
          <div className="mas-grid-2">
            <label className="mas-field">
              <span>Voice (how captions and scripts sound)</span>
              <input className="mas-input" value={agent.voice} placeholder="e.g. Hype, short sentences, no slang" onChange={(e) => set({ voice: e.target.value })} />
            </label>
            {agent.kind === "faceless" ? (
              <label className="mas-field">
                <span>Videos per week</span>
                <input className="mas-input" type="number" min={0} max={70} value={agent.perWeek} onChange={(e) => set({ perWeek: Math.max(0, Number(e.target.value) || 0) })} />
              </label>
            ) : (
              <label className="mas-field">
                <span>Rules every clip follows</span>
                <input className="mas-input" value={agent.rules} placeholder="e.g. No swearing, always credit the show" onChange={(e) => set({ rules: e.target.value })} />
              </label>
            )}
          </div>
          {agent.kind === "faceless" && (
            <label className="mas-field">
              <span>Rules every video follows</span>
              <input className="mas-input" value={agent.rules} placeholder="e.g. No politics, cite real numbers" onChange={(e) => set({ rules: e.target.value })} />
            </label>
          )}
          {agent.kind === "campaign" && agent.campaign && (
            <div className="mas-grid-3">
              <label className="mas-field">
                <span>Campaign link</span>
                <input className="mas-input" value={agent.campaign.url} placeholder="https://whop.com/…" onChange={(e) => setCampaign({ url: e.target.value.trim() })} />
              </label>
              <label className="mas-field">
                <span>Who pays</span>
                <input className="mas-input" value={agent.campaign.brand} onChange={(e) => setCampaign({ brand: e.target.value })} />
              </label>
              <label className="mas-field">
                <span>Ends on</span>
                <input className="mas-input" type="date" value={agent.campaign.endsOn} onChange={(e) => setCampaign({ endsOn: e.target.value })} />
              </label>
              <label className="mas-field">
                <span>Budget ($, 0 if unknown)</span>
                <input className="mas-input" type="number" min={0} value={agent.campaign.budget} onChange={(e) => setCampaign({ budget: Math.max(0, Number(e.target.value) || 0) })} />
              </label>
              <label className="mas-field">
                <span>Min views before it pays</span>
                <input className="mas-input" type="number" min={0} value={agent.campaign.minViews} onChange={(e) => setCampaign({ minViews: Math.max(0, Number(e.target.value) || 0) })} />
              </label>
              <label className="mas-field">
                <span>Content to clip (one link per line)</span>
                <textarea
                  className="mas-textarea"
                  rows={2}
                  value={agent.campaign.contentUrls.join("\n")}
                  onChange={(e) => setCampaign({ contentUrls: e.target.value.split(/\s+/).map((s) => s.trim()).filter(Boolean) })}
                />
              </label>
            </div>
          )}
        </div>
      </details>

      {agent.kind === "faceless" ? <FacelessWork m={m} agent={agent} /> : <ClipWork m={m} agent={agent} />}

      {items.length > 0 && (
        <div>
          <h3 className="mas-h2" style={{ marginBottom: 8 }}>
            This agent&rsquo;s work
          </h3>
          <div className="mas-table-wrap">
            <table className="mas-table stack">
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id}>
                    <td className="title clip" title={i.why}>
                      {i.title || i.hook}
                      {i.start !== null && <span className="mas-muted mas-mono" style={{ fontSize: 11.5, marginLeft: 8 }}>{formatTime(i.start)}</span>}
                    </td>
                    <td>
                      <span className="mas-pill" data-stage={i.stage}>
                        {STAGE_LABEL[i.stage]}
                      </span>
                    </td>
                    <td className="num">
                      {(i.stage === "idea" || i.stage === "script") && (
                        <button type="button" className="mas-btn" data-size="sm" data-tone="go" onClick={() => void m.make([i])}>
                          Make
                        </button>
                      )}
                      {(i.stage === "idea" || i.stage === "script") && (
                        <button type="button" className="mas-btn" data-size="sm" data-tone="ghost" onClick={() => m.reject(i)}>
                          Skip
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {items.length > shown.length && (
            <button type="button" className="mas-btn" data-tone="ghost" data-size="sm" style={{ marginTop: 8 }} onClick={() => setShowAll(true)}>
              Show all {items.length}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
