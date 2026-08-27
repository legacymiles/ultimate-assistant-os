"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "../icons";
import { EA_FEATURES, allTags, filterFeatures } from "@/lib/ea-features/features";
import type { EaFeature } from "@/lib/ea-features/types";
import { EaFeatureRow } from "./EaFeatureRow";
import { EaFeatureDetailModal } from "./EaFeatureDetailModal";

export function EaFeatureList() {
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [detail, setDetail] = useState<EaFeature | null>(null);

  const tagList = useMemo(() => allTags(EA_FEATURES), []);
  const filtered = useMemo(
    () => filterFeatures(EA_FEATURES, query, tags),
    [query, tags],
  );

  const toggleTag = (tag: string) =>
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  return (
    <div className="min-h-dvh">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2.5 sm:px-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          aria-label="Back to hub"
        >
          <Icon.ArrowLeft width={14} height={14} />
          <span className="hidden sm:inline">Hub</span>
        </Link>
        <span className="ml-1 text-sm font-semibold text-ink">
          Expert Advisor Feature List
        </span>
      </div>

      <div className="mx-auto max-w-3xl px-3 py-5 sm:px-5 sm:py-8">
        {/* Heading */}
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-ink">Expert Advisor Feature List</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Every EA feature spec in one place, tagged and searchable. Click a feature to
            read the full spec and copy it straight into a build.
          </p>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Icon.Search
            width={16}
            height={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search features, tags or spec text…"
            className="w-full rounded-xl border border-line bg-panel py-2.5 pl-9 pr-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>

        {/* Tag filter — chips AND together */}
        {tagList.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
              Tags
            </span>
            {tagList.map((t) => (
              <FilterChip
                key={t}
                label={t}
                active={tags.includes(t)}
                onClick={() => toggleTag(t)}
              />
            ))}
            {tags.length > 0 && (
              <button
                onClick={() => setTags([])}
                className="ml-1 text-[11px] font-medium text-ink-faint underline-offset-2 transition hover:text-ink hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {/* List */}
        {filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-ink-muted">
            No features match your search.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-ink-faint">
              {filtered.length} {filtered.length === 1 ? "feature" : "features"}
              {filtered.length !== EA_FEATURES.length && ` of ${EA_FEATURES.length}`}
            </p>
            <div className="space-y-2.5">
              {filtered.map((feature) => (
                <EaFeatureRow
                  key={feature.id}
                  feature={feature}
                  activeTags={tags}
                  onOpen={setDetail}
                  onToggleTag={toggleTag}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {detail && (
        <EaFeatureDetailModal feature={detail} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-full border px-2.5 py-1 text-xs font-medium transition " +
        (active
          ? "border-brand bg-brand/15 text-brand"
          : "border-line text-ink-muted hover:bg-panel-2 hover:text-ink")
      }
    >
      {label}
    </button>
  );
}
