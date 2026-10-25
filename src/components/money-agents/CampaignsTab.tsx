"use client";

// Campaigns — paid clipping work: find it, join it, clip for it, get paid.

import { useState } from "react";
import { compact, money, newAgent, summarize } from "@/lib/money-agents/logic";
import type { MoneyAgents } from "@/lib/money-agents/useMoneyAgents";
import type { FoundCampaign } from "@/lib/money-agents/types";

interface Hit {
  title: string;
  url: string;
  snippet: string;
}

export function CampaignsTab({ m, onOpenAgent }: { m: MoneyAgents; onOpenAgent: (id: string) => void }) {
  const campaigns = m.board.agents.filter((a) => a.kind === "campaign");
  const [niche, setNiche] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ campaigns: FoundCampaign[]; hits: Hit[]; warning?: string } | null>(null);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");

  const find = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/money-agents/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche }),
      });
      const data = (await res.json()) as { campaigns?: FoundCampaign[]; hits?: Hit[]; warning?: string; error?: string };
      if (!res.ok) setError(data.error ?? "The search didn't work. Try again.");
      else setResult({ campaigns: data.campaigns ?? [], hits: data.hits ?? [], warning: data.warning });
    } catch {
      setError("Couldn't reach the website. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const already = (url: string) => campaigns.some((a) => a.campaign?.url === url);

  const add = (c: Partial<FoundCampaign> & { url: string }) => {
    const personaId = m.personas.length === 1 ? m.personas[0].id : null;
    const a = newAgent("campaign", {
      name: c.name ? c.name.slice(0, 60) : "Campaign",
      ratePer1k: c.ratePer1k ?? 0,
      niche: niche || "",
      personaId,
      accountIds: personaId ? m.personas[0].accounts.map((x) => x.id) : [],
      rules: c.notes ?? "",
    });
    a.campaign = { ...a.campaign!, url: c.url, brand: c.brand ?? "", platforms: c.platforms?.length ? c.platforms : a.campaign!.platforms };
    m.saveAgent(a);
    m.say(`Added ${a.name}. Join the campaign on its page, then fill in its rules and the content to clip.`);
    onOpenAgent(a.id);
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {campaigns.length > 0 && (
        <div className="mas-table-wrap">
          <table className="mas-table stack">
            <thead>
              <tr>
                <th>Campaign</th>
                <th className="num">$/1K</th>
                <th className="num">Live clips</th>
                <th className="num">Views</th>
                <th className="num">Est.</th>
                <th className="num">Paid</th>
                <th>Ends</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((a) => {
                const s = summarize(a, m.board, m.personas);
                const ended = a.campaign?.endsOn && a.campaign.endsOn < new Date().toISOString().slice(0, 10);
                return (
                  <tr key={a.id} data-click="true" onClick={() => onOpenAgent(a.id)}>
                    <td className="title">
                      {a.name}
                      {a.campaign?.brand && <span className="mas-muted"> · {a.campaign.brand}</span>}
                    </td>
                    <td className="num">{a.ratePer1k ? money(a.ratePer1k) : "—"}</td>
                    <td className="num" data-hide-sm="true">{s.live || "—"}</td>
                    <td className="num">{s.views ? compact(s.views) : "—"}</td>
                    <td className="num mas-mint" data-hide-sm="true">{s.estimated ? money(s.estimated) : "—"}</td>
                    <td className="num mas-gold">{s.paid ? money(s.paid) : "—"}</td>
                    <td data-hide-sm="true" className={ended ? "mas-warn" : "mas-muted"}>
                      {a.campaign?.endsOn || "open"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section className="mas-panel mas-pad" style={{ display: "grid", gap: 10 }}>
        <div>
          <h2 className="mas-h2">Find paid clipping campaigns</h2>
          <p className="mas-sub" style={{ margin: 0 }}>
            Brands and creators pay per 1,000 views for clips of their content. This searches the web for live ones — open each to check it&rsquo;s
            real and join it there; this never signs you up for anything.
          </p>
        </div>
        <div className="mas-row">
          <input
            className="mas-input mas-grow"
            style={{ flexBasis: 240 }}
            value={niche}
            placeholder="Niche (optional) — e.g. podcasts, gaming, fitness"
            onChange={(e) => setNiche(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && void find()}
          />
          <button type="button" className="mas-btn" data-tone="go" disabled={busy} onClick={() => void find()}>
            {busy ? <span className="mas-spin" /> : null} {busy ? "Searching…" : "Find campaigns"}
          </button>
        </div>
        {error && <p className="mas-note" style={{ margin: 0 }}>{error}</p>}
        {result && (
          <div style={{ display: "grid", gap: 10 }}>
            {result.warning && <p className="mas-note" style={{ margin: 0 }}>{result.warning}</p>}
            {result.campaigns.length > 0 && (
              <div className="mas-table-wrap">
                <table className="mas-table stack">
                  <tbody>
                    {result.campaigns.map((c) => (
                      <tr key={c.url}>
                        <td className="title clip">
                          <a href={c.url} target="_blank" rel="noreferrer">
                            {c.name}
                          </a>
                          {c.notes && <div className="mas-muted" style={{ fontSize: 12, fontWeight: 400 }}>{c.notes}</div>}
                        </td>
                        <td className="num mas-gold">{c.ratePer1k ? `${money(c.ratePer1k)}/1K` : "rate?"}</td>
                        <td data-hide-sm="true" className="mas-muted">{c.platforms.join(", ")}</td>
                        <td className="num">
                          <button type="button" className="mas-btn" data-size="sm" data-tone="go" disabled={already(c.url)} onClick={() => add(c)}>
                            {already(c.url) ? "Added" : "Add"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.hits.length > 0 && (
              <details className="mas-details" open={!result.campaigns.length}>
                <summary>All search results ({result.hits.length})</summary>
                <div className="mas-table-wrap" style={{ marginTop: 8 }}>
                  <table className="mas-table stack">
                    <tbody>
                      {result.hits.map((h) => (
                        <tr key={h.url}>
                          <td className="clip">
                            <a href={h.url} target="_blank" rel="noreferrer">
                              {h.title}
                            </a>
                            <div className="mas-muted" style={{ fontSize: 12 }}>{h.snippet}</div>
                          </td>
                          <td className="num">
                            <button type="button" className="mas-btn" data-size="sm" disabled={already(h.url)} onClick={() => add({ url: h.url, name: h.title })}>
                              {already(h.url) ? "Added" : "Add"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        )}
        <div className="mas-row" style={{ borderTop: "1px solid var(--mas-line)", paddingTop: 10 }}>
          <input
            className="mas-input mas-grow"
            style={{ flexBasis: 240 }}
            value={link}
            placeholder="Already joined one? Paste its link"
            onChange={(e) => setLink(e.target.value)}
          />
          <button
            type="button"
            className="mas-btn"
            disabled={!/^https?:\/\//i.test(link.trim()) || already(link.trim())}
            onClick={() => {
              add({ url: link.trim() });
              setLink("");
            }}
          >
            Add campaign
          </button>
        </div>
      </section>
    </div>
  );
}
