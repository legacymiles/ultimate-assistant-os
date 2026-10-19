"use client";

// The dense half of the feature list: every decision the Orbit makes by
// throwing, made here with buttons — and the only place to edit wording.

import { useEffect, useRef, useState } from "react";
import { KIND_LABEL, type Feature, type FeatureOp, type FeatureStatus } from "@/lib/app-builder/types";

type Filter = "all" | FeatureStatus;

interface Props {
  features: Feature[];
  selectedId: string | null;
  hoverId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onOps: (ops: FeatureOp[]) => void;
}

const STATUS_WORD: Record<FeatureStatus, string> = { proposed: "Open", accepted: "Accepted", denied: "Denied" };

export function FeatureTable({ features, selectedId, hoverId, onSelect, onHover, onOps }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", detail: "" });
  const [adding, setAdding] = useState("");
  const rows = useRef(new Map<string, HTMLLIElement>());

  // A tap on a body in the Orbit brings its row into view.
  useEffect(() => {
    if (!selectedId) return;
    const f = features.find((x) => x.id === selectedId);
    if (f && filter !== "all" && f.status !== filter) setFilter("all");
    rows.current.get(selectedId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = (s: Filter) => (s === "all" ? features.length : features.filter((f) => f.status === s).length);
  const shown = filter === "all" ? features : features.filter((f) => f.status === filter);

  const startEdit = (f: Feature) => {
    setEditing(f.id);
    setDraft({ title: f.title, detail: f.detail });
    onSelect(f.id);
  };
  const saveEdit = (f: Feature) => {
    const title = draft.title.trim();
    const detail = draft.detail.trim();
    if (title && (title !== f.title || detail !== f.detail)) {
      onOps([{ op: "edit", id: f.id, title: title !== f.title ? title : undefined, detail: detail !== f.detail ? detail : undefined }]);
    }
    setEditing(null);
  };
  const add = () => {
    const title = adding.trim();
    if (!title) return;
    onOps([{ op: "add", feature: { title, detail: title, source: "you", status: "accepted" } }]);
    setAdding("");
  };

  return (
    <section className="ab-table" aria-label="Feature list">
      <div className="ab-table-head">
        <div className="ab-filters" role="tablist" aria-label="Show">
          {(["all", "proposed", "accepted", "denied"] as Filter[]).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={filter === s}
              className={`ab-filter ab-filter-${s}`}
              onClick={() => setFilter(s)}
            >
              {s === "all" ? "All" : STATUS_WORD[s]} <span>{count(s)}</span>
            </button>
          ))}
        </div>
        <div className="ab-bulk">
          <button className="ab-ghost" disabled={!count("proposed")} onClick={() => onOps([{ op: "acceptAll" }])}>
            Accept all open
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="ab-empty">
          {filter === "proposed" ? "Nothing waiting — every feature has a decision." : filter === "accepted" ? "Nothing accepted yet. Drag a feature into the core, or tap ✓." : "Nothing here yet."}
        </p>
      ) : (
        <ol className="ab-rows">
          {shown.map((f) => {
            const on = f.id === selectedId || f.id === hoverId;
            const isEditing = editing === f.id;
            return (
              <li
                key={f.id}
                ref={(el) => {
                  if (el) rows.current.set(f.id, el);
                  else rows.current.delete(f.id);
                }}
                className={`ab-row ab-row-${f.status}${on ? " is-on" : ""}`}
                onMouseEnter={() => onHover(f.id)}
                onMouseLeave={() => onHover(null)}
              >
                <button className="ab-num" onClick={() => onSelect(f.id === selectedId ? null : f.id)} aria-label={`Select feature ${f.id}`}>
                  {f.id.replace("f", "")}
                </button>
                <div className="ab-cell-main">
                  {isEditing ? (
                    <form
                      className="ab-edit"
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveEdit(f);
                      }}
                    >
                      <input
                        aria-label="Feature name"
                        value={draft.title}
                        maxLength={80}
                        autoFocus
                        onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                      />
                      <textarea
                        aria-label="What it does"
                        value={draft.detail}
                        maxLength={400}
                        rows={3}
                        onChange={(e) => setDraft((d) => ({ ...d, detail: e.target.value }))}
                      />
                      <div className="ab-edit-actions">
                        <button type="submit" className="ab-primary-sm">Save &amp; accept</button>
                        <button type="button" className="ab-ghost" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="ab-title">
                        {f.title}
                        {f.source === "you" && <span className="ab-tag">yours</span>}
                        {f.edited && f.source !== "you" && <span className="ab-tag">edited</span>}
                      </div>
                      <div className="ab-detail">{f.detail}</div>
                      {on && f.why && <div className="ab-why">Why: {f.why}</div>}
                    </>
                  )}
                </div>
                <div className="ab-meta">
                  <span className="ab-kind">{KIND_LABEL[f.kind]}</span>
                  <span className="ab-impact" aria-label={`Impact ${f.impact} of 3`}>
                    {[1, 2, 3].map((n) => (
                      <i key={n} className={n <= f.impact ? "on" : ""} />
                    ))}
                  </span>
                  <span className="ab-effort" aria-label={`Effort ${f.effort === "S" ? "small" : f.effort === "M" ? "medium" : "large"}`}>
                    {f.effort}
                  </span>
                </div>
                <div className="ab-decide">
                  <button
                    className="ab-yes"
                    aria-pressed={f.status === "accepted"}
                    aria-label={`Accept ${f.title}`}
                    title="Accept"
                    onClick={() => onOps([{ op: f.status === "accepted" ? "reset" : "accept", id: f.id }])}
                  >
                    ✓
                  </button>
                  <button
                    className="ab-no"
                    aria-pressed={f.status === "denied"}
                    aria-label={`Deny ${f.title}`}
                    title="Deny"
                    onClick={() => onOps([{ op: f.status === "denied" ? "reset" : "deny", id: f.id }])}
                  >
                    ✕
                  </button>
                  <button className="ab-pen" aria-label={`Edit ${f.title}`} title="Edit" onClick={() => (isEditing ? setEditing(null) : startEdit(f))}>
                    ✎
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <form
        className="ab-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <span aria-hidden>＋</span>
        <input
          aria-label="Add your own feature"
          placeholder="Add your own feature — it's accepted as you write it"
          value={adding}
          maxLength={80}
          onChange={(e) => setAdding(e.target.value)}
        />
        <button className="ab-primary-sm" disabled={!adding.trim()}>Add</button>
      </form>
    </section>
  );
}
