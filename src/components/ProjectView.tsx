"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import type { Project } from "@/lib/types";
import { formatDate, cn } from "@/lib/utils";
import { AIPanel } from "./AIPanel";
import { FeaturesSection } from "./FeaturesSection";
import { Icon } from "./icons";
import { KnowledgeInbox } from "./KnowledgeInbox";
import { VersionTimeline } from "./VersionTimeline";
import { EditProjectModal } from "./modals/EditProjectModal";
import { SuperPromptModal } from "./modals/SuperPromptModal";

type Tab = "overview" | "features" | "versions" | "knowledge";

export function ProjectView({ project }: { project: Project }) {
  const deleteProject = useStore((s) => s.deleteProject);
  const [tab, setTab] = useState<Tab>("features");
  const [editing, setEditing] = useState(false);
  const [superPrompt, setSuperPrompt] = useState(false);

  // Reset to the default (Features) tab whenever a different project is opened.
  useEffect(() => {
    setTab("features");
  }, [project.id]);

  const tabs: { id: Tab; label: string; icon: keyof typeof Icon; count?: number }[] = [
    { id: "overview", label: "Overview", icon: "Sparkles" },
    { id: "features", label: "Features", icon: "Layers", count: project.features.length },
    { id: "versions", label: "Versions", icon: "Clock", count: project.versions.length },
    { id: "knowledge", label: "Knowledge", icon: "Inbox", count: project.knowledge.length },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-5 sm:px-6 sm:py-7">
      {/* Title row */}
      <header>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              {project.name}
            </h1>
            {project.one_liner && (
              <p className="mt-1.5 text-sm text-ink-muted sm:text-base">{project.one_liner}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
              <span>Updated {formatDate(project.updated_at)}</span>
              <span>·</span>
              <span>{project.versions.length} versions</span>
              <span>·</span>
              <span>{project.knowledge.length} knowledge</span>
            </div>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg border border-line p-2 text-ink-muted transition hover:bg-panel-2 hover:text-ink"
              aria-label="Edit project"
              title="Edit project"
            >
              <Icon.Edit width={16} height={16} />
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete "${project.name}"? This cannot be undone.`))
                  deleteProject(project.id);
              }}
              className="rounded-lg border border-line p-2 text-ink-muted transition hover:bg-red-500/10 hover:text-red-400"
              aria-label="Delete project"
              title="Delete project"
            >
              <Icon.Trash width={16} height={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Menu panel: tabs + actions */}
      <div className="sticky top-0 z-10 -mx-1 flex items-center gap-2 rounded-2xl border border-line bg-panel/95 p-1.5 backdrop-blur">
        <div className="flex flex-1 gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const TabIcon = Icon[t.icon];
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition",
                  active
                    ? "bg-brand text-white"
                    : "text-ink-muted hover:bg-panel-2 hover:text-ink",
                )}
              >
                <TabIcon width={15} height={15} />
                <span>{t.label}</span>
                {t.count !== undefined && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[10px] font-semibold",
                      active ? "bg-white/20 text-white" : "bg-canvas text-ink-faint",
                    )}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setSuperPrompt(true)}
          title="Generate a build-ready super prompt"
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2 text-sm font-semibold text-brand transition hover:bg-brand/20"
        >
          <Icon.Sparkles width={15} height={15} />
          <span className="hidden sm:inline">Super Prompt</span>
        </button>
      </div>

      {/* Tab content */}
      <div className="animate-fade-in" key={tab}>
        {tab === "overview" && (
          <div className="space-y-4">
            {project.overview ? (
              <section className="rounded-2xl border border-line bg-panel p-5">
                <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  Overview
                </h2>
                <p className="text-sm leading-relaxed text-ink-muted">{project.overview}</p>
              </section>
            ) : (
              <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-faint">
                No overview yet. Run the AI Analyst or edit the project to add one.
              </p>
            )}

            {project.detailed ? (
              <section className="rounded-2xl border border-line bg-panel p-5">
                <div className="mb-2 flex items-center gap-2">
                  <Icon.File width={15} height={15} className="text-ink-muted" />
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                    Detailed Explanation
                  </h2>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">
                  {project.detailed}
                </p>
              </section>
            ) : (
              <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-faint">
                No detailed explanation yet. Add your notes to the Knowledge Inbox and run the AI
                Analyst — it writes a full write-up here that keeps every important detail.
              </p>
            )}

            <AIPanel project={project} />
          </div>
        )}
        {tab === "features" && <FeaturesSection project={project} />}
        {tab === "versions" && <VersionTimeline project={project} />}
        {tab === "knowledge" && <KnowledgeInbox project={project} />}
      </div>

      <EditProjectModal project={project} open={editing} onClose={() => setEditing(false)} />
      <SuperPromptModal
        project={project}
        open={superPrompt}
        onClose={() => setSuperPrompt(false)}
      />
    </div>
  );
}
