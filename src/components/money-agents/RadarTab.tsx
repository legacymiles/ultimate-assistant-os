"use client";

// ---------------------------------------------------------------------------
// Radar — the market side of Money Agent Studio (owner's ask, Oct 2026):
// the most lucrative opportunities right now and the reasoning why, the
// monthly CPI / jobs / Fed releases that move gold and stocks, smart
// companies (margins, dividends, growth) and a bot that catches big moves.
//
// Design skill: interactive-web-studio. The toy is the radar dish — every
// play is a blip (closer to the centre = stronger, its sector = its kind) and
// the sweep lights them; hover or tap a blip and its row lights up. The rest
// is the studio's dense ledger. The dish sits beside the words, never behind.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import {
  BUCKETS,
  HORIZON_LABEL,
  MARKETS,
  OPP_KINDS,
  botBrief,
  countdown,
  inWindow,
  labelFor,
  newRule,
  paperResult,
  scorecard,
  timing,
  toSymbol,
  upcoming,
  visiblePlays,
  type Bucket,
  type Catalyst,
  type Opportunity,
  type OppKind,
  type Quote,
  type WatchRule,
} from "@/lib/money-agents/radar";
import { RADAR_SEEDED_ON } from "@/lib/money-agents/radarSeed";
import type { Radar } from "@/lib/money-agents/useRadar";
import { fileRequest } from "@/lib/studio-home/fileRequest";

type Say = (text: string, tone?: "ok" | "warn") => void;

// ----- formatting ------------------------------------------------------------

export function price(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  const digits = n >= 1000 ? 0 : n >= 10 ? 2 : n >= 1 ? 3 : 4;
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function signed(n: number | undefined, digits = 2): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function tone(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || Math.abs(n) < 0.005) return "mas-muted";
  return n > 0 ? "mas-mint" : "rad-red";
}

function ago(iso: string): string {
  if (!iso) return "";
  const m = (Date.now() - Date.parse(iso)) / 60_000;
  if (!Number.isFinite(m)) return "";
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const ET_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

function when(c: Catalyst): string {
  return c.at.length === 10 ? ET_DAY.format(new Date(`${c.at}T12:00:00Z`)) : `${ET.format(new Date(c.at))} ET`;
}

const KIND_LABEL = Object.fromEntries(OPP_KINDS.map((k) => [k.id, k.label])) as Record<OppKind, string>;

// ----- the tab -----------------------------------------------------------------

export function RadarTab({ r, say }: { r: Radar; say: Say }) {
  const [kind, setKind] = useState<OppKind | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [lit, setLit] = useState<string | null>(null);

  const plays = useMemo(() => {
    const feed = r.feed?.plays ?? [];
    const savedGone = r.state.saved.filter((s) => !feed.some((f) => f.id === s.id));
    return visiblePlays([...feed, ...savedGone], r.state, kind);
  }, [r.feed, r.state, kind]);
  const allPlays = useMemo(() => visiblePlays(r.feed?.plays ?? [], r.state), [r.feed, r.state]);

  const next = useMemo(() => upcoming(r.catalysts), [r.catalysts]);
  const live = next.filter((c) => inWindow(c));
  const score = scorecard(r.state.catches, r.quotes);
  const rulesOn = r.state.rules.filter((x) => x.on).length;

  return (
    <div className="rad">
      <section className="rad-top" aria-label="Radar overview">
        <Dish plays={allPlays.slice(0, 14)} lit={lit} onLight={setLit} onOpen={(id) => setOpen(id)} />
        <div className="rad-top-side">
          <div className="rad-next" data-live={live.length > 0}>
            <span className="rad-eyebrow">{live.length ? "Happening now" : "Next big release"}</span>
            {next[0] ? (
              <>
                <strong>{(live[0] ?? next[0]).name}</strong>
                <span className="rad-next-when">
                  {countdown(live[0] ?? next[0])} · {when(live[0] ?? next[0])}
                </span>
                <span className="mas-muted rad-next-note">{(live[0] ?? next[0]).note}</span>
              </>
            ) : (
              <strong>Nothing scheduled</strong>
            )}
          </div>
          <div className="rad-bot">
            <span className="rad-eyebrow">Move bot</span>
            <div className="rad-bot-line">
              <span className="rad-pulse" data-on={rulesOn > 0} aria-hidden />
              <strong>{rulesOn ? `Watching ${rulesOn} market${rulesOn === 1 ? "" : "s"}` : "Paused"}</strong>
              <span className="mas-muted">· {r.catchesToday} catch{r.catchesToday === 1 ? "" : "es"} today</span>
            </div>
            <span className="mas-muted rad-small">
              {score.n
                ? `If you'd followed its ${score.n} catches: ${score.wins} up, avg ${signed(score.avg, 1)}`
                : "Catches and how they'd have paid show below."}
            </span>
          </div>
          <Tape quotes={r.quotes} />
        </div>
      </section>

      <Plays r={r} plays={plays} kind={kind} setKind={setKind} open={open} setOpen={setOpen} lit={lit} setLit={setLit} say={say} />
      <Calendar list={next} quotes={r.quotes} />
      <Companies r={r} say={say} />
      <Bot r={r} say={say} />

      <p className="rad-fine">
        Ideas, reasoning and alerts — not financial advice, and nothing here buys or sells. Prices can be delayed. Company figures were checked on{" "}
        {RADAR_SEEDED_ON}; open the source before you act on one.
      </p>
    </div>
  );
}

// ----- the dish (the toy) ------------------------------------------------------

const SECTOR: Record<OppKind, number> = { ipo: 0, macro: 1, gold: 2, crypto: 3, stock: 4, dividend: 5, policy: 6 };

function Dish({
  plays,
  lit,
  onLight,
  onOpen,
}: {
  plays: Opportunity[];
  lit: string | null;
  onLight: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const R = 120;
  const blips = plays.map((p, i) => {
    const sector = SECTOR[p.kind];
    // Spread blips inside their sector so two of a kind don't sit on each other.
    const angle = ((sector + 0.18 + ((i * 0.37) % 0.64)) / 7) * Math.PI * 2 - Math.PI / 2;
    const dist = 18 + (1 - p.score / 100) * (R - 30);
    const deg = ((angle + Math.PI / 2) * 180) / Math.PI;
    return { p, x: R + Math.cos(angle) * dist, y: R + Math.sin(angle) * dist, delay: (deg / 360) * 4 };
  });
  return (
    <div className="rad-dish-wrap">
      <svg className="rad-dish" viewBox={`0 0 ${R * 2} ${R * 2}`} role="img" aria-label={`${plays.length} plays on the radar`}>
        <defs>
          <radialGradient id="rad-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--mas-mint)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--mas-mint)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="rad-sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--mas-mint)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--mas-mint)" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        <circle cx={R} cy={R} r={R - 2} fill="url(#rad-glow)" stroke="var(--mas-line-2)" />
        {[0.72, 0.46, 0.2].map((k) => (
          <circle key={k} cx={R} cy={R} r={(R - 2) * k} fill="none" stroke="var(--mas-line)" />
        ))}
        {OPP_KINDS.map((k, i) => {
          const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
          const la = ((i + 0.5) / 7) * Math.PI * 2 - Math.PI / 2;
          return (
            <g key={k.id}>
              <line x1={R} y1={R} x2={R + Math.cos(a) * (R - 2)} y2={R + Math.sin(a) * (R - 2)} stroke="var(--mas-line)" />
              <text x={R + Math.cos(la) * (R - 13)} y={R + Math.sin(la) * (R - 13)} className="rad-dish-label" textAnchor="middle" dominantBaseline="middle">
                {k.label.split(" ")[0]}
              </text>
            </g>
          );
        })}
        <g className="rad-sweep">
          <path d={`M${R},${R} L${R},2 A${R - 2},${R - 2} 0 0,1 ${R + (R - 2) * Math.sin(Math.PI / 5)},${R - (R - 2) * Math.cos(Math.PI / 5)} Z`} fill="url(#rad-sweep)" />
        </g>
        {blips.map(({ p, x, y, delay }) => (
          <g
            key={p.id}
            className="rad-blip"
            data-lit={lit === p.id}
            data-hot={p.score >= 75}
            style={{ ["--d" as string]: `${delay}s` }}
            tabIndex={0}
            role="button"
            aria-label={`${p.title} — score ${p.score}`}
            onMouseEnter={() => onLight(p.id)}
            onMouseLeave={() => onLight(null)}
            onFocus={() => onLight(p.id)}
            onBlur={() => onLight(null)}
            onClick={() => {
              onOpen(p.id);
              document.getElementById(`play-${p.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(p.id);
                document.getElementById(`play-${p.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }}
          >
            <circle cx={x} cy={y} r={10} fill="transparent" />
            <circle cx={x} cy={y} r={p.score >= 75 ? 4.5 : 3.5} className="rad-blip-dot" />
          </g>
        ))}
        <circle cx={R} cy={R} r={3} fill="var(--mas-mint)" />
      </svg>
      <span className="rad-dish-cap mas-muted">Closer to the middle = stronger play</span>
    </div>
  );
}

// ----- the live tape ----------------------------------------------------------

function Tape({ quotes }: { quotes: Record<string, Quote> }) {
  return (
    <div className="rad-tape" aria-label="Markets">
      {MARKETS.slice(0, 6).map((m) => {
        const q = quotes[m.symbol];
        return (
          <div key={m.symbol} className="rad-tick">
            <span className="mas-muted">{m.label}</span>
            <strong className="mas-mono">{price(q?.price)}</strong>
            <span className={`mas-mono ${tone(q?.changePct)}`}>{signed(q?.changePct)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ----- plays --------------------------------------------------------------------

function Plays({
  r,
  plays,
  kind,
  setKind,
  open,
  setOpen,
  lit,
  setLit,
  say,
}: {
  r: Radar;
  plays: Opportunity[];
  kind: OppKind | "all";
  setKind: (k: OppKind | "all") => void;
  open: string | null;
  setOpen: (id: string | null) => void;
  lit: string | null;
  setLit: (id: string | null) => void;
  say: Say;
}) {
  const saved = new Set(r.state.saved.map((s) => s.id));
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of visiblePlays(r.feed?.plays ?? [], r.state)) c[p.kind] = (c[p.kind] ?? 0) + 1;
    return c;
  }, [r.feed, r.state]);

  return (
    <section className="mas-panel rad-sec" aria-labelledby="rad-plays">
      <header className="rad-sec-head">
        <div>
          <h2 className="mas-h2" id="rad-plays">
            Top plays right now
          </h2>
          <p className="mas-sub">
            This week&rsquo;s market news, read for you: why it could pay, how it loses, and how you&rsquo;d actually get in.
            {r.feed?.at && (
              <span className="mas-muted">
                {" "}
                · {r.feed.by === "ai" ? "AI-read" : r.feed.by === "rules" ? "keyword-ranked" : ""} {ago(r.feed.at)} ago
              </span>
            )}
          </p>
        </div>
        <button type="button" className="mas-btn" data-tone="go" disabled={r.feedBusy} onClick={() => void r.refreshFeed(true)}>
          {r.feedBusy ? <span className="mas-spin" /> : null} {r.feedBusy ? "Reading the news…" : "Refresh"}
        </button>
      </header>

      <div className="rad-chips" role="tablist" aria-label="Kind of play">
        <button type="button" className="rad-chip" aria-selected={kind === "all"} onClick={() => setKind("all")}>
          All
        </button>
        {OPP_KINDS.map((k) => (
          <button key={k.id} type="button" className="rad-chip" aria-selected={kind === k.id} disabled={!counts[k.id] && kind !== k.id} onClick={() => setKind(k.id)}>
            {k.label}
            {counts[k.id] ? <span className="rad-chip-n">{counts[k.id]}</span> : null}
          </button>
        ))}
      </div>

      {r.feed?.warning && <p className="mas-note">{r.feed.warning}</p>}
      {r.feedError && <p className="mas-note">{r.feedError}</p>}
      {!r.feed && r.feedBusy && <PlaysSkeleton />}
      {r.feed && !plays.length && <p className="mas-empty">Nothing in this group right now. Try All, or Refresh.</p>}

      {plays.length > 0 && (
        <div className="rad-plays" role="list">
          {plays.map((p) => {
            const q = p.watch.map((w) => r.quotes[w]).find(Boolean);
            const t = timing(q);
            const isOpen = open === p.id;
            return (
              <article
                key={p.id}
                id={`play-${p.id}`}
                role="listitem"
                className="rad-play"
                data-open={isOpen}
                data-lit={lit === p.id}
                onMouseEnter={() => setLit(p.id)}
                onMouseLeave={() => setLit(null)}
              >
                <button type="button" className="rad-play-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.id)}>
                  <Score n={p.score} />
                  <span className="rad-play-title">
                    <span>
                      {saved.has(p.id) && <span className="mas-gold" aria-label="Starred">★ </span>}
                      {p.title}
                    </span>
                    <span className="mas-muted rad-small">
                      {p.source}
                      {p.publishedAt && ` · ${ago(p.publishedAt)} ago`}
                    </span>
                  </span>
                  <span className="mas-tag" data-hide-sm="true">
                    {KIND_LABEL[p.kind]}
                  </span>
                  <span className="rad-hz" data-hide-sm="true">
                    {HORIZON_LABEL[p.horizon]}
                  </span>
                  <span className="rad-timing" data-state={t.state} data-hide-sm="true">
                    {t.state === "unknown" ? "" : t.text}
                  </span>
                </button>
                {isOpen && <PlayDetail p={p} r={r} q={q} timingText={t.text} say={say} starred={saved.has(p.id)} />}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PlaysSkeleton() {
  return (
    <div className="rad-plays" aria-busy="true" aria-label="Reading the news">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="rad-skel" style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </div>
  );
}

function Score({ n }: { n: number }) {
  return (
    <span className="rad-score" data-hot={n >= 75} aria-label={`Score ${n} out of 100`}>
      <span className="rad-score-n mas-mono">{n}</span>
      <span className="rad-score-bar" aria-hidden>
        <span style={{ width: `${n}%` }} />
      </span>
    </span>
  );
}

function PlayDetail({
  p,
  r,
  q,
  timingText,
  say,
  starred,
}: {
  p: Opportunity;
  r: Radar;
  q: Quote | undefined;
  timingText: string;
  say: Say;
  starred: boolean;
}) {
  const [filing, setFiling] = useState(false);
  const watched = new Set(r.state.rules.map((x) => x.symbol));

  const buildBot = async () => {
    setFiling(true);
    try {
      const s = await fileRequest("app:trading-studio", botBrief(p));
      say(s === "filed" ? "Sent to Claude Code: it will build and backtest a paper bot in Trading Studio." : "That bot is already waiting in In Queue.");
    } catch (e) {
      say(e instanceof Error ? e.message : "In Queue didn't take it.", "warn");
    } finally {
      setFiling(false);
    }
  };

  return (
    <div className="rad-detail">
      <dl className="rad-dl">
        {p.why && (
          <div>
            <dt>Why it could pay</dt>
            <dd>{p.why}</dd>
          </div>
        )}
        {p.risk && (
          <div>
            <dt>How it loses</dt>
            <dd>{p.risk}</dd>
          </div>
        )}
        {p.howToGetIn && (
          <div>
            <dt>How you&rsquo;d get in</dt>
            <dd>{p.howToGetIn}</dd>
          </div>
        )}
        <div>
          <dt>Timing</dt>
          <dd>
            {HORIZON_LABEL[p.horizon]}
            {p.catalystDate && ` · catalyst ${p.catalystDate}`}
            {q && ` · ${timingText}`}
          </dd>
        </div>
      </dl>
      {p.watch.length > 0 && (
        <div className="rad-watch">
          {p.watch.map((w) => {
            const wq = r.quotes[w];
            return (
              <span key={w} className="rad-wchip">
                <strong>{labelFor(w, r.companies)}</strong>
                <span className="mas-mono">{price(wq?.price)}</span>
                <span className={`mas-mono ${tone(wq?.changePct)}`}>{signed(wq?.changePct)}</span>
                <button
                  type="button"
                  className="rad-mini"
                  disabled={watched.has(w)}
                  onClick={() => {
                    r.saveRule(newRule(w, labelFor(w, r.companies)));
                    say(`The move bot is now watching ${labelFor(w, r.companies)}.`);
                  }}
                >
                  {watched.has(w) ? "Watching" : "+ Bot"}
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="mas-row">
        <a className="mas-btn" data-size="sm" href={p.url} target="_blank" rel="noreferrer">
          Read the story ↗
        </a>
        <button type="button" className="mas-btn" data-size="sm" onClick={() => r.star(p)}>
          {starred ? "★ Starred" : "☆ Star"}
        </button>
        <button type="button" className="mas-btn" data-size="sm" disabled={filing} onClick={() => void buildBot()}>
          {filing ? <span className="mas-spin" /> : null} Build a bot for this
        </button>
        <button
          type="button"
          className="mas-btn"
          data-size="sm"
          onClick={() => {
            r.hide(p.id);
            say("Dismissed.", "ok");
          }}
        >
          Dismiss
        </button>
        {p.by === "rules" && <span className="mas-muted rad-small">Ranked by keywords — no AI reasoning on this one.</span>}
      </div>
    </div>
  );
}

// ----- calendar -----------------------------------------------------------------

const CAT_LABEL: Record<Catalyst["kind"], string> = {
  cpi: "CPI",
  jobs: "Jobs",
  fomc: "Fed",
  pce: "PCE",
  earnings: "Earnings",
  ipo: "IPO",
  other: "Event",
};

function Calendar({ list, quotes }: { list: Catalyst[]; quotes: Record<string, Quote> }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 8);
  return (
    <section className="mas-panel rad-sec" aria-labelledby="rad-cal">
      <header className="rad-sec-head">
        <div>
          <h2 className="mas-h2" id="rad-cal">
            Release calendar
          </h2>
          <p className="mas-sub">
            The dated events where big, predictable moves cluster. The bot gets more sensitive for two hours after each one.
          </p>
        </div>
      </header>
      {!list.length ? (
        <p className="mas-empty">Nothing on the calendar in the next four months.</p>
      ) : (
        <div className="mas-table-wrap">
          <table className="mas-table stack rad-cal">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th data-hide-sm="true">Moves</th>
                <th className="num">In</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} data-live={inWindow(c)}>
                  <td className="mas-mono rad-when">{when(c)}</td>
                  <td className="title">
                    <span className="mas-tag">{CAT_LABEL[c.kind]}</span> {c.name}
                    {c.tentative && <span className="mas-muted"> · expected</span>}
                    {c.note && <div className="mas-muted rad-small rad-wrap">{c.note}</div>}
                  </td>
                  <td data-hide-sm="true">
                    <span className="rad-moves">
                      {c.watch.slice(0, 3).map((w) => (
                        <span key={w} className="mas-muted">
                          {labelFor(w)} <span className={tone(quotes[w]?.changePct)}>{signed(quotes[w]?.changePct, 1)}</span>
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="num mas-mono">{countdown(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.length > 8 && (
        <button type="button" className="mas-btn" data-size="sm" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </section>
  );
}

// ----- smart companies ------------------------------------------------------

function Companies({ r, say }: { r: Radar; say: Say }) {
  const [bucket, setBucket] = useState<Bucket>("margin");
  const [ticker, setTicker] = useState("");
  const rows = r.companies.filter((c) => c.bucket === bucket);
  const meta = BUCKETS.find((b) => b.id === bucket)!;

  const add = () => {
    const sym = toSymbol(ticker);
    if (!sym) return say("Type a ticker like NVDA or KO.", "warn");
    const ok = r.addCompany({ ticker: sym, name: sym, bucket, metric: "", why: "Added by you", asOf: new Date().toISOString().slice(0, 10), source: "" });
    say(ok ? `Added ${sym} to ${meta.label}.` : `${sym} is already on the list.`, ok ? "ok" : "warn");
    if (ok) setTicker("");
  };

  return (
    <section className="mas-panel rad-sec" aria-labelledby="rad-co">
      <header className="rad-sec-head">
        <div>
          <h2 className="mas-h2" id="rad-co">
            Smart companies
          </h2>
          <p className="mas-sub">{meta.blurb}</p>
        </div>
      </header>
      <div className="rad-chips" role="tablist" aria-label="Kind of company">
        {BUCKETS.map((b) => (
          <button key={b.id} type="button" className="rad-chip" aria-selected={bucket === b.id} onClick={() => setBucket(b.id)}>
            {b.label}
          </button>
        ))}
      </div>
      <div className="mas-table-wrap">
        <table className="mas-table stack">
          <thead>
            <tr>
              <th>Company</th>
              <th>The number</th>
              <th className="num">Price</th>
              <th className="num">Today</th>
              <th className="num" data-hide-sm="true">
                1 month
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const q = r.quotes[c.ticker];
              return (
                <tr key={c.ticker}>
                  <td className="title">
                    <span className="mas-mono">{c.ticker}</span> <span className="mas-muted">{c.name !== c.ticker ? c.name : ""}</span>
                    <div className="mas-muted rad-small rad-wrap">
                      {c.why}
                      {c.custom && (
                        <button type="button" className="rad-mini" onClick={() => r.removeCompany(c.ticker)}>
                          Remove
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="rad-wrap">
                    {c.metric || <span className="mas-muted">—</span>}
                    {c.source && (
                      <a className="rad-src" href={c.source} target="_blank" rel="noreferrer">
                        source
                      </a>
                    )}
                  </td>
                  <td className="num mas-mono">{price(q?.price)}</td>
                  <td className={`num mas-mono ${tone(q?.changePct)}`}>{signed(q?.changePct)}</td>
                  <td className={`num mas-mono ${tone(q?.monthPct)}`} data-hide-sm="true">
                    {signed(q?.monthPct, 1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mas-row">
        <input
          className="mas-input mas-grow"
          style={{ flexBasis: 200 }}
          value={ticker}
          placeholder={`Add a ticker to ${meta.label}`}
          onChange={(e) => setTicker(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button type="button" className="mas-btn" onClick={add} disabled={!ticker.trim()}>
          Add
        </button>
      </div>
    </section>
  );
}

// ----- the move bot -----------------------------------------------------------

function Bot({ r, say }: { r: Radar; say: Say }) {
  const [sym, setSym] = useState("");
  const add = () => {
    const s = toSymbol(sym);
    if (!s) return say("Type something like gold, xrp, MU or NVDA.", "warn");
    if (r.state.rules.some((x) => x.symbol === s)) return say(`${labelFor(s, r.companies)} is already watched.`, "warn");
    r.saveRule(newRule(s, labelFor(s, r.companies)));
    setSym("");
    say(`Watching ${labelFor(s, r.companies)}.`);
  };
  const score = scorecard(r.state.catches, r.quotes);

  return (
    <section className="mas-panel rad-sec" aria-labelledby="rad-bot">
      <header className="rad-sec-head">
        <div>
          <h2 className="mas-h2" id="rad-bot">
            Move bot
          </h2>
          <p className="mas-sub">
            Alerts you the moment a market makes a big move, crosses your price, or jumps after a release. It runs while this app is open on any of your
            devices and never trades.
          </p>
        </div>
        {r.perm === "default" && (
          <button type="button" className="mas-btn" data-tone="go" onClick={() => void r.askNotify()}>
            Turn on alerts
          </button>
        )}
        {r.perm === "denied" && <span className="mas-muted rad-small">Alerts are blocked in this browser&rsquo;s settings.</span>}
        {r.perm === "granted" && <span className="mas-mint rad-small">Alerts on</span>}
      </header>

      <div className="mas-table-wrap">
        <table className="mas-table stack rad-rules">
          <thead>
            <tr>
              <th>Market</th>
              <th className="num">Price</th>
              <th className="num" title="Alert when today's move reaches this, either way">
                Big move %
              </th>
              <th className="num" title="After a CPI/jobs/Fed release a smaller move counts" data-hide-sm="true">
                Release %
              </th>
              <th className="num" data-hide-sm="true">
                Above
              </th>
              <th className="num" data-hide-sm="true">
                Below
              </th>
              <th className="num">On</th>
            </tr>
          </thead>
          <tbody>
            {r.state.rules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} q={r.quotes[rule.symbol]} onSave={r.saveRule} onRemove={() => r.removeRule(rule.id)} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="mas-row">
        <input
          className="mas-input mas-grow"
          style={{ flexBasis: 200 }}
          value={sym}
          placeholder="Watch another — gold, xrp, MU, NVDA…"
          onChange={(e) => setSym(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button type="button" className="mas-btn" onClick={add} disabled={!sym.trim()}>
          Watch
        </button>
      </div>

      <h3 className="rad-h3">
        Catches {score.n > 0 && <span className="mas-muted">· followed in their direction: {score.wins}/{score.n} up, avg {signed(score.avg, 1)}</span>}
      </h3>
      {!r.state.catches.length ? (
        <p className="mas-empty">No catches yet. When a watched market makes a big move, it lands here with what it would have paid since.</p>
      ) : (
        <>
          <div className="mas-table-wrap">
            <table className="mas-table stack">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What happened</th>
                  <th className="num">At</th>
                  <th className="num">Since</th>
                </tr>
              </thead>
              <tbody>
                {r.state.catches.slice(0, 30).map((c) => {
                  const since = paperResult(c, r.quotes[c.symbol]);
                  return (
                    <tr key={c.id}>
                      <td className="mas-mono rad-when">{ET.format(new Date(c.at))}</td>
                      <td className="title">
                        <span className={c.dir === "up" ? "mas-mint" : "rad-red"}>{c.dir === "up" ? "▲" : "▼"}</span> {c.label}
                        <span className="mas-muted"> · {c.reason}</span>
                      </td>
                      <td className="num mas-mono">{price(c.price)}</td>
                      <td className={`num mas-mono ${tone(since)}`}>{signed(since, 1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" className="mas-btn" data-size="sm" onClick={r.clearCatches}>
            Clear catches
          </button>
        </>
      )}
    </section>
  );
}

function RuleRow({ rule, q, onSave, onRemove }: { rule: WatchRule; q: Quote | undefined; onSave: (r: WatchRule) => void; onRemove: () => void }) {
  const field = (key: "movePct" | "eventPct" | "above" | "below", label: string, step: number, hideSm = false) => (
    <td className="num" data-hide-sm={hideSm ? "true" : undefined}>
      <input
        className="mas-input rad-num"
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        aria-label={`${rule.label} ${label}`}
        value={rule[key] || ""}
        placeholder="off"
        onChange={(e) => onSave({ ...rule, [key]: Math.max(0, Number(e.target.value) || 0) })}
      />
    </td>
  );
  return (
    <tr data-off={!rule.on}>
      <td className="title">
        {rule.label} <span className="mas-muted mas-mono">{rule.symbol !== rule.label ? rule.symbol : ""}</span>
        <button type="button" className="rad-mini" onClick={onRemove} aria-label={`Stop watching ${rule.label}`}>
          ✕
        </button>
      </td>
      <td className="num mas-mono">
        {price(q?.price)} <span className={tone(q?.changePct)}>{signed(q?.changePct, 1)}</span>
      </td>
      {field("movePct", "big move percent", 0.5)}
      {field("eventPct", "release percent", 0.1, true)}
      {field("above", "alert above", 1, true)}
      {field("below", "alert below", 1, true)}
      <td className="num">
        <button type="button" className="rad-switch" role="switch" aria-checked={rule.on} aria-label={`Watch ${rule.label}`} onClick={() => onSave({ ...rule, on: !rule.on })}>
          <span />
        </button>
      </td>
    </tr>
  );
}
