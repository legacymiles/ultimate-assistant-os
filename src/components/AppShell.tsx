"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSelectedProject, useStore } from "@/lib/store";
import { getRepo } from "@/lib/repo";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Icon } from "./icons";
import { ProjectView } from "./ProjectView";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const init = useStore((s) => s.init);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const project = useSelectedProject();
  const [drawer, setDrawer] = useState(false);
  const [backend, setBackend] = useState<"local" | "supabase">("local");

  useEffect(() => {
    init();
    setBackend(getRepo().kind);
  }, [init]);

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden w-80 shrink-0 border-r border-line md:block">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <aside
            className="animate-fade-in absolute left-0 top-0 h-full w-[84%] max-w-xs border-r border-line shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Sidebar onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      {/* Main column */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — hub link on all sizes, mobile menu on small screens */}
        <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2.5 sm:px-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
            aria-label="Back to hub"
          >
            <Icon.ArrowLeft width={14} height={14} />
            <span className="hidden sm:inline">Hub</span>
          </Link>
          <button
            onClick={() => setDrawer(true)}
            className="rounded-lg border border-line p-1.5 text-ink-muted md:hidden"
            aria-label="Open projects"
          >
            <Icon.Menu width={16} height={16} />
          </button>
          <span className="ml-1 truncate text-sm font-semibold text-ink">
            {project?.name ?? "Projects Timeline"}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <CenterMessage>Loading projects…</CenterMessage>
          ) : error ? (
            <CenterMessage>
              <span className="text-red-400">{error}</span>
            </CenterMessage>
          ) : project ? (
            <ProjectView project={project} />
          ) : (
            <EmptyState />
          )}
        </div>

        {/* Backend status */}
        <div className="flex items-center justify-center gap-2 border-t border-line bg-panel px-4 py-1.5 text-[10px] text-ink-faint">
          <Icon.Database width={11} height={11} />
          <button
            onClick={async () => {
              await fetch("/api/timeline-unlock", { method: "DELETE" });
              window.location.href = "/";
            }}
            className="font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            title="Sign out of this private workspace"
          >
            Lock workspace
          </button>
          <span>·</span>
          {backend === "supabase" ? (
            <>
              <span>Connected to Supabase</span>
              <button
                onClick={async () => {
                  const db = getSupabaseBrowserClient();
                  await db?.auth.signOut();
                  window.location.href = "/login";
                }}
                className="font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline"
              >
                Sign out
              </button>
            </>
          ) : (
            "Local demo mode — add Supabase keys to enable accounts & cloud storage"
          )}
        </div>
      </main>
    </div>
  );
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-ink-faint">
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-panel-2 text-ink-faint">
        <Icon.Layers width={26} height={26} />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-ink">No project selected</h2>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">
        Pick a project from the sidebar, or create a new one to start building its timeline.
      </p>
    </div>
  );
}
