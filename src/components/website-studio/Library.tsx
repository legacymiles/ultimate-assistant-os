"use client";

// ---------------------------------------------------------------------------
// My Websites — every site the owner can open, in one place.
//
// Three sources folded into one list by ../../lib/website-studio/library.ts:
// client websites, the hub's own apps, and builds that have not produced a
// site yet. Each appears exactly once, and clicking one opens it in the
// workspace — the same workspace, whichever kind it is.
//
// The cards lead with a picture where one exists (a real screenshot of the
// version on screen, or a mockup lane), because the owner recognises their
// client's site by how it looks long before they read its name.
// ---------------------------------------------------------------------------

import { ago, LIBRARY_FILTERS, type LibraryFilter, type SiteCard } from "@/lib/website-studio/library";

interface Props {
  cards: SiteCard[];
  counts: Record<LibraryFilter, number>;
  query: string;
  onQuery: (q: string) => void;
  filter: LibraryFilter;
  onFilter: (f: LibraryFilter) => void;
  onOpen: (c: SiteCard) => void;
  loading: boolean;
}

export function Library({ cards, counts, query, onQuery, filter, onFilter, onOpen, loading }: Props) {
  return (
    <section className="ws-lib" aria-labelledby="ws-lib-h">
      <header className="ws-lib-head">
        <h2 id="ws-lib-h">My websites</h2>
        <div className="ws-lib-tools">
          <label className="ws-search">
            <SearchIcon />
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Search by name, client or address"
              aria-label="Search your websites"
              spellCheck={false}
            />
            {query && (
              <button type="button" onClick={() => onQuery("")} aria-label="Clear search">
                ×
              </button>
            )}
          </label>
          <div className="ws-filters" role="tablist" aria-label="Filter websites">
            {LIBRARY_FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                className={filter === f.id ? "on" : ""}
                onClick={() => onFilter(f.id)}
                disabled={!counts[f.id] && f.id !== "all"}
              >
                {f.label}
                <em>{counts[f.id]}</em>
              </button>
            ))}
          </div>
        </div>
      </header>

      {loading && !cards.length ? (
        <ul className="ws-grid" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="ws-card skeleton" />
          ))}
        </ul>
      ) : cards.length ? (
        <ul className="ws-grid">
          {cards.map((c) => (
            <li key={c.key}>
              <button type="button" className={`ws-card state-${c.state}`} onClick={() => onOpen(c)}>
                <span className="ws-card-shot">
                  {c.thumb ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={c.thumb} alt="" loading="lazy" />
                  ) : (
                    <span className="ws-card-blank" aria-hidden>
                      {c.title.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  {c.pending > 0 && (
                    <span className="ws-card-pending" title={`${c.pending} batch of edits waiting on you`}>
                      {c.pending}
                    </span>
                  )}
                </span>
                <span className="ws-card-body">
                  <span className="ws-card-top">
                    <b>{c.title}</b>
                    {c.version && <i className="ws-card-ver">{c.version}</i>}
                  </span>
                  <span className="ws-card-host">{c.host || "No address yet"}</span>
                  <span className="ws-card-foot">
                    <span className={`ws-dot state-${c.state}`} aria-hidden />
                    {c.stateLabel}
                    {c.client && <em>· {c.client}</em>}
                    {c.updatedAt && <em className="ws-card-ago">· {ago(c.updatedAt)}</em>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ws-lib-empty">
          {query ? `Nothing matches “${query}”.` : "Nothing here yet — start one above and it appears in this list."}
        </p>
      )}
    </section>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
