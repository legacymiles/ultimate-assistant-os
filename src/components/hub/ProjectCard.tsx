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
