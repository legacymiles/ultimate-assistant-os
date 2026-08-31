"use client";

import { useRef, useState } from "react";
import { Icon } from "../icons";
import { createItem, deleteItem } from "@/lib/recall/store";
import { fetchLinkMeta, isProbablyUrl, normalizeUrl, domainOf } from "@/lib/recall/media";
import {
  MAX_FILE_BYTES,
  categorize,
  deleteFile,
  extractText,
  isReadable,
  openStoredFile,
  putFile,
  thumbnail,
  type FileCategory,
} from "@/lib/recall/files";
import { formatBytes, relativeTime, uid } from "@/lib/utils";
import type { Item, RecallData } from "@/lib/recall/types";
import { Row, RowAction } from "./Section";

// ---------------------------------------------------------------------------
// Links & Resources — URLs and files in one place.
// Images, PDFs, docs and spreadsheets are READ on the way in and the text goes
// into item.extract, so search and the agent can retrieve on what was inside
// them. Video is stored and playable but never read — stated on the row rather
// than quietly pretended.
// ---------------------------------------------------------------------------

const CATEGORY_ICON: Record<FileCategory, typeof Icon.File> = {
  image: Icon.Image,
  video: Icon.Film,
  pdf: Icon.File,
  doc: Icon.File,
  sheet: Icon.Database,
  file: Icon.File,
};

function ExtractBadge({ item }: { item: Item }) {
  const status = item.extractStatus;
  if (!status || !item.attachment) return null;
  const map = {
    ok: ["text-emerald-300/80", "Read — searchable by its contents"],
    pending: ["text-amber-300/80", "Reading…"],
    unsupported: ["text-ink-faint", "Stored, not read"],
    failed: ["text-red-400/70", "Could not read this one"],
  } as const;
  const [tone, title] = map[status];
  const label = status === "ok" ? "read" : status === "pending" ? "reading…" : "not read";
  return (
    <span className={"shrink-0 text-[10px] " + tone} title={title}>
      {label}
    </span>
  );
}

export function LinksBody({
  items,
  folderId,
  adding,
  onAddingChange,
  onOpen,
  onData,
  onToast,
}: {
  items: Item[];
  folderId: string | null;
  adding: boolean;
  onAddingChange: (v: boolean) => void;
  onOpen: (item: Item) => void;
  onData: (d: RecallData) => void;
  onToast: (m: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function addUrl(raw: string) {
    setBusy("Fetching…");
    try {
      const clean = normalizeUrl(raw);
      const meta = await fetchLinkMeta(clean);
      const { data } = createItem({
        title: meta.title || domainOf(clean),
        body: "",
        summary: clean,
        kind: "link",
        source: "web",
        folderId,
        tags: [],
        url: clean,
        // The page's readable text — so a link is findable by its contents too.
        extract: meta.text && meta.text !== clean ? meta.text.slice(0, 20_000) : undefined,
        extractStatus: meta.text && meta.text !== clean ? "ok" : "unsupported",
      });
      setUrl("");
      onAddingChange(false);
      onData(data);
      onToast("Link saved");
    } finally {
      setBusy(null);
    }
  }

  async function addFiles(files: FileList | File[]) {
    const list = [...files];
    let data: RecallData | null = null;
    let saved = 0;

    for (const file of list) {
      if (file.size > MAX_FILE_BYTES) {
        onToast(`${file.name} is over ${formatBytes(MAX_FILE_BYTES)} — skipped`);
        continue;
      }
      const category = categorize(file.name, file.type);
      setBusy(isReadable(category) ? `Reading ${file.name}…` : `Storing ${file.name}…`);

      const fileId = uid("file");
      try {
        await putFile(fileId, file);
      } catch (e) {
        onToast(e instanceof Error ? e.message : `Could not store ${file.name}`);
        continue;
      }

      const [thumb, extraction] = await Promise.all([
        thumbnail(file),
        isReadable(category)
          ? extractText(file, category)
          : Promise.resolve({ text: "", status: "unsupported" as const }),
      ]);

      const res = createItem({
        title: file.name,
        body: "",
        summary:
          extraction.text.slice(0, 160) ||
          `${category.toUpperCase()} · ${formatBytes(file.size)}`,
        kind: category === "image" ? "image" : "file",
        source: "manual",
        folderId,
        tags: [],
        attachment: {
          name: file.name,
          type: file.type || category,
          size: file.size,
          url: thumb,
          fileId,
          category,
        },
        extract: extraction.text || undefined,
        extractStatus: extraction.status,
      });
      data = res.data;
      saved++;
    }

    setBusy(null);
    if (data) {
      onAddingChange(false);
      onData(data);
      onToast(saved === 1 ? "Saved" : `Saved ${saved} files`);
    }
  }

  async function removeItem(it: Item) {
    if (!window.confirm(`Delete “${it.title}”? This can’t be undone.`)) return;
    // Drop the blob too, or IndexedDB fills up with files nothing points at.
    if (it.attachment?.fileId) {
      try {
        await deleteFile(it.attachment.fileId);
      } catch {
        /* the item still goes — a stranded blob is swept on next prune */
      }
    }
    onData(deleteItem(it.id));
    onToast("Deleted");
  }

  return (
    <div
      className={
        "space-y-0.5 rounded-xl transition " +
        (dragOver ? "bg-brand/10 outline outline-2 outline-dashed outline-brand/50" : "")
      }
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
      }}
    >
      {items.map((it) => {
        const att = it.attachment;
        const cat = (att?.category as FileCategory) ?? "file";
        const CatIcon = att ? CATEGORY_ICON[cat] ?? Icon.File : Icon.Link;
        return (
          <Row
            key={it.id}
            onClick={() => {
              if (att?.fileId) void openStoredFile(att.fileId, att.name).catch((e) => onToast(e.message));
              else onOpen(it);
            }}
            actions={
              <>
                {it.url && (
                  <RowAction
                    label="Copy URL"
                    onClick={() => {
                      void navigator.clipboard.writeText(it.url as string);
                      onToast("URL copied");
                    }}
                  >
                    <Icon.Copy width={13} height={13} />
                  </RowAction>
                )}
                {it.url && (
                  <RowAction label="Open" onClick={() => window.open(it.url as string, "_blank", "noopener")}>
                    <Icon.Launch width={13} height={13} />
                  </RowAction>
                )}
                {att?.fileId && (
                  <RowAction
                    label="Download"
                    onClick={() =>
                      void openStoredFile(att.fileId as string, att.name).catch((e) => onToast(e.message))
                    }
                  >
                    <Icon.Download width={13} height={13} />
                  </RowAction>
                )}
                <RowAction label="Details" onClick={() => onOpen(it)}>
                  <Icon.Search width={13} height={13} />
                </RowAction>
                <RowAction label="Delete" danger onClick={() => void removeItem(it)}>
                  <Icon.Trash width={13} height={13} />
                </RowAction>
              </>
            }
          >
            {att?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={att.url} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
            ) : (
              <CatIcon width={13} height={13} className="shrink-0 text-ink-faint" />
            )}
            <span className="shrink-0 text-[13px] text-ink">{it.title}</span>
            <span className="min-w-0 truncate font-mono text-[10px] text-ink-faint">
              {it.url ?? (att ? `${cat} · ${formatBytes(att.size)}` : "")}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
              <ExtractBadge item={it} />
              <span className="text-[10px] text-ink-faint">{relativeTime(it.createdAt)}</span>
            </span>
          </Row>
        );
      })}

      {busy && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-ink-muted">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
          {busy}
        </div>
      )}

      {adding && !busy && (
        <div className="space-y-2 px-2 py-2">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isProbablyUrl(url.trim())) void addUrl(url.trim());
                if (e.key === "Escape") onAddingChange(false);
              }}
              placeholder="Paste a URL…"
              className="min-w-0 flex-1 rounded-lg border border-brand/40 bg-canvas px-2.5 py-1.5 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-brand"
            />
            <button
              onClick={() => url.trim() && void addUrl(url.trim())}
              disabled={!url.trim()}
              className="rounded-lg bg-brand px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
            >
              Add
            </button>
            <button
              onClick={() => onAddingChange(false)}
              className="rounded-lg p-1 text-ink-faint hover:text-ink"
              aria-label="Cancel"
            >
              <Icon.Close width={14} height={14} />
            </button>
          </div>

          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files?.length && void addFiles(e.target.files)}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line py-3 text-[11px] text-ink-faint transition hover:border-brand/50 hover:text-brand"
          >
            <Icon.Upload width={14} height={14} />
            Drop files here, or click to choose — images, PDFs, docs and video
          </button>
          <p className="px-0.5 text-[10px] leading-relaxed text-ink-faint">
            Everything is stored locally. PDFs, docs and images are read so you can search their
            contents; video is stored but not read.
          </p>
        </div>
      )}
    </div>
  );
}
