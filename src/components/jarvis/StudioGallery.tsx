"use client";

// ---------------------------------------------------------------------------
// Everything the owner has made in Studio.
//
// The grid shows posters, not live media: a wall of twenty autoplaying clips
// is unusable and expensive. A clip only loads its bytes when it is opened,
// which is also when the blob URL is created, and that URL is released when
// the viewer closes.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import {
  deleteFromGallery,
  fileNameFor,
  getBlob,
  listGallery,
  onGalleryChange,
  prettyBytes,
  type GalleryItem,
} from "@/lib/studio/gallery";

type Filter = "all" | "video" | "image";

export function StudioGallery({ onReuse }: { onReuse?: (prompt: string) => void }) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<GalleryItem | null>(null);

  const refresh = useCallback(() => setItems(listGallery()), []);
  useEffect(() => {
    refresh();
    return onGalleryChange(refresh);
  }, [refresh]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        (filter === "all" || i.medium === filter) &&
        (!q || `${i.title} ${i.prompt} ${i.workflows.join(" ")} ${i.spec}`.toLowerCase().includes(q)),
    );
  }, [items, filter, query]);

  const counts = {
    all: items.length,
    video: items.filter((i) => i.medium === "video").length,
    image: items.filter((i) => i.medium === "image").length,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div role="tablist" aria-label="Medium" className="flex rounded-lg border border-line p-0.5">
          {(["all", "video", "image"] as Filter[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs capitalize transition ${
                filter === f ? "bg-panel-2 text-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              {f === "video" ? (
                <Icon.Film width={12} height={12} />
              ) : f === "image" ? (
                <Icon.Image width={12} height={12} />
              ) : null}
              {f}
              <span className="text-[10px] text-ink-faint">{counts[f]}</span>
            </button>
          ))}
        </div>
        <label className="ml-auto flex w-full items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2 py-1 sm:w-56">
          <Icon.Search width={12} height={12} className="text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by prompt or title"
            className="min-w-0 flex-1 bg-transparent text-xs text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {shown.length === 0 ? (
          <div className="mx-auto max-w-sm py-16 text-center">
            <p className="text-sm text-ink">{items.length ? "Nothing matches that." : "Nothing made yet."}</p>
            <p className="mt-1 text-xs text-ink-muted">
              {items.length
                ? "Try a different word, or clear the filter."
                : "Every clip and image you render lands here, with the prompt that made it."}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2.5">
            {shown.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setOpen(item)}
                  className="cin-tile group block w-full overflow-hidden rounded-xl border border-line text-left transition hover:border-ink-faint"
                >
                  <span className="relative block aspect-video overflow-hidden bg-canvas">
                    {item.poster ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={item.poster} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full w-full place-items-center text-ink-faint">
                        {item.medium === "video" ? <Icon.Film width={20} height={20} /> : <Icon.Image width={20} height={20} />}
                      </span>
                    )}
                    {item.medium === "video" && (
                      <span className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                        Clip
                      </span>
                    )}
                  </span>
                  <span className="block px-2 py-1.5">
                    <span className="block truncate text-[11px] font-medium text-ink">{item.title}</span>
                    <span className="block truncate text-[10px] text-ink-faint">
                      {item.spec || new Date(item.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {open && (
        <Viewer
          item={open}
          onClose={() => setOpen(null)}
          onReuse={onReuse}
          onDeleted={() => {
            setOpen(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function Viewer({
  item,
  onClose,
  onReuse,
  onDeleted,
}: {
  item: GalleryItem;
  onClose: () => void;
  onReuse?: (prompt: string) => void;
  onDeleted: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let revoke: string | null = null;
    let alive = true;
    void getBlob(item.id).then((blob) => {
      if (!alive) return;
      if (!blob) {
        setMissing(true);
        return;
      }
      revoke = URL.createObjectURL(blob);
      setUrl(revoke);
    });
    return () => {
      alive = false;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [item.id]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/85 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        className="cin-panel flex max-h-[92vh] w-[min(920px,96vw)] flex-col overflow-hidden rounded-2xl border border-line bg-panel"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{item.title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-lg border border-line text-ink-muted transition hover:border-ink-faint hover:text-ink"
          >
            <Icon.Close width={13} height={13} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid max-h-[55vh] place-items-center bg-canvas">
            {missing ? (
              <p className="px-6 py-16 text-center text-xs text-ink-muted">
                The record is here but the bytes are gone — browser storage was cleared since this was made.
              </p>
            ) : !url ? (
              <p className="px-6 py-16 text-center text-xs text-ink-faint">Opening…</p>
            ) : item.medium === "video" ? (
              <video src={url} controls loop playsInline className="max-h-[55vh] w-full object-contain" />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={url} alt={item.title} className="max-h-[55vh] w-full object-contain" />
            )}
          </div>

          <dl className="grid gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-2">
            <Row label="Made">{new Date(item.createdAt).toLocaleString()}</Row>
            <Row label="Size">
              {prettyBytes(item.bytes)} · {item.mime}
            </Row>
            {item.spec && <Row label="Camera">{item.spec}</Row>}
            {item.workflows.length > 0 && <Row label="Workflows">{item.workflows.join(", ")}</Row>}
          </dl>

          {item.prompt && (
            <div className="px-4 pb-4">
              <p className="mb-1 text-[10px] uppercase tracking-[0.06em] text-ink-faint">The prompt that made it</p>
              <p className="whitespace-pre-wrap rounded-lg border border-line bg-panel-2 p-2.5 text-[11px] leading-relaxed text-ink-muted">
                {item.prompt}
              </p>
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          {item.prompt && onReuse && (
            <button
              type="button"
              onClick={() => {
                onReuse(item.prompt);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-muted transition hover:border-ink-faint hover:text-ink"
            >
              <Icon.Refresh width={12} height={12} /> Make another like this
            </button>
          )}
          {item.prompt && (
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(item.prompt).catch(() => {})}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-muted transition hover:border-ink-faint hover:text-ink"
            >
              <Icon.Copy width={12} height={12} /> Copy prompt
            </button>
          )}
          {url && (
            <a
              href={url}
              download={fileNameFor(item)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-muted transition hover:border-ink-faint hover:text-ink"
            >
              <Icon.Download width={12} height={12} /> Save
            </a>
          )}
          {confirming ? (
            <span className="ml-auto flex items-center gap-2 text-[11px] text-ink-muted">
              Delete for good?
              <button
                type="button"
                onClick={() => void deleteFromGallery(item.id).then(onDeleted)}
                className="rounded-lg border border-amber-500/40 px-2 py-1 text-[11px] text-amber-400 transition hover:bg-amber-500/10"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-[11px] text-ink-faint underline hover:text-ink"
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-ink-faint transition hover:text-ink"
            >
              <Icon.Trash width={12} height={12} /> Delete
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.06em] text-ink-faint">{label}</dt>
      <dd className="truncate text-[11px] text-ink-muted">{children}</dd>
    </div>
  );
}
