import Link from "next/link";
import { notFound } from "next/navigation";
import { AnimatedIcon } from "@/components/hub/AnimatedIcon";
import { BottomNav } from "@/components/hub/BottomNav";
import { Icon } from "@/components/icons";
import { PROJECTS, getProject } from "@/lib/catalog";

export function generateStaticParams() {
  return PROJECTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = getProject(slug);
  return { title: p ? `${p.title} · Ultimate Assistant OS` : "Project" };
}

export default async function ProjectDetail({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) notFound();

  const live = project.status === "live";

  return (
    <>
      <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
        >
          <Icon.ArrowLeft width={14} height={14} />
          Back to hub
        </Link>

        {/* Hero */}
        <section className="mt-5 flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left">
          <AnimatedIcon project={project} size={132} />
          <div className="mt-4 sm:ml-6 sm:mt-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {project.category}
              {project.tag && <span className="text-ink-faint"> · {project.tag}</span>}
            </div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              {project.title}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted sm:text-base">
              {project.overview}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              {live && project.appUrl && (
                <Link
                  href={project.appUrl}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2"
                >
                  <Icon.Launch width={16} height={16} />
                  Launch app
                </Link>
              )}
              {live && project.externalUrl && (
                <a
                  href={project.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2"
                >
                  <Icon.Launch width={16} height={16} />
                  Open
                </a>
              )}
              {!live && (
                <span className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2.5 text-sm font-medium text-ink-muted">
                  Coming soon
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Embedded preview / placeholder */}
        <section className="mt-8">
          {live && project.externalUrl ? (
            <div className="overflow-hidden rounded-2xl border border-line bg-panel">
              <iframe
                src={project.externalUrl}
                title={project.title}
                className="h-[70vh] w-full"
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            </div>
          ) : live && project.appUrl ? (
            <Link
              href={project.appUrl}
              className="group relative block overflow-hidden rounded-2xl border border-line bg-panel p-8 text-center transition hover:border-brand/50"
            >
              <div className="pointer-events-none absolute inset-0 opacity-40 blur-2xl">
                <AnimatedIcon project={project} size={420} className="mx-auto" />
              </div>
              <div className="relative">
                <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-brand/20 px-3 py-1 text-xs font-semibold text-brand">
                  Ready to use
                </div>
                <h2 className="mt-4 text-xl font-bold text-ink">Open {project.title}</h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
                  Tap below to launch the full app.
                </p>
                <span className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition group-hover:bg-brand-2">
                  <Icon.Launch width={16} height={16} />
                  Launch app
                </span>
              </div>
            </Link>
          ) : (
            <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
              <div className="mx-auto mb-3 inline-flex items-center justify-center rounded-full bg-panel-2 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                In the workshop
              </div>
              <h2 className="text-lg font-semibold text-ink">Not built yet</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
                This project is on the roadmap. It will live here when it&apos;s ready.
              </p>
            </div>
          )}
        </section>
      </div>
      <BottomNav />
    </>
  );
}
