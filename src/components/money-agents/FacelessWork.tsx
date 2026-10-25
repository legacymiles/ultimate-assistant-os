"use client";

// Faceless: ideas → script → the PC makes it.

import { useState } from "react";
import { itemViews, normalizeScript } from "@/lib/money-agents/logic";
import type { MoneyAgents } from "@/lib/money-agents/useMoneyAgents";
import type { Agent, Item, Script, VideoIdea } from "@/lib/money-agents/types";

export function FacelessWork({ m, agent }: { m: MoneyAgents; agent: Agent }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ideas, setIdeas] = useState<{ list: VideoIdea[]; warning?: string } | null>(null);
  const [off, setOff] = useState<number[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const mine = m.board.items.filter((i) => i.agentId === agent.id);
  const drafting = mine.filter((i) => i.stage === "idea" || i.stage === "script");

  const getIdeas = async () => {
    if (!agent.niche.trim()) {
      setError("Say what the channel is about first — fill in its niche in Settings.");
      return;
    }
    setBusy(true);
    setError("");
    setOff([]);
    try {
      const res = await fetch("/api/money-agents/faceless", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ideas",
          niche: agent.niche,
          voice: agent.voice,
          rules: agent.rules,
          count: 6,
          previous: mine.map((i) => i.title),
          made: mine.filter((i) => i.stage === "posted").map((i) => ({ title: i.title, views: itemViews(i, m.personas) })),
        }),
      });
      const data = (await res.json()) as { ideas?: VideoIdea[]; warning?: string; error?: string };
      if (!res.ok || !data.ideas) setError(data.error ?? "No ideas came back. Try again.");
      else setIdeas({ list: data.ideas, warning: data.warning });
    } catch {
      setError("Couldn't reach the website. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const chosen = ideas ? ideas.list.filter((_, i) => !off.includes(i)) : [];

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="mas-row">
        <h3 className="mas-h2 mas-grow" style={{ margin: 0 }}>
          Video ideas
        </h3>
        <span className="mas-muted" style={{ fontSize: 12 }}>
          {agent.perWeek ? `Aiming for ${agent.perWeek} a week` : ""}
        </span>
        <button type="button" className="mas-btn" data-tone="go" disabled={busy} onClick={() => void getIdeas()}>
          {busy ? <span className="mas-spin" /> : null} {busy ? "Thinking…" : "Get ideas"}
        </button>
      </div>
      {error && <p className="mas-note" style={{ margin: 0 }}>{error}</p>}
      {ideas && (
        <div style={{ display: "grid", gap: 8 }}>
          {ideas.warning && <p className="mas-note" style={{ margin: 0 }}>{ideas.warning}</p>}
          <div className="mas-moments">
            {ideas.list.map((idea, i) => {
              const on = !off.includes(i);
              return (
                <label key={idea.title} className="mas-moment" data-on={on} style={{ gridTemplateColumns: "auto 1fr" }}>
                  <input type="checkbox" checked={on} onChange={() => setOff(on ? [...off, i] : off.filter((x) => x !== i))} />
                  <span style={{ minWidth: 0 }}>
                    <h4>{idea.title}</h4>
                    <p>{idea.hook}</p>
                    <q>{[idea.angle, idea.why].filter(Boolean).join(" — ")}</q>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="mas-row">
            <button
              type="button"
              className="mas-btn"
              data-tone="go"
              disabled={!chosen.length}
              onClick={() => {
                m.keepIdeas(agent, chosen);
                setIdeas(null);
              }}
            >
              Keep {chosen.length}
            </button>
            <button type="button" className="mas-btn" data-tone="ghost" onClick={() => setIdeas(null)}>
              Discard
            </button>
          </div>
        </div>
      )}

      {drafting.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          <h3 className="mas-h2" style={{ margin: "6px 0 0" }}>
            Write and make
          </h3>
          {drafting.map((i) => (
            <ScriptRow key={i.id} m={m} agent={agent} item={i} open={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ScriptRow({ m, agent, item, open, onToggle }: { m: MoneyAgents; agent: Agent; item: Item; open: boolean; onToggle: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const s = item.script;

  const write = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/money-agents/faceless", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "script",
          niche: agent.niche,
          voice: agent.voice,
          rules: agent.rules,
          minSeconds: agent.minSeconds,
          maxSeconds: agent.maxSeconds,
          title: item.title,
          hook: item.hook,
          angle: item.why,
        }),
      });
      const data = (await res.json()) as { script?: Script; warning?: string; error?: string };
      if (!res.ok || !data.script) setError(data.error ?? "The script didn't come back. Try again.");
      else {
        m.setScript(item, normalizeScript(data.script));
        if (data.warning) setError(data.warning);
        if (!open) onToggle();
      }
    } catch {
      setError("Couldn't reach the website. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const edit = (patch: Partial<Script>) => s && m.setScript(item, { ...s, ...patch });

  return (
    <div className="mas-panel" style={{ padding: 12, background: "var(--mas-canvas)" }}>
      <div className="mas-row">
        <button type="button" className="mas-btn" data-tone="ghost" data-size="sm" onClick={onToggle} aria-expanded={open} disabled={!s}>
          {open ? "▾" : "▸"}
        </button>
        <strong className="mas-grow" style={{ minWidth: 0 }}>
          {item.title}
        </strong>
        <span className="mas-pill" data-stage={item.stage}>
          {s ? "Script ready" : "Idea"}
        </span>
        <button type="button" className="mas-btn" data-size="sm" disabled={busy} onClick={() => void write()}>
          {busy ? <span className="mas-spin" /> : null} {s ? "Rewrite" : "Write script"}
        </button>
        <button type="button" className="mas-btn" data-size="sm" data-tone="go" disabled={!s || busy} onClick={() => void m.make([item])} title={s ? "" : "Write the script first"}>
          Make
        </button>
      </div>
      {error && <p className="mas-note" style={{ margin: "8px 0 0" }}>{error}</p>}
      {open && s && (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <label className="mas-field">
            <span>Hook</span>
            <input className="mas-input" value={s.hook} onChange={(e) => edit({ hook: e.target.value })} />
          </label>
          {s.beats.map((b, i) => (
            <div key={i} className="mas-grid-2">
              <label className="mas-field">
                <span>Line {i + 1}</span>
                <textarea className="mas-textarea" rows={2} value={b} onChange={(e) => edit({ beats: s.beats.map((x, j) => (j === i ? e.target.value : x)) })} />
              </label>
              <label className="mas-field">
                <span>On screen</span>
                <textarea className="mas-textarea" rows={2} value={s.visuals[i] ?? ""} onChange={(e) => edit({ visuals: s.beats.map((_, j) => (j === i ? e.target.value : s.visuals[j] ?? "")) })} />
              </label>
            </div>
          ))}
          <div className="mas-grid-2">
            <label className="mas-field">
              <span>Last line</span>
              <input className="mas-input" value={s.cta} onChange={(e) => edit({ cta: e.target.value })} />
            </label>
            <label className="mas-field">
              <span>Thumbnail words</span>
              <input className="mas-input" value={s.thumbnail} onChange={(e) => edit({ thumbnail: e.target.value })} />
            </label>
          </div>
          <label className="mas-field">
            <span>Caption / description</span>
            <textarea className="mas-textarea" rows={3} value={item.caption || s.description} onChange={(e) => m.patchItem(item.id, { caption: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  );
}
