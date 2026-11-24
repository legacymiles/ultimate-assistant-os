"use client";

// Building blocks shared by My Library and Collections: the image masonry with
// its owner actions, the dense prompt list, the chip board with a selection
// bar, the reference grid, a confirm dialog and the scoped styles they need.
// Everything reads and writes through the Inspire store, so a change on one
// screen is already true on the other.

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  FolderPlus,
  Globe2,
  History,
  ImageOff,
  Lock,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Send,
  Star,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { DNA_GROUPS, groupOf } from "@/lib/image-studio/inspire/taxonomy";
import {
  REFERENCE_PURPOSES,
  type InspireImage,
  type LibraryChip,
  type LibraryImage,
  type LibraryItem,
  type LibraryPrompt,
  type LibraryReference,
  type PromptOrigin,
  type ReferencePurpose,
} from "@/lib/image-studio/inspire/types";
import { api } from "../api";
import { PublishDialog } from "../PublishDialog";
import { useInspire } from "../store";
import { CollectionChecklist, CollectionMenu, DnaChip, Menu, Modal, Shot, Spinner, layoutMasonry, useColumns } from "../ui";

// ----- small helpers ----------------------------------------------------------

export type SortKey = "new" | "old" | "az";
export const SORTS: { id: SortKey; label: string }[] = [
  { id: "new", label: "Newest" },
  { id: "old", label: "Oldest" },
  { id: "az", label: "A–Z" },
];

export function sortList<T>(list: T[], sort: SortKey, date: (t: T) => string, name: (t: T) => string): T[] {
  const out = [...list];
  if (sort === "az") out.sort((a, b) => name(a).localeCompare(name(b), undefined, { sensitivity: "base" }));
  else out.sort((a, b) => (sort === "new" ? date(b).localeCompare(date(a)) : date(a).localeCompare(date(b))));
  return out;
}

/** Case-insensitive "every word appears somewhere in these fields". */
export function matches(q: string, ...fields: (string | undefined | null)[]): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const ORIGIN_LABEL: Record<PromptOrigin, string> = {
  saved: "Saved",
  reverse: "Reverse prompt",
  remix: "Remix",
  builder: "Builder",
  enhanced: "Enhanced",
};

export function purposeLabel(p: ReferencePurpose): string {
  return REFERENCE_PURPOSES.find((x) => x.id === p)?.label ?? p;
}

function errText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

// ----- images -----------------------------------------------------------------

export type ImageKind = "saved" | "uploaded" | "generated";

export interface ImageEntry {
  img: InspireImage;
  /** The library item that saves it, if there is one. */
  item?: LibraryImage;
  /** The signed-in user made or uploaded it. */
  own: boolean;
  kind: ImageKind;
  addedAt: string;
}

const isImageItem = (i: LibraryItem): i is LibraryImage => i.kind === "image";

/** Saved images plus the user's own uploads and generations, one entry per image. */
export function imageEntries(items: LibraryItem[], ownImages: InspireImage[], images: Record<string, InspireImage>): { entries: ImageEntry[]; missing: LibraryImage[] } {
  const saved = new Map(items.filter(isImageItem).map((i) => [i.imageId, i]));
  const byId = new Map<string, ImageEntry>();
  for (const img of ownImages) {
    if (img.source !== "upload" && img.source !== "reverse" && img.source !== "generated") continue;
    const item = saved.get(img.id);
    byId.set(img.id, { img, item, own: true, kind: img.source === "generated" ? "generated" : "uploaded", addedAt: item?.createdAt ?? img.createdAt });
  }
  const missing: LibraryImage[] = [];
  for (const item of saved.values()) {
    if (byId.has(item.imageId)) continue;
    const img = images[item.imageId];
    if (!img) {
      missing.push(item);
      continue;
    }
    byId.set(img.id, { img, item, own: false, kind: "saved", addedAt: item.createdAt });
  }
  return { entries: [...byId.values()], missing };
}

/** Image entries for library items only (a collection's contents). */
export function entriesForItems(items: LibraryImage[], ownImages: InspireImage[], images: Record<string, InspireImage>): ImageEntry[] {
  const own = new Set(ownImages.map((i) => i.id));
  return items.flatMap((item) => {
    const img = images[item.imageId];
    if (!img) return [];
    const mine = own.has(img.id);
    return [{ img, item, own: mine, kind: (mine ? (img.source === "generated" ? "generated" : "uploaded") : "saved") as ImageKind, addedAt: item.createdAt }];
  });
}

/** Masonry of image cards. Holds the edit dialog and delete confirm for own images. */
export function ImageGrid({ entries, extraMenu }: { entries: ImageEntry[]; extraMenu?: (e: ImageEntry, close: () => void) => ReactNode }) {
  const { dropOwnImage, toast } = useInspire();
  const ref = useRef<HTMLDivElement>(null);
  const cols = useColumns(ref, 220);
  const [editing, setEditing] = useState<InspireImage | null>(null);
  const [deleting, setDeleting] = useState<InspireImage | null>(null);
  const columns = useMemo(() => layoutMasonry(entries.map((e) => ({ e, width: e.img.width, height: e.img.height })), cols), [entries, cols]);
  const closeEdit = useCallback(() => setEditing(null), []);
  const closeDelete = useCallback(() => setDeleting(null), []);

  const confirmDelete = async () => {
    const img = deleting;
    if (!img) return;
    try {
      await api.del(`/images/${encodeURIComponent(img.id)}`);
      dropOwnImage(img.id);
      toast(`Deleted "${img.title}"`);
      setDeleting(null);
    } catch (err) {
      toast(errText(err, "Couldn't delete that image."), { tone: "bad" });
    }
  };

  return (
    <>
      <div ref={ref} className="insp-masonry">
        {columns.map((col, i) => (
          <div key={i} className="insp-masonry-col">
            {col.map(({ e }) => (
              <ImageCard key={e.img.id} e={e} onEdit={setEditing} onDelete={setDeleting} extraMenu={extraMenu} />
            ))}
          </div>
        ))}
      </div>
      <PublishDialog open={!!editing} onClose={closeEdit} image={editing} />
      <Confirm
        open={!!deleting}
        onClose={closeDelete}
        title="Delete permanently? This can't be undone."
        body={deleting ? `"${deleting.title}" is removed from your library, from every collection${deleting.visibility === "public" ? " and from Explore" : ""}.` : undefined}
        confirmLabel="Delete image"
        onConfirm={confirmDelete}
      />
    </>
  );
}

function ImageCard({ e, onEdit, onDelete, extraMenu }: { e: ImageEntry; onEdit: (img: InspireImage) => void; onDelete: (img: InspireImage) => void; extraMenu?: (e: ImageEntry, close: () => void) => ReactNode }) {
  const { openImage, removeItem, saveImage, upsertOwnImage, toast } = useInspire();
  const { img, item, own } = e;
  const [busy, setBusy] = useState(false);
  const isPublic = img.visibility === "public";

  const togglePublish = async () => {
    if (!isPublic && (!img.prompt.trim() || !img.title.trim() || img.title === "Untitled")) {
      // Publishing needs a title and the prompt — finish those in the dialog.
      onEdit(img);
      return;
    }
    setBusy(true);
    try {
      const r = await api.patch<{ image: InspireImage }>(`/images/${encodeURIComponent(img.id)}`, { visibility: isPublic ? "private" : "public" });
      upsertOwnImage(r.image);
      toast(isPublic ? "Unpublished — only you can see it now" : "Published to Explore");
    } catch (err) {
      toast(errText(err, "Couldn't change who can see it."), { tone: "bad" });
    } finally {
      setBusy(false);
    }
  };

  const removeFromLibrary = async () => {
    if (!item) return;
    await removeItem(item);
    toast("Removed from your library", { action: { label: "Undo", run: () => void saveImage(img, item.collectionIds) } });
  };

  return (
    <div className="insp-card lib-card" style={{ aspectRatio: `${Math.max(1, img.width)} / ${Math.max(1, img.height)}` }}>
      <button type="button" className="lib-card-hit" onClick={() => openImage(img)} aria-label={`Open ${img.title}`}>
        <span aria-hidden style={{ position: "absolute", inset: 0, background: img.tint || "var(--raise)" }} />
        <Shot img={img} style={{ position: "relative", width: "100%", height: "100%" }} />
        <span className="insp-card-veil" />
        <span className="insp-card-info">
          <span style={{ display: "block", fontWeight: 600, fontSize: 13, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{img.title}</span>
          {!own && <span className="insp-mono" style={{ display: "block", fontSize: 10.5, color: "var(--ink-2)", marginTop: 2 }}>by @{img.creator}</span>}
        </span>
      </button>
      <span className="lib-card-badges">
        {own ? (
          <span className="insp-badge lib-onimg">
            {isPublic ? <Globe2 size={10} /> : <Lock size={10} />}
            {isPublic ? "Public" : "Private"}
          </span>
        ) : (
          <span className="insp-badge lib-onimg">Saved</span>
        )}
        {img.source === "generated" && <span className="insp-badge lib-onimg">Generated</span>}
      </span>
      <span className="insp-card-save lib-card-tools">
        {item ? (
          <CollectionMenu item={item}>
            {(open) => (
              <button type="button" className="insp-btn insp-btn-sm insp-btn-icon lib-onimg" onClick={open} aria-label="Add to collection" title="Add to collection">
                <FolderPlus size={14} />
              </button>
            )}
          </CollectionMenu>
        ) : (
          <Menu
            label="Collections"
            trigger={(open) => (
              <button type="button" className="insp-btn insp-btn-sm insp-btn-icon lib-onimg" onClick={open} aria-label="Add to collection" title="Add to collection">
                <FolderPlus size={14} />
              </button>
            )}
          >
            {() => <CollectionChecklist selected={[]} onChange={(ids) => void saveImage(img, ids)} />}
          </Menu>
        )}
        <Menu
          label="Image actions"
          trigger={(open, expanded) => (
            <button type="button" className="insp-btn insp-btn-sm insp-btn-icon lib-onimg" onClick={open} aria-label={`Actions for ${img.title}`} aria-haspopup="menu" aria-expanded={expanded}>
              {busy ? <Spinner size={13} /> : <MoreHorizontal size={15} />}
            </button>
          )}
        >
          {(close) => (
            <>
              {own && (
                <>
                  <button type="button" role="menuitem" className="insp-menu-item" onClick={() => { close(); onEdit(img); }}>
                    <Pencil size={15} /> Edit details
                  </button>
                  {img.source !== "reference" && (
                    <button type="button" role="menuitem" className="insp-menu-item" onClick={() => { close(); void togglePublish(); }}>
                      {isPublic ? <Lock size={15} /> : <Globe2 size={15} />}
                      {isPublic ? "Unpublish — make private" : "Publish to Explore"}
                    </button>
                  )}
                </>
              )}
              {extraMenu?.(e, close)}
              {item && (
                <button type="button" role="menuitem" className="insp-menu-item" onClick={() => { close(); void removeFromLibrary(); }}>
                  <X size={15} /> Remove from library
                </button>
              )}
              {own && (
                <>
                  <div className="insp-menu-sep" />
                  <button type="button" role="menuitem" className="insp-menu-item" style={{ color: "var(--bad)" }} onClick={() => { close(); onDelete(img); }}>
                    <Trash2 size={15} /> Delete permanently…
                  </button>
                </>
              )}
              {!own && !item && !extraMenu && <div className="insp-faint" style={{ padding: "6px 10px", fontSize: 12.5 }}>Nothing to change on this image.</div>}
            </>
          )}
        </Menu>
      </span>
    </div>
  );
}

// ----- prompts ----------------------------------------------------------------

async function restorePrompt(p: LibraryPrompt) {
  await api.post("/library", { kind: "prompt", title: p.title, text: p.text, chips: p.chips, origin: p.origin, imageId: p.imageId, collectionIds: p.collectionIds });
}

/** Dense list of saved prompts. `extra` adds buttons to each row's action strip. */
export function PromptList({ items, extra }: { items: LibraryPrompt[]; extra?: (p: LibraryPrompt) => ReactNode }) {
  return (
    <ul className="lib-rows" aria-label="Saved prompts">
      {items.map((p) => (
        <PromptRow key={p.id} p={p} extra={extra?.(p)} />
      ))}
    </ul>
  );
}

function PromptRow({ p, extra }: { p: LibraryPrompt; extra?: ReactNode }) {
  const { lib, copy, sendToBuilder, patchItem, removeItem, toast, reloadLibrary, openImage } = useInspire();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(p.title);
  const [text, setText] = useState(p.text);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState(false);
  const img = p.imageId ? lib.images[p.imageId] : undefined;
  const long = p.text.length > 180 || p.text.includes("\n");

  const startEdit = () => {
    setTitle(p.title);
    setText(p.text);
    setEditing(true);
  };
  const save = async () => {
    const t = text.trim();
    if (!t) return toast("A prompt can't be empty.", { tone: "bad" });
    setSaving(true);
    const changes: Record<string, unknown> = {};
    if (t !== p.text) Object.assign(changes, { text: t, versionNote: "edited" });
    if (title.trim() && title.trim() !== p.title) changes.title = title.trim();
    const ok = Object.keys(changes).length ? await patchItem(p.id, changes) : p;
    setSaving(false);
    if (ok) {
      setEditing(false);
      if (changes.text) toast("Saved — the old wording is kept under Versions");
    }
  };
  const restore = async (v: LibraryPrompt["versions"][number]) => {
    const r = await patchItem(p.id, { text: v.text, versionNote: "before restore" });
    if (r) toast("Restored — the wording you replaced is kept under Versions");
  };
  const del = async () => {
    await removeItem(p);
    toast(`Deleted "${p.title}"`, {
      action: {
        label: "Undo",
        run: () =>
          void restorePrompt(p)
            .then(reloadLibrary)
            .catch((err) => toast(errText(err, "Couldn't bring it back."), { tone: "bad" })),
      },
    });
  };

  return (
    <li className="lib-row">
      <div className="lib-row-thumb">
        {img ? (
          <button type="button" className="lib-thumb-btn" onClick={() => openImage(img)} aria-label={`Open the image "${img.title}"`}>
            <Shot img={img} style={{ width: "100%", height: "100%", display: "block", borderRadius: 10 }} />
          </button>
        ) : (
          <span className="lib-thumb-empty" aria-hidden>
            <FileText size={18} />
          </span>
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px" }}>
          {editing ? (
            <input className="insp-input" style={{ height: 34, maxWidth: 420 }} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={90} aria-label="Prompt title" />
          ) : (
            <span className="insp-h3" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
              {p.title}
            </span>
          )}
          <span className="insp-badge">{ORIGIN_LABEL[p.origin]}</span>
          <span className="insp-faint insp-mono" style={{ fontSize: 11 }}>
            {fmtDate(p.updatedAt || p.createdAt)}
          </span>
        </div>
        {editing ? (
          <form
            style={{ marginTop: 8, display: "grid", gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <textarea
              className="insp-textarea"
              value={text}
              autoFocus
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
              }}
              rows={4}
              aria-label="Prompt text"
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button type="submit" className="insp-btn insp-btn-sm insp-btn-primary" disabled={saving}>
                {saving ? <Spinner size={13} /> : <Check size={14} />} Save
              </button>
              <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </button>
              <span className="insp-faint" style={{ fontSize: 12 }}>
                The current wording is kept as a version.
              </span>
            </div>
          </form>
        ) : (
          <>
            <p className="lib-prompt" data-open={expanded}>
              {p.text}
            </p>
            {long && (
              <button type="button" className="lib-link" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
                {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {expanded ? "Show less" : "Show all"}
              </button>
            )}
          </>
        )}
        {p.chips.length > 0 && (
          <div className="insp-chips" style={{ marginTop: 8, gap: 4 }}>
            {p.chips.slice(0, expanded ? undefined : 12).map((c, i) => (
              <DnaChip key={`${c.text}-${i}`} chip={c} small />
            ))}
            {!expanded && p.chips.length > 12 && (
              <button type="button" className="lib-link" onClick={() => setExpanded(true)}>
                +{p.chips.length - 12} more
              </button>
            )}
          </div>
        )}
        {versions && (
          <div className="lib-versions">
            <div className="insp-kicker" style={{ marginBottom: 6 }}>
              Earlier wordings
            </div>
            {p.versions.length === 0 && <div className="insp-faint" style={{ fontSize: 12.5 }}>No earlier wordings yet. Editing keeps the old text here.</div>}
            {p.versions.map((v, i) => (
              <div key={`${v.at}-${i}`} className="lib-version">
                <div style={{ minWidth: 0 }}>
                  <div className="insp-faint insp-mono" style={{ fontSize: 10.5, marginBottom: 2 }}>
                    {fmtDate(v.at)}
                    {v.note ? ` · ${v.note}` : ""}
                  </div>
                  <div className="insp-muted" style={{ fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {v.text}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4, flex: "none" }}>
                  <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet insp-btn-icon" onClick={() => void copy(v.text, "Copied that version")} aria-label="Copy this version" title="Copy">
                    <Copy size={13} />
                  </button>
                  <button type="button" className="insp-btn insp-btn-sm" onClick={() => void restore(v)}>
                    <RotateCcw size={13} /> Restore
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="lib-row-actions">
        <button type="button" className="insp-btn insp-btn-sm" onClick={() => sendToBuilder(p.chips, { replace: true, origin: { kind: "prompt", label: p.title }, history: p.text })}>
          <Wand2 size={14} /> Open in Builder
        </button>
        <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet insp-btn-icon" onClick={() => void copy(p.text, "Prompt copied")} aria-label="Copy prompt" title="Copy prompt">
          <Copy size={14} />
        </button>
        <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet insp-btn-icon" onClick={editing ? () => setEditing(false) : startEdit} aria-label="Edit prompt" aria-pressed={editing} title="Edit">
          <Pencil size={14} />
        </button>
        <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet" onClick={() => setVersions((x) => !x)} aria-expanded={versions} title="Earlier wordings">
          <History size={14} />
          <span className="insp-count">{p.versions.length}</span>
        </button>
        <CollectionMenu item={p}>
          {(open) => (
            <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet insp-btn-icon" onClick={open} aria-label="Collections" title="Collections">
              <FolderPlus size={14} />
            </button>
          )}
        </CollectionMenu>
        {extra}
        <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet insp-btn-icon lib-danger" onClick={() => void del()} aria-label="Delete prompt" title="Delete">
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}

// ----- chips ------------------------------------------------------------------

/** Add to / remove from collections for several items at once. */
export function BulkCollectionMenu({ items, label = "Add to collection" }: { items: LibraryItem[]; label?: string }) {
  const { lib, setItemCollections } = useInspire();
  const common = lib.collections.filter((c) => items.length > 0 && items.every((i) => i.collectionIds.includes(c.id))).map((c) => c.id);
  return (
    <Menu
      label="Collections"
      align="left"
      trigger={(open, expanded) => (
        <button type="button" className="insp-btn insp-btn-sm" onClick={open} aria-haspopup="menu" aria-expanded={expanded}>
          <FolderPlus size={14} /> {label}
        </button>
      )}
    >
      {() => (
        <CollectionChecklist
          selected={common}
          onChange={(ids) => {
            const added = ids.filter((x) => !common.includes(x));
            const removed = common.filter((x) => !ids.includes(x));
            for (const it of items) {
              const next = [...new Set([...it.collectionIds.filter((x) => !removed.includes(x)), ...added])];
              void setItemCollections(it, next);
            }
          }}
        />
      )}
    </Menu>
  );
}

/** Saved chips grouped by DNA group, with favourites and a selection bar. */
export function ChipBoard({ items, barExtra }: { items: LibraryChip[]; barExtra?: (selected: LibraryChip[], clear: () => void) => ReactNode }) {
  const { sendToBuilder, copy, patchItem, removeItem, toast, reloadLibrary } = useInspire();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const selected = items.filter((i) => sel.has(i.id));
  const clear = () => setSel(new Set());
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const groups = DNA_GROUPS.map((g) => ({ g, list: items.filter((i) => groupOf(i.chip.category).id === g.id) })).filter((x) => x.list.length);

  const del = async () => {
    const gone = selected;
    clear();
    await Promise.all(gone.map((c) => removeItem(c)));
    toast(`Deleted ${plural(gone.length, "chip")}`, {
      action: {
        label: "Undo",
        run: () =>
          void Promise.all(gone.map((c) => api.post("/library", { kind: "chip", chip: c.chip, favorite: c.favorite, custom: c.custom, collectionIds: c.collectionIds })))
            .then(reloadLibrary)
            .catch((err) => toast(errText(err, "Couldn't bring them back."), { tone: "bad" })),
      },
    });
  };

  return (
    <div>
      <div style={{ display: "grid", gap: 22 }}>
        {groups.map(({ g, list }) => {
          const all = list.every((i) => sel.has(i.id));
          return (
            <section key={g.id} aria-label={g.label}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span className="lib-dot" style={{ ["--h" as string]: String(g.hue) }} aria-hidden />
                <span className="insp-kicker" style={{ color: `oklch(0.8 0.12 ${g.hue})` }}>
                  {g.label}
                </span>
                <span className="insp-count">{list.length}</span>
                <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
                <button
                  type="button"
                  className="lib-link"
                  onClick={() =>
                    setSel((s) => {
                      const n = new Set(s);
                      for (const i of list) {
                        if (all) n.delete(i.id);
                        else n.add(i.id);
                      }
                      return n;
                    })
                  }
                >
                  {all ? "Clear group" : "Select group"}
                </button>
              </div>
              <div className="insp-chips">
                {list.map((i) => (
                  <span key={i.id} className="lib-chipwrap">
                    <DnaChip chip={i.chip} pressed={sel.has(i.id)} onClick={() => toggle(i.id)} />
                    <button
                      type="button"
                      className="lib-star"
                      data-on={i.favorite}
                      aria-pressed={i.favorite}
                      aria-label={i.favorite ? `Unfavorite ${i.chip.text}` : `Favorite ${i.chip.text}`}
                      title={i.favorite ? "Favorite" : "Mark as favorite"}
                      onClick={() => void patchItem(i.id, { favorite: !i.favorite })}
                    >
                      <Star size={13} fill={i.favorite ? "currentColor" : "none"} />
                    </button>
                  </span>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {selected.length > 0 && (
        <div className="lib-selbar" role="region" aria-label="Selected chips">
          <span className="insp-mono" style={{ fontSize: 12, paddingLeft: 6 }}>
            {selected.length} selected
          </span>
          <button type="button" className="insp-btn insp-btn-sm insp-btn-primary" onClick={() => sendToBuilder(selected.map((s) => s.chip))}>
            <Send size={14} /> Send {selected.length} to Builder
          </button>
          <button type="button" className="insp-btn insp-btn-sm" onClick={() => void copy(selected.map((s) => s.chip.text).join(", "), `Copied ${plural(selected.length, "chip")}`)}>
            <Copy size={14} /> Copy as text
          </button>
          <BulkCollectionMenu items={selected} />
          {barExtra?.(selected, clear)}
          <button type="button" className="insp-btn insp-btn-sm insp-btn-danger" onClick={() => void del()}>
            <Trash2 size={14} /> Delete
          </button>
          <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet insp-btn-icon" onClick={clear} aria-label="Clear selection" title="Clear selection">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

// ----- references -------------------------------------------------------------

export function ReferenceGrid({ items, extra }: { items: LibraryReference[]; extra?: (r: LibraryReference) => ReactNode }) {
  const { removeItem, toast } = useInspire();
  const [deleting, setDeleting] = useState<LibraryReference | null>(null);
  const close = useCallback(() => setDeleting(null), []);
  return (
    <>
      <div className="lib-refgrid">
        {items.map((r) => (
          <ReferenceTile key={r.id} r={r} onDelete={setDeleting} extra={extra?.(r)} />
        ))}
      </div>
      <Confirm
        open={!!deleting}
        onClose={close}
        title="Delete this reference? This can't be undone."
        body={deleting ? `"${deleting.name}" and its private image file are deleted. Builds that already used it are not affected.` : undefined}
        confirmLabel="Delete reference"
        onConfirm={async () => {
          if (!deleting) return;
          await removeItem(deleting);
          toast(`Deleted "${deleting.name}"`);
          setDeleting(null);
        }}
      />
    </>
  );
}

function ReferenceTile({ r, onDelete, extra }: { r: LibraryReference; onDelete: (r: LibraryReference) => void; extra?: ReactNode }) {
  const { lib, patchItem, setBuilder, go, toast, openImage } = useInspire();
  const img = lib.images[r.imageId];
  const [name, setName] = useState(r.name);
  const commitName = () => {
    const n = name.trim();
    if (!n) return setName(r.name);
    if (n !== r.name) void patchItem(r.id, { name: n });
  };
  const use = () => {
    if (!img) return;
    setBuilder((b) => ({
      ...b,
      refs: [...b.refs.filter((x) => x.imageId !== r.imageId), { id: `ref_${r.id}`, imageId: r.imageId, src: img.src, name: r.name, purpose: r.purpose }],
    }));
    toast(`Added "${r.name}" to the Builder as ${purposeLabel(r.purpose).toLowerCase()}`);
    go("builder");
  };
  return (
    <div className="insp-panel lib-ref">
      {img ? (
        <button type="button" className="lib-ref-img" onClick={() => openImage(img)} aria-label={`Open ${r.name}`}>
          <Shot img={img} style={{ width: "100%", height: "100%", display: "block" }} />
        </button>
      ) : (
        <div className="lib-ref-img lib-ref-missing">
          <ImageOff size={20} />
          <span style={{ fontSize: 12 }}>Image unavailable</span>
        </div>
      )}
      <div style={{ padding: 10, display: "grid", gap: 8 }}>
        <input
          className="insp-input lib-ref-name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setName(r.name);
          }}
          aria-label="Reference name"
        />
        <select className="insp-select" value={r.purpose} onChange={(e) => void patchItem(r.id, { purpose: e.target.value })} aria-label="Use this reference for" title={REFERENCE_PURPOSES.find((p) => p.id === r.purpose)?.hint}>
          {REFERENCE_PURPOSES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button type="button" className="insp-btn insp-btn-sm" style={{ flex: 1 }} onClick={use} disabled={!img}>
            <Wand2 size={14} /> Use in Builder
          </button>
          <CollectionMenu item={r}>
            {(open) => (
              <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet insp-btn-icon" onClick={open} aria-label="Collections" title="Collections">
                <FolderPlus size={14} />
              </button>
            )}
          </CollectionMenu>
          {extra}
          <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet insp-btn-icon lib-danger" onClick={() => onDelete(r)} aria-label={`Delete ${r.name}`} title="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ----- confirm ----------------------------------------------------------------

export function Confirm({ open, onClose, title, body, confirmLabel, onConfirm }: { open: boolean; onClose: () => void; title: string; body?: string; confirmLabel: string; onConfirm: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);
  return (
    <Modal open={open} onClose={close} label={title}>
      <div style={{ padding: 24, display: "grid", gap: 12 }}>
        <div className="insp-h2">{title}</div>
        {body && (
          <p className="insp-muted" style={{ margin: 0 }}>
            {body}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
          <button type="button" className="insp-btn insp-btn-quiet lib-tap" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="insp-btn insp-btn-danger lib-tap"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner size={14} /> : <Trash2 size={14} />} {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ----- states -----------------------------------------------------------------

export function GridSkeleton({ rows = 2 }: { rows?: number }) {
  const heights = [220, 300, 180, 260, 240, 200, 320, 190];
  return (
    <div className="insp-masonry" aria-busy="true" aria-label="Loading">
      {[0, 1, 2, 3].map((c) => (
        <div key={c} className="insp-masonry-col" style={c > 1 ? { display: "var(--lib-skel-wide, flex)" } : undefined}>
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} className="insp-skel" style={{ height: heights[(c * rows + r) % heights.length] }} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ----- scoped styles ------------------------------------------------------------

export const LIB_CSS = `
.insp-lib .lib-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 14px 0 10px; }
.insp-lib .lib-controls .insp-search { flex: 1 1 260px; min-width: 0; }
.insp-lib .lib-controls .insp-search .insp-input { height: 40px; font-size: 13.5px; }
.insp-lib .lib-controls .insp-select { width: auto; min-width: 150px; flex: 0 1 auto; }
.insp-lib .lib-subbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.insp-lib .insp-tabs { overflow-x: auto; max-width: 100%; scrollbar-width: none; }
.insp-lib .insp-tabs::-webkit-scrollbar { display: none; }
.insp-lib .insp-tab { white-space: nowrap; }

.insp-lib .lib-card { cursor: default; }
.insp-lib .lib-card-hit { position: absolute; inset: 0; width: 100%; height: 100%; cursor: zoom-in; border-radius: inherit; }
.insp-lib .lib-card-hit:focus-visible { outline-offset: -3px; }
.insp-lib .lib-card-hit:focus-visible .insp-card-veil, .insp-lib .lib-card-hit:focus-visible .insp-card-info { opacity: 1; transform: none; }
.insp-lib .lib-card-badges { position: absolute; top: 9px; left: 9px; z-index: 3; display: flex; gap: 4px; flex-wrap: wrap; pointer-events: none; }
.insp-lib .lib-card-tools { display: flex; gap: 4px; }
.insp-lib .lib-onimg { background: rgba(8, 8, 10, 0.62); border-color: rgba(255, 255, 255, 0.16); color: var(--ink); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.insp-lib .lib-onimg:hover { background: rgba(8, 8, 10, 0.85); }

.insp-lib .lib-rows { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.insp-lib .lib-row { display: grid; grid-template-columns: 60px minmax(0, 1fr) auto; gap: 14px; align-items: start; padding: 14px 6px; border-bottom: 1px solid var(--line); transition: background 0.2s; }
.insp-lib .lib-row:hover { background: rgba(255, 255, 255, 0.015); }
.insp-lib .lib-row-thumb { width: 60px; height: 60px; }
.insp-lib .lib-thumb-btn { width: 100%; height: 100%; border-radius: 10px; overflow: hidden; display: block; cursor: zoom-in; }
.insp-lib .lib-thumb-empty { width: 100%; height: 100%; display: grid; place-items: center; border-radius: 10px; border: 1px dashed var(--line-2); color: var(--ink-3); }
.insp-lib .lib-row-actions { display: flex; gap: 2px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.insp-lib .lib-prompt { margin: 6px 0 0; color: var(--ink-2); font-size: 13.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.insp-lib .lib-prompt[data-open="true"] { display: block; -webkit-line-clamp: unset; }
.insp-lib .lib-link { display: inline-flex; align-items: center; gap: 4px; min-height: 26px; font-size: 12px; color: var(--ink-3); font-weight: 550; }
.insp-lib .lib-link:hover { color: var(--ink); }
.insp-lib .lib-versions { margin-top: 10px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--line); background: rgba(255, 255, 255, 0.02); }
.insp-lib .lib-version { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; padding: 8px 0; border-top: 1px solid var(--line); }
.insp-lib .lib-version:first-of-type { border-top: 0; }
.insp-lib .lib-danger:hover { color: var(--bad); }

.insp-lib .lib-chipwrap { display: inline-flex; align-items: center; gap: 1px; }
.insp-lib .lib-star { width: 28px; height: 30px; display: grid; place-items: center; border-radius: 8px; color: var(--ink-3); opacity: 0.55; transition: opacity 0.2s, color 0.2s; }
.insp-lib .lib-chipwrap:hover .lib-star, .insp-lib .lib-star:focus-visible { opacity: 1; }
.insp-lib .lib-star[data-on="true"] { color: var(--warn); opacity: 1; }
.insp-lib .lib-dot { width: 7px; height: 7px; border-radius: 999px; background: oklch(0.78 0.16 var(--h)); box-shadow: 0 0 9px oklch(0.78 0.16 var(--h)); }
.insp-lib .lib-selbar { position: sticky; bottom: 16px; z-index: 20; margin-top: 22px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px; border-radius: 18px; background: rgba(18, 19, 24, 0.94); border: 1px solid var(--line-2); backdrop-filter: blur(16px); box-shadow: 0 20px 50px -14px rgba(0, 0, 0, 0.75); }

.insp-lib .lib-refgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.insp-lib .lib-ref { overflow: hidden; }
.insp-lib .lib-ref-img { display: block; width: 100%; aspect-ratio: 4 / 3; overflow: hidden; background: var(--raise); cursor: zoom-in; }
.insp-lib .lib-ref-missing { display: grid; place-items: center; align-content: center; gap: 6px; color: var(--ink-3); cursor: default; }
.insp-lib .lib-ref-name { height: 34px; border-color: transparent; background: transparent; padding: 0 8px; font-weight: 600; }
.insp-lib .lib-ref-name:hover { border-color: var(--line); }
.insp-lib .lib-ref .insp-select { height: 34px; font-size: 12.5px; background-position: calc(100% - 17px) 14px, calc(100% - 12px) 14px; }

@media (max-width: 860px) {
  .insp-lib { --lib-skel-wide: none; }
  .insp-lib .insp-btn-sm, .insp-lib .lib-tap { height: 40px; }
  .insp-lib .insp-btn-sm.insp-btn-icon { width: 40px; }
  .insp-lib .insp-tab { height: 38px; }
  .insp-lib .lib-star { width: 40px; height: 40px; }
  .insp-lib .lib-link { min-height: 36px; }
  .insp-lib .lib-controls .insp-select { flex: 1 1 140px; }
  .insp-lib .lib-row { grid-template-columns: 48px minmax(0, 1fr); gap: 10px; }
  .insp-lib .lib-row-thumb { width: 48px; height: 48px; }
  .insp-lib .lib-row-actions { grid-column: 1 / -1; justify-content: flex-start; }
  .insp-lib .lib-selbar { bottom: 92px; }
  .insp-lib .lib-refgrid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .insp-lib .lib-ref .insp-select, .insp-lib .lib-ref-name { height: 40px; }
  .insp-lib .insp-card-save { opacity: 1; }
}
`;
