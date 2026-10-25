"use client";

// Clip: a long video in, the moments worth posting out.

import { useState } from "react";
import { formatTime } from "@/lib/money-agents/logic";
import type { MoneyAgents } from "@/lib/money-agents/useMoneyAgents";
import type { Agent, Moment } from "@/lib/money-agents/types";

const BY: Record<string, string> = {
  "ai-transcript": "Picked by AI from the video's words",
  "ai-video": "Picked by AI watching the video",
  offline: "Picked by the offline finder",
};

export function ClipWork({ m, agent }: { m: MoneyAgents; agent: Agent }) {
  const suggestions = Array.from(new Set([...(agent.campaign?.contentUrls ?? []), ...agent.sources])).slice(0, 6);
  const [url, setUrl] = useState(suggestions[0] ?? "");
  const [transcript, setTranscript] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [found, setFound] = useState<{ moments: Moment[]; by: string; title: string; warning?: string; url: string } | null>(null);
  const [off, setOff] = useState<number[]>([]);

  const find = async () => {
    setBusy(true);
    setError("");
    setFound(null);
    setOff([]);
    try {
      const res = await fetch("/api/money-agents/moments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          transcript,
          count,
          minSeconds: agent.minSeconds,
          maxSeconds: agent.maxSeconds,
          niche: agent.niche,
          voice: agent.voice,
          rules: [agent.rules, agent.campaign ? "This is for a paid clipping campaign — clips must stay on-brand and follow its rules." : ""]
            .filter(Boolean)
            .join(" "),
        }),
      });
      const data = (await res.json()) as { moments?: Moment[]; by?: string; title?: string; warning?: string; error?: string };
      if (!res.ok || !data.moments) {
        setError(data.error ?? "That didn't work. Try again.");
        if (res.status === 422) setShowPaste(true);
      } else if (!data.moments.length) {
        setError("No strong moments in that one. Try a longer video, or paste its transcript.");
      } else {
        setFound({ moments: data.moments, by: data.by ?? "", title: data.title ?? "", warning: data.warning, url: url.trim() });
      }
    } catch {
      setError("Couldn't reach the website. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const chosen = found ? found.moments.filter((_, i) => !off.includes(i)) : [];

  const keep = async (andMake: boolean) => {
    if (!found) return;
    const added = m.keepMoments(agent, found.url, chosen);
    setFound(null);
    if (andMake && added.length) await m.make(added);
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <h3 className="mas-h2">Find clips</h3>
      <div className="mas-row">
        <input
          className="mas-input mas-grow"
          style={{ flexBasis: 280 }}
          value={url}
          placeholder="Paste a podcast, stream or long YouTube video link"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && (url.trim() || transcript.trim()) && void find()}
        />
        <select className="mas-select" style={{ width: "auto" }} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="How many clips">
          {[3, 5, 8, 12].map((n) => (
            <option key={n} value={n}>
              {n} clips
            </option>
          ))}
        </select>
        <button type="button" className="mas-btn" data-tone="go" disabled={busy || (!url.trim() && !transcript.trim())} onClick={() => void find()}>
          {busy ? <span className="mas-spin" /> : null} {busy ? "Watching…" : "Find moments"}
        </button>
      </div>
      {suggestions.length > 1 && (
        <div className="mas-checks">
          {suggestions.map((s) => (
            <button key={s} type="button" className="mas-check" data-on={s === url} onClick={() => setUrl(s)} title={s}>
              {s.replace(/^https?:\/\/(www\.)?/, "").slice(0, 34)}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="mas-btn" data-tone="ghost" data-size="sm" style={{ justifySelf: "start" }} onClick={() => setShowPaste((v) => !v)}>
        {showPaste ? "Hide transcript box" : "Or paste the transcript"}
      </button>
      {showPaste && (
        <label className="mas-field">
          <span>Transcript — on YouTube: ⋯ under the video › Show transcript, then copy it all</span>
          <textarea className="mas-textarea" rows={6} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder={"0:00\nwelcome back to the show\n0:04\nso here's the thing nobody tells you…"} />
        </label>
      )}
      {error && <p className="mas-note" style={{ margin: 0 }}>{error}</p>}

      {found && (
        <div style={{ display: "grid", gap: 8 }}>
          <div className="mas-row">
            <strong>{found.title || "Moments found"}</strong>
            <span className="mas-muted" style={{ fontSize: 12 }}>{BY[found.by] ?? ""}</span>
          </div>
          {found.warning && <p className="mas-note" style={{ margin: 0 }}>{found.warning}</p>}
          <div className="mas-moments">
            {found.moments.map((mo, i) => {
              const on = !off.includes(i);
              return (
                <label key={`${mo.start}-${i}`} className="mas-moment" data-on={on}>
                  <input type="checkbox" checked={on} onChange={() => setOff(on ? [...off, i] : off.filter((x) => x !== i))} />
                  <span className="mas-moment-t">
                    {formatTime(mo.start)}–{formatTime(mo.end)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <h4>{mo.hook || mo.title}</h4>
                    <p>{mo.why}</p>
                    {mo.quote && <q>{mo.quote.length > 220 ? `${mo.quote.slice(0, 220)}…` : mo.quote}</q>}
                  </span>
                  <span className="mas-score" data-low={mo.score < 60}>{mo.score}</span>
                </label>
              );
            })}
          </div>
          <div className="mas-row">
            <button type="button" className="mas-btn" data-tone="go" disabled={!chosen.length} onClick={() => void keep(true)}>
              Make {chosen.length} on my PC
            </button>
            <button type="button" className="mas-btn" disabled={!chosen.length} onClick={() => void keep(false)}>
              Keep for later
            </button>
            <button type="button" className="mas-btn" data-tone="ghost" onClick={() => setFound(null)}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
