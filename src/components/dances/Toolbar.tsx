"use client";

// ---------------------------------------------------------------------------
// Search, sort, tags.
//
// Filtering changes WHICH tiles are on the wall — it never stops the drift.
// Sorting by score means the front of the wall is the leaderboard, which is
// why there is no separate rankings view to keep in sync.
// ---------------------------------------------------------------------------

import { SORTS } from "@/lib/dances/query";
import type { SortBy } from "@/lib/dances/query";

interface Props {
  query: string;
  onQuery: (v: string) => void;
  sort: SortBy;
  onSort: (v: SortBy) => void;
  tags: { tag: string; count: number }[];
  activeTags: string[];
  onToggleTag: (tag: string) => void;
  showing: number;
  total: number;
  onAdd: () => void;
}

export function Toolbar({
  query,
  onQuery,
  sort,
  onSort,
  tags,
  activeTags,
  onToggleTag,
  showing,
  total,
  onAdd,
}: Props) {
  return (
    <div className="dv-toolbar">
      <div className="dv-toolbar__row">
        <input
          className="dv-toolbar__search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search name, song, artist, choreographer, tag…"
          aria-label="Search dances"
        />
        <select
          className="dv-toolbar__sort"
          value={sort}
          onChange={(e) => onSort(e.target.value as SortBy)}
          aria-label="Sort"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn--primary" onClick={onAdd}>
          Add dance
        </button>
      </div>

      <div className="dv-toolbar__tags">
        <span className="dv-toolbar__count">
          {showing === total ? `${total} dances` : `${showing} of ${total}`}
        </span>
        {tags.slice(0, 14).map(({ tag, count }) => (
          <button
            key={tag}
            type="button"
            className={`dv-chip${activeTags.includes(tag) ? " is-on" : ""}`}
            onClick={() => onToggleTag(tag)}
          >
            {tag} <em>{count}</em>
          </button>
        ))}
      </div>
    </div>
  );
}
