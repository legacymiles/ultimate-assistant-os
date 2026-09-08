"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { deleteItem, folderPathString, moveItem, setItemTags } from "@/lib/recall/store";
import { relativeTime } from "@/lib/utils";
import type { Folder, Item, RecallData } from "@/lib/recall/types";

interface Props {
  item: Item;
  folders: Folder[];
  onClose: () => void;
  onChange: (data: RecallData) => void;
  onDeleted: (data: RecallData) => void;
  onAsk: (item: Item) => void;
}

export function ItemDetailModal({ item, folders, onClose, onChange, onDeleted, onAsk }: Props) {
  const [tags, setTags] = useState<string[]>(item.tags);
  const [tagInput, setTagInput] = useState("");
  const [extractOpen, setExtractOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const folderOptions = useMemo(
    () =>
      [...folders]
        .map((f) => ({ id: f.id, path: folderPathString(folders, f.id) }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [folders],
  );

  function commitTags(next: string[]) {
    setTags(next);
    onChange(setItemTags(item.id, next));
  }

  function addTag(raw: string) {
    const t = raw.toLowerCase().trim().replace(/\s+/g, "-");
    if (t && !tags.includes(t)) commitTags([...tags, t]);
    setTagInput("");
  }

  function handleDelete() {
    if (!window.confirm(`Delete “${item.title}”? This can’t be undone.`)) return;
    onDeleted(deleteItem(item.id));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onClick={onClose}>
      <div
        className="animate-fade-in w-full max-w-2xl rounded-2xl border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] text-ink-faint">
              <Icon.Folder width={12} height={12} />
              <span className="truncate">{folderPathString(folders, item.folderId)}</span>
              <span>·</span>
              <span>{relativeTime(item.createdAt)}</span>
            </div>
            <h2 className="mt-1 text-lg font-bold text-ink">{item.title}</h2>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-ink-faint hover:bg-panel-2 hover:text-ink" aria-label="Close">
            <Icon.Close width={18} height={18} />
          </button>
        </div>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto p-5">
          {item.kind === "image" && item.attachment?.url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.attachment.url} alt={item.title} className="max-h-80 w-full rounded-xl border border-line object-contain" />
          )}

          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
            >
              <Icon.Link width={13} height={13} />
              {item.url}
            </a>
          )}

          {item.body && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">{item.body}</p>
          )}

          {/* What Dashboard read out of the file — the reason it is retrievable */}
          {item.extract && (
            <div className="rounded-xl border border-line bg-canvas">
              <button
                onClick={() => setExtractOpen((v) => !v)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
              >
                <Icon.Chevron
                  width={12}
                  height={12}
                  className={"text-ink-faint transition-transform " + (extractOpen ? "rotate-90" : "")}
                />
                <span className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                  Read from this file
                </span>
                <span className="ml-auto text-[10px] text-ink-faint">
                  {item.extract.length.toLocaleString()} chars indexed
                </span>
              </button>
              {extractOpen && (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-line-soft px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-muted">
                  {item.extract}
                </pre>
              )}
            </div>
          )}

          {item.attachment && item.extractStatus === "unsupported" && (
            <p className="rounded-lg border border-line bg-canvas px-3 py-2 text-[11px] text-ink-faint">
              Stored but not read — video is kept as-is, and images need an AI key to be described.
              You can still find this by its filename, folder and tags.
            </p>
          )}

          {/* Tags */}
          <div>
            <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">Tags</span>
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-canvas px-2 py-1.5">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-md bg-brand/15 px-1.5 py-0.5 text-[11px] font-medium text-brand">
                  {t}
                  <button onClick={() => commitTags(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
                    <Icon.Close width={11} height={11} />
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag(tagInput);
                  }
                }}
                placeholder={tags.length ? "" : "add a tag…"}
                className="min-w-[80px] flex-1 bg-transparent py-0.5 text-xs text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
          </div>
        </div>

        {/* footer actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
            <Icon.Move width={14} height={14} />
            <select
              value={item.folderId ?? ""}
              onChange={(e) => onChange(moveItem(item.id, e.target.value || null))}
              className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-brand"
            >
              <option value="">Unfiled</option>
              {folderOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.path}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={() => onAsk(item)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Bot width={14} height={14} /> Ask about this
          </button>

          <button
            onClick={handleDelete}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:border-red-500/40 hover:text-red-400"
          >
            <Icon.Trash width={14} height={14} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}
