"use client";

import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import type { Project, ProjectFile, Version } from "@/lib/types";
import { getRepo } from "@/lib/repo";
import { fileCategory, formatBytes, formatDate, cn } from "@/lib/utils";
import { Icon } from "./icons";
import { AddVersionModal } from "./modals/AddVersionModal";

const CAT_STYLES: Record<string, string> = {
  mql: "bg-amber-500/15 text-amber-400",
  compiled: "bg-orange-500/15 text-orange-400",
  pdf: "bg-red-500/15 text-red-400",
  image: "bg-pink-500/15 text-pink-400",
  video: "bg-purple-500/15 text-purple-400",
  archive: "bg-yellow-500/15 text-yellow-400",
  doc: "bg-sky-500/15 text-sky-400",
  code: "bg-emerald-500/15 text-emerald-400",
  file: "bg-slate-500/15 text-slate-300",
};

function FileRow({ file }: { file: ProjectFile }) {
  const deleteFile = useStore((s) => s.deleteFile);
  const cat = fileCategory(file.name, file.type);
  return (
    <div className="group flex items-center gap-3 rounded-xl border border-line-soft bg-canvas px-3 py-2">
      <span
        className={cn(
          "flex h-8 w-9 shrink-0 items-center justify-center rounded-md text-[10px] font-bold uppercase",
          CAT_STYLES[cat] ?? CAT_STYLES.file,
        )}
      >
        {file.name.split(".").pop()?.slice(0, 4) ?? "file"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-ink">{file.name}</div>
        <div className="text-[11px] text-ink-faint">{formatBytes(file.size)}</div>
      </div>
      <button
        onClick={() => deleteFile(file.id)}
        className="rounded-md p-1.5 text-ink-faint opacity-0 transition hover:bg-panel-2 hover:text-red-400 group-hover:opacity-100"
        aria-label="Delete file"
      >
        <Icon.Trash width={15} height={15} />
      </button>
    </div>
  );
}

function VersionFiles({ version }: { version: Version }) {
  const addFile = useStore((s) => s.addFile);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    try {
      const local = getRepo().kind === "local";
      for (const f of files) {
        // In local mode, only inline small files (< 1.5MB) as data URLs to
        // keep localStorage healthy; larger files store metadata only.
        let dataUrl: string | undefined;
        if (local && f.size < 1_500_000) {
          dataUrl = await new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result as string);
            r.onerror = rej;
            r.readAsDataURL(f);
          });
        }
        await addFile(version.id, {
          name: f.name,
          type: f.type || fileCategory(f.name),
          size: f.size,
          dataUrl,
          blob: local ? undefined : f,
        });
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="mt-3 space-y-2">
      {version.files.length > 0 && (
        <div className="space-y-1.5">
          {version.files.map((f) => (
            <FileRow key={f.id} file={f} />
          ))}
        </div>
      )}
      <input ref={inputRef} type="file" multiple hidden onChange={onPick} />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line py-2.5 text-xs font-medium text-ink-muted transition hover:border-brand/50 hover:text-ink disabled:opacity-50"
      >
        <Icon.Upload width={15} height={15} />
        {uploading ? "Uploading…" : "Upload files to this version"}
      </button>
    </div>
  );
}

export function VersionTimeline({ project }: { project: Project }) {
  const deleteVersion = useStore((s) => s.deleteVersion);
  const [openId, setOpenId] = useState<string | null>(project.versions.at(-1)?.id ?? null);
  const [adding, setAdding] = useState(false);

  // Newest first for display.
  const versions = [...project.versions].sort(
    (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
  );

  const nextNumber = suggestNextNumber(project.versions);

  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon.Clock width={18} height={18} className="text-ink-muted" />
          <h2 className="text-base font-semibold text-ink">Version Timeline</h2>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
        >
          <Icon.Plus width={14} height={14} /> New version
        </button>
      </div>

      {versions.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-faint">
          No versions yet. Add your first version to start storing files.
        </p>
      ) : (
        <ol className="relative space-y-2 pl-5">
          <span className="absolute left-[7px] top-2 bottom-2 w-px bg-line" />
          {versions.map((v) => {
            const open = openId === v.id;
            return (
              <li key={v.id} className="relative">
                <span className="absolute -left-[14px] top-3.5 h-2.5 w-2.5 rounded-full border-2 border-panel bg-brand" />
                <div className="rounded-2xl border border-line bg-canvas">
                  <button
                    onClick={() => setOpenId(open ? null : v.id)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left"
                  >
                    <Icon.Chevron
                      width={16}
                      height={16}
                      className={cn(
                        "mt-1 shrink-0 text-ink-faint transition",
                        open && "rotate-90",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand">
                          v{v.number}
                        </span>
                        <span className="text-[11px] text-ink-faint">
                          {formatDate(v.created_at)}
                        </span>
                        {v.files.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint">
                            <Icon.File width={12} height={12} />
                            {v.files.length}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-ink-muted">
                        {v.summary || "No summary."}
                      </p>
                    </div>
                  </button>
                  {open && (
                    <div className="animate-fade-in border-t border-line-soft px-4 pb-4 pt-3">
                      {v.summary && (
                        <p className="mb-1 text-sm leading-relaxed text-ink-muted">{v.summary}</p>
                      )}
                      <VersionFiles version={v} />
                      <button
                        onClick={() => {
                          if (confirm(`Delete version ${v.number} and its files?`))
                            deleteVersion(v.id);
                        }}
                        className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink-faint transition hover:text-red-400"
                      >
                        <Icon.Trash width={13} height={13} /> Delete version
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <AddVersionModal
        projectId={project.id}
        suggestedNumber={nextNumber}
        open={adding}
        onClose={() => setAdding(false)}
      />
    </section>
  );
}

function suggestNextNumber(versions: Version[]): string {
  if (!versions.length) return "1.0";
  const nums = versions
    .map((v) => parseFloat(v.number))
    .filter((n) => !Number.isNaN(n));
  if (!nums.length) return "1.0";
  const max = Math.max(...nums);
  return (Math.floor(max) + 1).toFixed(1);
}
