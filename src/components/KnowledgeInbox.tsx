"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { KNOWLEDGE_KIND_LABELS, type KnowledgeKind, type Project } from "@/lib/types";
import { relativeTime, cn, fileCategory, formatBytes } from "@/lib/utils";
import { Icon } from "./icons";
import { AddKnowledgeModal } from "./modals/AddKnowledgeModal";

const KIND_COLORS: Record<KnowledgeKind, string> = {
  note: "bg-slate-500/15 text-slate-300",
  idea: "bg-amber-500/15 text-amber-300",
  feature_request: "bg-emerald-500/15 text-emerald-300",
  ai_conversation: "bg-violet-500/15 text-violet-300",
  claude_conversation: "bg-orange-500/15 text-orange-300",
  chatgpt_conversation: "bg-teal-500/15 text-teal-300",
  dev_update: "bg-sky-500/15 text-sky-300",
  documentation: "bg-indigo-500/15 text-indigo-300",
  bug_report: "bg-red-500/15 text-red-300",
  brain_dump: "bg-pink-500/15 text-pink-300",
};

export function KnowledgeInbox({ project }: { project: Project }) {
  const deleteKnowledge = useStore((s) => s.deleteKnowledge);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<KnowledgeKind | "all">("all");

  // Chronological — newest first so recent memory is on top.
  const entries = [...project.knowledge]
    .filter((k) => filter === "all" || k.kind === filter)
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

  const kindsPresent = Array.from(new Set(project.knowledge.map((k) => k.kind)));

  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon.Inbox width={18} height={18} className="text-ink-muted" />
          <h2 className="text-base font-semibold text-ink">Knowledge Inbox</h2>
          <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[11px] font-medium text-ink-faint">
            {project.knowledge.length}
          </span>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
        >
          <Icon.Plus width={14} height={14} /> Add entry
        </button>
      </div>
      <p className="mb-4 text-xs text-ink-faint">
        The project&apos;s permanent memory. Everything saved here stays attached to the project
        and feeds the AI Analyst.
      </p>

      {kindsPresent.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </FilterChip>
          {kindsPresent.map((k) => (
            <FilterChip key={k} active={filter === k} onClick={() => setFilter(k)}>
              {KNOWLEDGE_KIND_LABELS[k]}
            </FilterChip>
          ))}
        </div>
      )}

      {entries.length === 0 ? (
        <button
          onClick={() => setAdding(true)}
          className="flex w-full flex-col items-center gap-1 rounded-2xl border border-dashed border-line px-4 py-10 text-center transition hover:border-brand/50"
        >
          <Icon.Inbox width={22} height={22} className="text-ink-faint" />
          <span className="mt-1 text-sm font-medium text-ink-muted">Inbox is empty</span>
          <span className="text-xs text-ink-faint">
            Save a note, idea, bug report or an AI conversation to get started.
          </span>
        </button>
      ) : (
        <ul className="space-y-2.5">
          {entries.map((k) => (
            <li
              key={k.id}
              className="group rounded-2xl border border-line bg-canvas p-3.5 transition hover:border-line-soft"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      KIND_COLORS[k.kind],
                    )}
                  >
                    {KNOWLEDGE_KIND_LABELS[k.kind]}
                  </span>
                  <span className="text-[11px] text-ink-faint">{relativeTime(k.created_at)}</span>
                </div>
                <button
                  onClick={() => deleteKnowledge(k.id)}
                  className="rounded-md p-1 text-ink-faint opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                  aria-label="Delete entry"
                >
                  <Icon.Trash width={14} height={14} />
                </button>
              </div>
              {k.title && <h4 className="mt-2 text-sm font-semibold text-ink">{k.title}</h4>}
              {k.attachment && (
                <div className="mt-2 flex items-center gap-2.5 rounded-xl border border-line-soft bg-panel-2 p-2">
                  {k.attachment.url && fileCategory(k.attachment.name, k.attachment.type) === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={k.attachment.url}
                      alt={k.attachment.name}
                      className="h-10 w-10 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-canvas text-[10px] font-bold uppercase text-ink-muted">
                      {k.attachment.name.split(".").pop()?.slice(0, 4) ?? "file"}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-ink">
                      {k.attachment.name}
                    </div>
                    <div className="text-[10px] text-ink-faint">
                      {formatBytes(k.attachment.size)} · AI-summarised source
                    </div>
                  </div>
                </div>
              )}
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">
                {k.content}
              </p>
            </li>
          ))}
        </ul>
      )}

      <AddKnowledgeModal projectId={project.id} open={adding} onClose={() => setAdding(false)} />
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
        active
          ? "border-brand bg-brand/15 text-ink"
          : "border-line text-ink-muted hover:bg-panel-2",
      )}
    >
      {children}
    </button>
  );
}
