"use client";

// Approve — the owner's one gate. Nothing goes anywhere without a yes here.

import Link from "next/link";
import { useMemo, useState } from "react";
import { accountsOf, formatTime, makeState } from "@/lib/money-agents/logic";
import type { MoneyAgents } from "@/lib/money-agents/useMoneyAgents";
import type { Agent, Item } from "@/lib/money-agents/types";
import { PLATFORM_NAME } from "@/lib/social-personas/types";
import type { TabId } from "./MoneyAgentStudio";

export function ApproveTab({ m, onOpenAgent, onGo }: { m: MoneyAgents; onOpenAgent: (id: string) => void; onGo: (t: TabId) => void }) {
  const agents = useMemo(() => new Map(m.board.agents.map((a) => [a.id, a])), [m.board.agents]);
  const ready = m.board.items.filter((i) => i.stage === "ready" && agents.has(i.agentId));
  const making = m.board.items.filter((i) => i.stage === "rendering" && agents.has(i.agentId));

  return (
    <div className="mas-approve">
      {!m.personas.length && (
        <p className="mas-note">
          Approved videos go out through Personas Studio, and you have no personas yet.{" "}
          <Link href="/apps/personas-studio">Set one up there</Link> (connect TikTok, Instagram or YouTube once) — then every approval here
          posts through it.
        </p>
      )}

      {ready.length === 0 ? (
        <div className="mas-panel mas-empty">
          <h3>Nothing waiting for you</h3>
          <p>
            Videos show up here by themselves when your PC finishes them.{" "}
            {making.length
              ? `${making.length} ${making.length === 1 ? "is" : "are"} being made right now.`
              : "Pick moments or ideas in Agents, press Make, and they'll come back here for your yes."}
          </p>
          <button type="button" className="mas-btn" data-tone="go" onClick={() => onGo(making.length ? "pipeline" : "agents")}>
            {making.length ? "See what's being made" : "Open Agents"}
          </button>
        </div>
      ) : (
        ready.map((item) => <ApproveCard key={item.id} m={m} item={item} agent={agents.get(item.agentId)!} onOpenAgent={onOpenAgent} />)
      )}

      {making.length > 0 && (
        <section>
          <h2 className="mas-h2" style={{ marginTop: 10 }}>
            Being made on your PC
          </h2>
          <p className="mas-sub">
            Claude Code on your PC picks these up when it works your queue — say &ldquo;work my Jarvis queue&rdquo; in Claude Code.
          </p>
          <div className="mas-table-wrap">
            <table className="mas-table stack">
              <tbody>
                {making.map((i) => {
                  const st = makeState(i, m.requests.ready ? m.requests.doc : null);
                  return (
                    <tr key={i.id}>
                      <td className="title clip">{i.title || i.hook}</td>
                      <td className="num">
                        {st.state === "working" ? (
                          <span className="mas-mint">
                            <span className="mas-spin" /> making{st.note ? ` — ${st.note}` : ""}
                          </span>
                        ) : st.state === "done-no-video" ? (
                          <span className="mas-warn">finished without a video{st.note ? `: ${st.note}` : ""}</span>
                        ) : st.state === "gone" ? (
                          <span className="mas-warn">left the queue</span>
                        ) : (
                          <span className="mas-muted">waiting for your PC</span>
                        )}
                      </td>
                      <td data-hide-sm="true">
                        <button type="button" className="mas-btn" data-size="sm" data-tone="ghost" onClick={() => onOpenAgent(i.agentId)}>
                          {agents.get(i.agentId)?.name}
                        </button>
                      </td>
                      <td className="num">
                        {(st.state === "gone" || st.state === "done-no-video") && (
                          <button type="button" className="mas-btn" data-size="sm" onClick={() => void m.make([i])}>
                            Send again
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function ApproveCard({ m, item, agent, onOpenAgent }: { m: MoneyAgents; item: Item; agent: Agent; onOpenAgent: (id: string) => void }) {
  const [caption, setCaption] = useState(item.caption);
  const [tags, setTags] = useState(item.hashtags.map((t) => `#${t}`).join(" "));
  const [personaId, setPersonaId] = useState(agent.personaId ?? m.personas[0]?.id ?? "");
  const accounts = accountsOf(m.personas, personaId);
  const [picked, setPicked] = useState<string[]>(() => {
    const own = agent.personaId === personaId ? agent.accountIds.filter((id) => accounts.some((a) => a.id === id)) : [];
    return own.length ? own : accounts.map((a) => a.id);
  });
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);

  const save = () =>
    m.patchItem(item.id, {
      caption,
      hashtags: tags
        .split(/[\s,]+/)
        .map((t) => t.replace(/^#/, ""))
        .filter(Boolean),
    });

  const approve = async () => {
    save();
    setBusy(true);
    const fresh = { ...item, caption, hashtags: tags.split(/[\s,]+/).map((t) => t.replace(/^#/, "")).filter(Boolean) };
    await m.approve(fresh, { personaId, accountIds: picked, scheduledAt: when ? new Date(when).toISOString() : null });
    setBusy(false);
  };

  const video = item.requestId ? `/api/new-jarvis/requests/watch?id=${encodeURIComponent(item.requestId)}` : null;

  return (
    <article className="mas-ap">
      <div className="mas-ap-video" data-aspect={agent.aspect} data-empty={!video}>
        {video ? (
          <video src={video} controls playsInline preload="metadata" />
        ) : (
          <div className="mas-ap-novideo">No video attached.</div>
        )}
      </div>
      <div style={{ display: "grid", gap: 10, alignContent: "start", minWidth: 0 }}>
        <div className="mas-row">
          <span className="mas-pill" data-kind={agent.kind}>
            {agent.name}
          </span>
          {item.score !== null && <span className="mas-score" data-low={item.score < 60}>{item.score}</span>}
          {item.start !== null && item.end !== null && (
            <span className="mas-muted mas-mono" style={{ fontSize: 12 }}>
              {formatTime(item.start)}–{formatTime(item.end)}
            </span>
          )}
          <button type="button" className="mas-btn" data-size="sm" data-tone="ghost" onClick={() => onOpenAgent(agent.id)}>
            Agent ›
          </button>
        </div>
        <h3 style={{ margin: 0, fontSize: 16 }}>{item.title || item.hook}</h3>
        {item.why && <p className="mas-muted" style={{ margin: 0, fontSize: 12.5 }}>{item.why}</p>}

        <label className="mas-field">
          <span>Caption</span>
          <textarea className="mas-textarea" value={caption} onChange={(e) => setCaption(e.target.value)} onBlur={save} rows={3} />
        </label>
        <label className="mas-field">
          <span>Hashtags</span>
          <input className="mas-input" value={tags} onChange={(e) => setTags(e.target.value)} onBlur={save} />
        </label>

        <div className="mas-grid-2">
          <label className="mas-field">
            <span>Post as</span>
            <select
              className="mas-select"
              value={personaId}
              onChange={(e) => {
                setPersonaId(e.target.value);
                setPicked(accountsOf(m.personas, e.target.value).map((a) => a.id));
              }}
            >
              {!m.personas.length && <option value="">No personas yet</option>}
              {m.personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mas-field">
            <span>When (leave empty to post it yourself from Personas Studio)</span>
            <input className="mas-input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
        </div>
        {accounts.length > 0 && (
          <div className="mas-checks" role="group" aria-label="Accounts">
            {accounts.map((a) => {
              const on = picked.includes(a.id);
              return (
                <label key={a.id} className="mas-check" data-on={on}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setPicked(on ? picked.filter((x) => x !== a.id) : [...picked, a.id])}
                  />
                  {PLATFORM_NAME[a.platform]} {a.handle}
                </label>
              );
            })}
          </div>
        )}
        {agent.campaign?.url && (
          <p className="mas-note" data-tone="info" style={{ margin: 0 }}>
            Campaign clip: after it posts, submit the post link on{" "}
            <a href={agent.campaign.url} target="_blank" rel="noreferrer">
              the campaign page
            </a>{" "}
            so the views count.
          </p>
        )}
        <div className="mas-ap-actions">
          <button type="button" className="mas-btn" data-tone="gold" disabled={busy || !personaId || !picked.length} onClick={() => void approve()}>
            {busy ? <span className="mas-spin" /> : null} Approve
          </button>
          <button type="button" className="mas-btn" data-tone="ghost" disabled={busy} onClick={() => m.reject(item)}>
            Skip
          </button>
          {video && (
            <a className="mas-btn" data-tone="ghost" href={video} download>
              Download
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
