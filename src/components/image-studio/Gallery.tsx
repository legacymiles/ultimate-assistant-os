"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { AGENTS, agentById } from "@/lib/image-studio/agents";
import type { GalleryItem } from "@/lib/image-studio/gallery";
import { mediaUrl } from "@/lib/image-studio/media";
import type { RefInput } from "@/lib/image-studio/prompt";

export interface Job {
  id: string;
  agentId: string;
  rawPrompt: string;
  prompt: string;
  refs: RefInput[];
  variant: number;
  status: "running" | "failed" | "refused";
  message: string;
}

interface Props {
  items: GalleryItem[];
  jobs: Job[];
  memory: Map<string, string>;
  onRetry: (job: Job) => void;
  onDismiss: (job: Job) => void;
  onSoften: (job: Job) => void;
  onRefine: (item: GalleryItem) => void;
  onDelete: (item: GalleryItem) => void;
}

const ASPECT_CLASS = { portrait: "aspect-[3/4]", square: "aspect-square", landscape: "aspect-video" } as const;

function useImageUrl(mediaId: string, memory: Map<string, string>) {
  const [url, setUrl] = useState<string | null>(memory.get(mediaId) ?? null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (memory.has(mediaId)) return;
    let live = true;
    mediaUrl(mediaId).then((u) => {
      if (!live) return;
      if (u) setUrl(u);
      else setMissing(true);
    });
    return () => {
      live = false;
    };
  }, [mediaId, memory]);
  return { url, missing };
}

export function Gallery(p: Props) {
  const [filter, setFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const i of p.items) c.set(i.agentId, (c.get(i.agentId) ?? 0) + 1);
    return c;
  }, [p.items]);

  const visible = filter === "all" ? p.items : p.items.filter((i) => i.agentId === filter);
  const jobs = filter === "all" ? p.jobs : p.jobs.filter((j) => j.agentId === filter);
  const openIndex = visible.findIndex((i) => i.id === openId);
  const open = openIndex >= 0 ? visible[openIndex] : null;

  return (
    <section className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Chip on={filter === "all"} onClick={() => setFilter("all")}>
          All <span className="text-ink-faint">{p.items.length}</span>
        </Chip>
        {AGENTS.map((a) => (
          <Chip key={a.id} on={filter === a.id} onClick={() => setFilter(a.id)}>
            {a.icon} {a.name} <span className="text-ink-faint">{counts.get(a.id) ?? 0}</span>
          </Chip>
        ))}
      </div>

      {!visible.length && !jobs.length ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-line text-center">
          <Icon.Image width={28} height={28} className="text-ink-faint" />
          <p className="mt-3 text-sm text-ink-muted">
            {p.items.length ? "No images from this agent yet." : "Your gallery is empty."}
          </p>
          <p className="mt-1 max-w-xs text-xs text-ink-faint">
            Pick an agent, write a prompt, add a photo of yourself, and hit Generate.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} onRetry={p.onRetry} onDismiss={p.onDismiss} onSoften={p.onSoften} />
          ))}
          {visible.map((item) => (
            <Thumb key={item.id} item={item} memory={p.memory} onOpen={() => setOpenId(item.id)} />
          ))}
        </div>
      )}

      {open && (
        <Lightbox
          item={open}
          memory={p.memory}
          onClose={() => setOpenId(null)}
          onPrev={openIndex > 0 ? () => setOpenId(visible[openIndex - 1].id) : undefined}
          onNext={openIndex < visible.length - 1 ? () => setOpenId(visible[openIndex + 1].id) : undefined}
          onRefine={() => {
            setOpenId(null);
            p.onRefine(open);
          }}
          onDelete={() => {
            setOpenId(null);
            p.onDelete(open);
          }}
        />
      )}
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] transition ${
        on ? "border-[var(--color-brand)] bg-panel-2 text-ink" : "border-line text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function JobCard({
  job,
  onRetry,
  onDismiss,
  onSoften,
}: {
  job: Job;
  onRetry: (j: Job) => void;
  onDismiss: (j: Job) => void;
  onSoften: (j: Job) => void;
}) {
  const agent = agentById(job.agentId);
  const aspect = ASPECT_CLASS[agent?.aspect ?? "square"];
  if (job.status === "running") {
    return (
      <div className={`${aspect} flex animate-pulse flex-col items-center justify-center rounded-xl border border-line bg-panel-2`}>
        <span className="text-2xl">{agent?.icon}</span>
        <span className="mt-2 text-[11px] text-ink-faint">Generating…</span>
      </div>
    );
  }
  const refused = job.status === "refused";
  return (
    <div className={`${aspect} flex flex-col justify-between overflow-hidden rounded-xl border border-line bg-panel p-3`}>
      <div className="min-h-0 overflow-y-auto">
        <p className={`text-[12px] font-semibold ${refused ? "text-amber-300" : "text-red-300"}`}>
          {refused ? "The model declined" : "Generation failed"}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-ink-muted">{job.message}</p>
      </div>
      <div className="mt-2 flex gap-1.5">
        {refused ? (
          <button
            type="button"
            onClick={() => onSoften(job)}
            className="flex-1 rounded-md bg-[var(--color-brand)] px-2 py-1 text-[11px] font-medium text-white"
          >
            Soften prompt
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onRetry(job)}
            className="flex-1 rounded-md bg-[var(--color-brand)] px-2 py-1 text-[11px] font-medium text-white"
          >
            Retry
          </button>
        )}
        <button
          type="button"
          onClick={() => onDismiss(job)}
          className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-muted hover:text-ink"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function Thumb({ item, memory, onOpen }: { item: GalleryItem; memory: Map<string, string>; onOpen: () => void }) {
  const { url, missing } = useImageUrl(item.mediaId, memory);
  const agent = agentById(item.agentId);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${ASPECT_CLASS[agent?.aspect ?? "square"]} group relative overflow-hidden rounded-xl border border-line bg-panel-2 text-left`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={item.rawPrompt} className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
      ) : (
        <span className="flex h-full items-center justify-center text-[11px] text-ink-faint">
          {missing ? "Image not in this browser" : "…"}
        </span>
      )}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-2 text-[11px] text-white opacity-0 transition group-hover:opacity-100">
        {agent?.icon} {item.rawPrompt}
      </span>
    </button>
  );
}

function Lightbox({
  item,
  memory,
  onClose,
  onPrev,
  onNext,
  onRefine,
  onDelete,
}: {
  item: GalleryItem;
  memory: Map<string, string>;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onRefine: () => void;
  onDelete: () => void;
}) {
  const { url } = useImageUrl(item.mediaId, memory);
  const agent = agentById(item.agentId);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev?.();
      if (e.key === "ArrowRight") onNext?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  const download = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `image-studio-${item.agentId}-${new Date(item.createdAt).toISOString().slice(0, 10)}-${item.id.slice(-4)}`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm lg:flex-row" role="dialog" aria-modal>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4" onClick={onClose}>
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={item.rawPrompt} className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
        )}
        {onPrev && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPrev();
            }}
            aria-label="Previous image"
            className="absolute left-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <Icon.ArrowLeft width={16} height={16} />
          </button>
        )}
        {onNext && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNext();
            }}
            aria-label="Next image"
            className="absolute right-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <Icon.ArrowRight width={16} height={16} />
          </button>
        )}
      </div>

      <aside className="flex max-h-[45dvh] w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-line bg-panel p-4 lg:max-h-none lg:w-[340px] lg:border-l lg:border-t-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-ink">
            {agent?.icon} {agent?.name ?? item.agentId}
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-ink-muted hover:text-ink">
            <Icon.Close width={14} height={14} />
          </button>
        </div>
        <p className="text-[13px] text-ink">{item.rawPrompt}</p>
        <p className="text-[11px] text-ink-faint">
          {new Date(item.createdAt).toLocaleString()}
          {item.refRoles.length ? ` · ${item.refRoles.length} reference${item.refRoles.length === 1 ? "" : "s"}` : ""}
          {item.offline ? " · offline preview" : item.model ? ` · ${item.model}` : ""}
        </p>

        <div className="grid grid-cols-3 gap-1.5">
          <Action onClick={download} icon={<Icon.Download width={14} height={14} />} label="Download" />
          <Action onClick={onRefine} icon={<Icon.Refresh width={14} height={14} />} label="Refine" />
          <Action onClick={onDelete} icon={<Icon.Trash width={14} height={14} />} label="Delete" />
        </div>

        <button
          type="button"
          onClick={() => setShowPrompt((v) => !v)}
          className="flex items-center gap-1 text-left text-[11px] font-medium text-ink-muted hover:text-ink"
        >
          <Icon.Chevron width={10} height={10} className={showPrompt ? "rotate-90" : ""} />
          Prompt the model received
        </button>
        {showPrompt && (
          <div className="relative rounded-lg bg-panel-2 p-2.5">
            <p className="whitespace-pre-wrap pr-6 text-[11.5px] leading-relaxed text-ink-muted">{item.prompt}</p>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(item.prompt)}
              aria-label="Copy prompt"
              className="absolute right-2 top-2 text-ink-faint hover:text-ink"
            >
              <Icon.Copy width={12} height={12} />
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

function Action({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-lg border border-line py-2 text-[11px] text-ink-muted transition hover:bg-panel-2 hover:text-ink"
    >
      {icon}
      {label}
    </button>
  );
}
