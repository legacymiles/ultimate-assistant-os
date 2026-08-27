import Link from "next/link";
import type { CatalogProject } from "@/lib/catalog";
import { AnimatedIcon } from "./AnimatedIcon";

export function ProjectCard({ project }: { project: CatalogProject }) {
  const live = project.status === "live";

  // Tap target = direct to the live app (or external site) when ready.
  // Coming-soon projects land on the detail page (the "in the workshop" view).
  const primaryHref = live
    ? project.appUrl ?? project.externalUrl ?? `/p/${project.slug}`
    : `/p/${project.slug}`;
  const isExternal = live && !project.appUrl && Boolean(project.externalUrl);

  const inner = (
    <>
      <div className="relative">
        <AnimatedIcon project={project} size={108} />
        {!live && (
          <span className="absolute right-1 top-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-muted backdrop-blur">
            Soon
          </span>
        )}
      </div>
      <div className="w-full text-center">
        <div className="truncate text-sm font-semibold text-ink">{project.title}</div>
        {project.tag && (
          <div className="truncate text-[11px] text-ink-faint">{project.tag}</div>
        )}
      </div>

      {/* Desktop hover popover — preview without leaving the gallery. */}
      <div className="hub-popover pointer-events-none absolute bottom-full left-1/2 z-20 mb-3 hidden w-[min(20rem,80vw)] -translate-x-1/2 translate-y-1 rounded-2xl border border-line bg-panel/95 p-4 text-left opacity-0 shadow-2xl backdrop-blur-md transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 sm:block">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          <span>{project.category}</span>
          {live ? (
            <span className="rounded-full bg-core/15 px-1.5 py-0.5 text-[9px] text-core">Live</span>
          ) : (
            <span className="rounded-full bg-panel-2 px-1.5 py-0.5 text-[9px] text-ink-muted">Soon</span>
          )}
        </div>
        <div className="text-sm font-semibold text-ink">{project.title}</div>
        {project.tag && (
          <div className="mt-0.5 text-[11px] font-medium text-brand">{project.tag}</div>
        )}
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">{project.overview}</p>
        {/* Arrow */}
        <span className="absolute left-1/2 top-full -mt-1 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-b border-r border-line bg-panel/95" />
      </div>
    </>
  );

  const cls =
    "hub-card group relative flex flex-col items-center gap-2 rounded-2xl p-2 outline-none transition focus-visible:bg-panel-2";

  if (isExternal) {
    return (
      <a href={primaryHref} target="_blank" rel="noreferrer" className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={primaryHref} prefetch={false} className={cls}>
      {inner}
    </Link>
  );
}
