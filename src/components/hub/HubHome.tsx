"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CATEGORIES, PROJECTS, type Category } from "@/lib/catalog";
import { Icon } from "../icons";
import { ProjectCard } from "./ProjectCard";

type Filter = "All" | Category;
const FILTERS: Filter[] = ["All", ...CATEGORIES];

export function HubHome() {
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const searchRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  // Bottom-nav deep links (?focus=search|cats) jump to the relevant control.
  useEffect(() => {
    const focus = params.get("focus");
    if (focus === "search") {
      searchRef.current?.focus();
      searchRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (focus === "cats") {
      filterRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [params]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PROJECTS.filter((p) => {
      if (filter !== "All" && p.category !== filter) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.tag?.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [query, filter]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 sm:px-6 sm:pt-10">
      {/* Header */}
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white">
            <Icon.Layers width={20} height={20} />
          </div>
          <div className="leading-tight">
            <div className="text-base font-bold text-ink">Ultimate Assistant OS</div>
            <div className="text-[11px] text-ink-faint">Your apps, in one place</div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Explore the workshop
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          A growing library of AI apps, automations, tools and ideas — all in one hub.
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint">
          <Icon.Search width={16} height={16} />
        </span>
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects…"
          className="w-full rounded-2xl border border-line bg-panel py-3 pl-10 pr-3 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </div>

      {/* Filters */}
      <div ref={filterRef} className="mb-5 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => {
          const active = f === filter;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition " +
                (active
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-panel text-ink-muted hover:bg-panel-2 hover:text-ink")
              }
            >
              {f}
            </button>
          );
        })}
      </div>

      {/* Gallery */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-4 py-12 text-center text-sm text-ink-faint">
          No projects match.
        </div>
      ) : (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 sm:gap-4 md:grid-cols-5 lg:grid-cols-6">
          {filtered.map((p) => (
            <li key={p.slug}>
              <ProjectCard project={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
