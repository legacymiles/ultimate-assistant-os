"use client";

import { useState } from "react";
import { useFilteredProjects, useStore } from "@/lib/store";
import { relativeTime, cn } from "@/lib/utils";
import { Icon } from "./icons";
import { CreateProjectModal } from "./modals/CreateProjectModal";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const projects = useFilteredProjects();
  const total = useStore((s) => s.projects.length);
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex h-full flex-col bg-panel">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
          <Icon.Layers width={18} height={18} />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-ink">Projects Timeline</div>
          <div className="text-[11px] text-ink-faint">Ultimate Assistant OS</div>
        </div>
      </div>

      {/* Search + create */}
      <div className="space-y-2 px-3 pb-3">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
            <Icon.Search width={16} height={16} />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="w-full rounded-xl border border-line bg-canvas py-2.5 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2"
        >
          <Icon.Plus width={16} height={16} />
          Create Project
        </button>
      </div>

      <div className="px-4 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
        {search ? `${projects.length} of ${total}` : `${total} projects`}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {projects.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-ink-faint">
            {total === 0 ? "No projects yet." : "No matches."}
          </div>
        )}
        <ul className="space-y-1">
          {projects.map((p) => {
            const active = p.id === selectedId;
            return (
              <li key={p.id}>
                <button
                  onClick={() => {
                    select(p.id);
                    onNavigate?.();
                  }}
                  className={cn(
                    "group w-full rounded-xl border px-3 py-2.5 text-left transition",
                    active
                      ? "border-brand/40 bg-brand/10"
                      : "border-transparent hover:border-line hover:bg-panel-2",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "truncate text-sm font-semibold",
                        active ? "text-ink" : "text-ink",
                      )}
                    >
                      {p.name}
                    </span>
                    <span className="shrink-0 text-[10px] text-ink-faint">
                      {relativeTime(p.updated_at)}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">
                    {p.one_liner || "No summary yet."}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <CreateProjectModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
