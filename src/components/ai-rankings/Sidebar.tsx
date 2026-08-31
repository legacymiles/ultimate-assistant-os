"use client";

import { useState } from "react";
import { Icon } from "../icons";
import { VIEWS } from "@/lib/ai-rankings/query";
import type { Filters, ViewId } from "@/lib/ai-rankings/query";
import { countsByCategory, countsByGroup, featureIndex, featureKey } from "@/lib/ai-rankings/query";
import { groupHue } from "@/lib/ai-rankings/types";
import type { BoardData } from "@/lib/ai-rankings/types";

interface Props {
  data: BoardData;
  filters: Filters;
  onFilters: (filters: Filters) => void;
  onAddGroup: (group: string) => void;
  onAddCategory: (group: string, category: string) => void;
}

/**
 * The navigation column: saved views on top, then the section tree.
 *
 * Views exist so the narrowing people repeat — "what's open source", "what
 * needs a key I don't have" — is one click and always in the same place,
 * rather than a row of chips to re-assemble every visit.
 */
export function Sidebar({ data, filters, onFilters, onAddGroup, onAddCategory }: Props) {
  const groupCounts = countsByGroup(data.tools);
  const groups = Object.keys(data.tree);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [newGroup, setNewGroup] = useState(false);
  const [draft, setDraft] = useState("");
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [allFeatures, setAllFeatures] = useState(false);

  // Features are counted against what the section filter already narrowed to,
  // so browsing Video shows the features video tools have — not every feature
  // on the board.
  const scope = data.tools.filter(
    (t) =>
      (!filters.group || t.group === filters.group) &&
      (!filters.category || t.category === filters.category),
  );
  const features = featureIndex(scope);
  const shownFeatures = allFeatures ? features : features.slice(0, 12);

  const pickView = (view: ViewId) => onFilters({ ...filters, view });
  const pickGroup = (group: string) => {
    setOpen((o) => ({ ...o, [group]: true }));
    onFilters({
      ...filters,
      group: filters.group === group && !filters.category ? null : group,
      category: null,
    });
  };
  const pickCategory = (group: string, category: string) =>
    onFilters({
      ...filters,
      group,
      category: filters.category === category && filters.group === group ? null : category,
    });

  const submitDraft = (fn: (value: string) => void) => {
    const value = draft.trim();
    if (value) fn(value);
    setDraft("");
    setNewGroup(false);
    setAddingTo(null);
  };

  return (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-4">
      {/* Views */}
      <div>
        <h2 className="mb-1.5 px-2 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
          Views
        </h2>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => pickView(v.id)}
            className={
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition " +
              (filters.view === v.id
                ? "bg-brand/15 font-medium text-brand"
                : "text-ink-muted hover:bg-panel-2 hover:text-ink")
            }
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Sections */}
      <div>
        <div className="mb-1.5 flex items-center justify-between px-2">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
            Sections
          </h2>
          <button
            onClick={() => {
              setNewGroup(true);
              setAddingTo(null);
              setDraft("");
            }}
            className="text-ink-faint transition hover:text-ink"
            aria-label="New group"
            title="New group"
          >
            <Icon.Plus width={13} height={13} />
          </button>
        </div>

        <button
          onClick={() => onFilters({ ...filters, group: null, category: null })}
          className={
            "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] transition " +
            (!filters.group
              ? "bg-panel-2 font-medium text-ink"
              : "text-ink-muted hover:bg-panel-2 hover:text-ink")
          }
        >
          Everything
          <span className="font-mono text-[11px] text-ink-faint">{data.tools.length}</span>
        </button>

        {groups.map((group) => {
          const isOpen = open[group] ?? filters.group === group;
          const catCounts = countsByCategory(data.tools, group);
          const hue = groupHue(group);
          return (
            <div key={group}>
              <div
                className={
                  "group/row flex items-center gap-1 rounded-lg pr-1 transition " +
                  (filters.group === group && !filters.category
                    ? "bg-panel-2"
                    : "hover:bg-panel-2")
                }
              >
                <button
                  onClick={() => setOpen((o) => ({ ...o, [group]: !isOpen }))}
                  className="pl-1.5 text-ink-faint transition hover:text-ink"
                  aria-label={isOpen ? `Collapse ${group}` : `Expand ${group}`}
                >
                  <Icon.Chevron
                    width={12}
                    height={12}
                    className={"transition-transform " + (isOpen ? "rotate-90" : "")}
                  />
                </button>
                <button
                  onClick={() => pickGroup(group)}
                  className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-[13px]"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: `hsl(${hue} 70% 58%)` }}
                  />
                  <span
                    className={
                      "truncate " +
                      (filters.group === group ? "font-medium text-ink" : "text-ink-muted")
                    }
                  >
                    {group}
                  </span>
                </button>
                <button
                  onClick={() => {
                    setAddingTo(group);
                    setNewGroup(false);
                    setDraft("");
                    setOpen((o) => ({ ...o, [group]: true }));
                  }}
                  className="opacity-0 transition group-hover/row:opacity-100 focus:opacity-100"
                  aria-label={`New category in ${group}`}
                  title={`New category in ${group}`}
                >
                  <Icon.Plus width={12} height={12} className="text-ink-faint hover:text-ink" />
                </button>
                <span className="font-mono text-[11px] text-ink-faint">
                  {groupCounts[group] ?? 0}
                </span>
              </div>

              {isOpen && (
                <div className="ml-[13px] border-l border-line-soft pl-1">
                  {(data.tree[group] ?? []).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => pickCategory(group, cat)}
                      className={
                        "flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-[12px] transition " +
                        (filters.group === group && filters.category === cat
                          ? "bg-brand/15 font-medium text-brand"
                          : "text-ink-muted hover:bg-panel-2 hover:text-ink")
                      }
                    >
                      <span className="truncate">{cat}</span>
                      <span className="font-mono text-[11px] text-ink-faint">
                        {catCounts[cat] ?? 0}
                      </span>
                    </button>
                  ))}
                  {addingTo === group && (
                    <DraftInput
                      placeholder="Category name"
                      value={draft}
                      onChange={setDraft}
                      onCommit={() => submitDraft((v) => onAddCategory(group, v))}
                      onCancel={() => {
                        setAddingTo(null);
                        setDraft("");
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}

        {newGroup && (
          <DraftInput
            placeholder="Group name"
            value={draft}
            onChange={setDraft}
            onCommit={() => submitDraft(onAddGroup)}
            onCancel={() => {
              setNewGroup(false);
              setDraft("");
            }}
          />
        )}
      </div>

      {/* Features — the axis this board is really sorted by */}
      <div>
        <h2 className="mb-1.5 px-2 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
          Features
        </h2>
        {features.length === 0 ? (
          <p className="px-2 text-[11px] leading-relaxed text-ink-faint">
            Nothing yet. Add features to a record — &ldquo;First/last frame&rdquo;,
            &ldquo;Cinematic look&rdquo; — and they show up here as a way to browse.
          </p>
        ) : (
          <>
            {shownFeatures.map((f) => {
              const active =
                filters.feature !== null && featureKey(filters.feature) === featureKey(f.label);
              return (
                <button
                  key={f.label}
                  onClick={() =>
                    onFilters({ ...filters, feature: active ? null : f.label })
                  }
                  title={f.label}
                  className={
                    "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-[12px] transition " +
                    (active
                      ? "bg-brand/15 font-medium text-brand"
                      : "text-ink-muted hover:bg-panel-2 hover:text-ink")
                  }
                >
                  <span className="truncate">{f.label}</span>
                  <span className="shrink-0 font-mono text-[11px] text-ink-faint">{f.count}</span>
                </button>
              );
            })}
            {features.length > 12 && (
              <button
                onClick={() => setAllFeatures((v) => !v)}
                className="mt-0.5 px-2 font-mono text-[10px] uppercase tracking-widest text-ink-faint transition hover:text-ink"
              >
                {allFeatures ? "fewer" : `+${features.length - 12} more`}
              </button>
            )}
          </>
        )}
      </div>
    </nav>
  );
}

function DraftInput({
  placeholder,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit();
        if (e.key === "Escape") onCancel();
      }}
      className="mt-1 w-full rounded-lg border border-brand/50 bg-canvas px-2 py-1 text-[12px] text-ink outline-none"
    />
  );
}
