"use client";

// Moderation — studio owner only (the shell renders it only when me.owner).
// Every image a member has published to Explore, newest first, with the two
// things a moderator needs: take it off Explore, or delete it. No likes, no
// views, no popularity — this is a review queue, not an engagement board.

import { useCallback, useEffect, useMemo, useState } from "react";
import { EyeOff, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { galleryCategoryLabel } from "@/lib/image-studio/inspire/taxonomy";
import type { InspireImage } from "@/lib/image-studio/inspire/types";
import { api } from "./api";
import { useInspire } from "./store";
import { Empty, Shot, Spinner } from "./ui";
import { Confirm, LIB_CSS, fmtDate, matches } from "./library/shared";

interface AdminData {
  images: InspireImage[];
  totals: { published: number; creators: number; thisWeek: number };
}

const byNewest = (a: InspireImage, b: InspireImage) => b.createdAt.localeCompare(a.createdAt);

export function Moderation() {
  const { openImage, toast } = useInspire();
  const [images, setImages] = useState<InspireImage[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<InspireImage | null>(null);
  const closeDelete = useCallback(() => setDeleting(null), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await api.get<AdminData>("/admin");
      setImages([...r.images].sort(byNewest));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the moderation queue.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Counted from the list itself, so an unpublish or delete updates them at once.
  const totals = useMemo(() => {
    const list = images ?? [];
    const week = Date.now() - 7 * 86_400_000;
    return {
      published: list.length,
      creators: new Set(list.map((i) => i.ownerId ?? i.creator)).size,
      thisWeek: list.filter((i) => Date.parse(i.createdAt) > week).length,
    };
  }, [images]);

  const shown = useMemo(
    () => (images ?? []).filter((i) => matches(q, i.title, i.creator, i.prompt, i.description, galleryCategoryLabel(i.category), i.style)),
    [images, q],
  );

  const act = async (img: InspireImage, action: "unpublish" | "delete") => {
    setPending((p) => new Set(p).add(img.id));
    setImages((list) => list?.filter((i) => i.id !== img.id) ?? list);
    try {
      await api.post("/admin", { id: img.id, action });
      toast(action === "delete" ? `Deleted "${img.title}"` : `Unpublished "${img.title}" — it's private to @${img.creator} now`);
    } catch (err) {
      setImages((list) => (list && !list.some((i) => i.id === img.id) ? [...list, img].sort(byNewest) : list));
      toast(err instanceof Error ? err.message : `Couldn't ${action} that image.`, { tone: "bad" });
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(img.id);
        return n;
      });
    }
  };

  return (
    <div className="insp-lib insp-mod">
      <style>{LIB_CSS}</style>
      <style>{MOD_CSS}</style>
      <header className="insp-page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="insp-h1" style={{ margin: 0 }}>
            Moderation
          </h1>
          <p className="insp-muted" style={{ margin: "10px 0 0", maxWidth: 560 }}>
            Everything members have published to Explore. Unpublish sends an image back to its creator&apos;s private library; delete removes it for good.
          </p>
        </div>
        <button type="button" className="insp-btn insp-btn-quiet lib-tap" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner size={14} /> : <RefreshCw size={14} />} Refresh
        </button>
      </header>

      <div className="mod-stats">
        {[
          { label: "Published by members", value: totals.published },
          { label: "Creators", value: totals.creators },
          { label: "Published this week", value: totals.thisWeek },
        ].map((s) => (
          <div key={s.label} className="insp-panel mod-stat">
            <div className="insp-kicker">{s.label}</div>
            <div className="mod-stat-n">{images ? s.value.toLocaleString() : <span className="insp-skel" style={{ display: "block", width: 48, height: 30 }} />}</div>
          </div>
        ))}
      </div>

      <div className="lib-controls">
        <label className="insp-search">
          <Search size={16} />
          <input className="insp-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, creator, prompt or category…" aria-label="Search published images" />
        </label>
        {images && q.trim() && (
          <span className="insp-faint insp-mono" style={{ fontSize: 11.5 }}>
            {shown.length} of {images.length}
          </span>
        )}
      </div>

      {error && images && (
        <div className="insp-error" style={{ marginBottom: 12 }}>
          Couldn&apos;t refresh: {error} Showing the list from before.
        </div>
      )}
      {error && !images ? (
        <div className="insp-error" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="insp-btn insp-btn-sm" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : !images ? (
        <div style={{ display: "grid", gap: 8 }} aria-busy="true" aria-label="Loading">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="insp-skel" style={{ height: 64 }} />
          ))}
        </div>
      ) : images.length === 0 ? (
        <Empty icon={<ShieldCheck size={28} strokeWidth={1.5} />} title="Nothing published by members yet — the starter set is curated in code." body="When a member publishes an image to Explore, it shows up here first." />
      ) : shown.length === 0 ? (
        <Empty
          icon={<Search size={26} strokeWidth={1.5} />}
          title="Nothing matches"
          body={`No published image matches "${q.trim()}".`}
          action={
            <button type="button" className="insp-btn lib-tap" onClick={() => setQ("")}>
              Clear search
            </button>
          }
        />
      ) : (
        <div className="mod-table" role="table" aria-label="Published images">
          <div className="mod-row mod-head" role="row">
            <span role="columnheader" className="mod-c-thumb">
              <span className="sr-only">Image</span>
            </span>
            <span role="columnheader">Title & prompt</span>
            <span role="columnheader" className="mod-c-meta">
              Creator
            </span>
            <span role="columnheader" className="mod-c-meta">
              Category
            </span>
            <span role="columnheader" className="mod-c-meta">
              Added
            </span>
            <span role="columnheader" className="mod-c-actions">
              <span className="sr-only">Actions</span>
            </span>
          </div>
          {shown.map((img) => {
            const busy = pending.has(img.id);
            return (
              <div key={img.id} className="mod-row" role="row" aria-busy={busy}>
                <span role="cell" className="mod-c-thumb">
                  <button type="button" className="mod-thumb" onClick={() => openImage(img)} aria-label={`Open ${img.title}`}>
                    <Shot img={img} style={{ width: "100%", height: "100%", display: "block" }} alt="" />
                  </button>
                </span>
                <span role="cell" style={{ minWidth: 0 }}>
                  <button type="button" className="mod-title" onClick={() => openImage(img)}>
                    {img.title}
                  </button>
                  <span className="mod-prompt" title={img.prompt}>
                    {img.prompt || "No prompt"}
                  </span>
                  <span className="mod-meta-inline insp-faint insp-mono">
                    @{img.creator} · {galleryCategoryLabel(img.category)} · {fmtDate(img.createdAt)}
                  </span>
                </span>
                <span role="cell" className="mod-c-meta insp-mono mod-cut">
                  @{img.creator}
                </span>
                <span role="cell" className="mod-c-meta mod-cut">
                  {galleryCategoryLabel(img.category)}
                </span>
                <span role="cell" className="mod-c-meta insp-mono">
                  {fmtDate(img.createdAt)}
                </span>
                <span role="cell" className="mod-c-actions">
                  <button type="button" className="insp-btn insp-btn-sm" onClick={() => void act(img, "unpublish")} disabled={busy}>
                    <EyeOff size={14} /> Unpublish
                  </button>
                  <button type="button" className="insp-btn insp-btn-sm insp-btn-danger" onClick={() => setDeleting(img)} disabled={busy}>
                    <Trash2 size={14} /> Delete
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <Confirm
        open={!!deleting}
        onClose={closeDelete}
        title="Delete permanently? This can't be undone."
        body={deleting ? `"${deleting.title}" by @${deleting.creator} is removed from Explore, from the creator's library and from everyone's saved images. To only take it off Explore, unpublish it instead.` : undefined}
        confirmLabel="Delete image"
        onConfirm={async () => {
          const img = deleting;
          setDeleting(null);
          if (img) await act(img, "delete");
        }}
      />
    </div>
  );
}

const MOD_CSS = `
.insp-mod .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.insp-mod .mod-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 8px; }
.insp-mod .mod-stat { padding: 14px 16px; display: grid; gap: 6px; }
.insp-mod .mod-stat-n { font-family: var(--display); font-weight: 700; font-size: 30px; letter-spacing: -0.02em; line-height: 1; font-variant-numeric: tabular-nums; }
.insp-mod .mod-table { border-top: 1px solid var(--line); }
.insp-mod .mod-row { display: grid; grid-template-columns: 52px minmax(0, 2.6fr) minmax(0, 0.9fr) minmax(0, 0.9fr) 84px auto; gap: 14px; align-items: center; padding: 9px 6px; border-bottom: 1px solid var(--line); transition: background 0.2s, opacity 0.2s; }
.insp-mod .mod-row:not(.mod-head):hover { background: rgba(255, 255, 255, 0.02); }
.insp-mod .mod-row[aria-busy="true"] { opacity: 0.5; }
.insp-mod .mod-head { padding-top: 8px; padding-bottom: 8px; font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-3); }
.insp-mod .mod-thumb { display: block; width: 52px; height: 52px; border-radius: 10px; overflow: hidden; background: var(--raise); cursor: zoom-in; }
.insp-mod .mod-title { display: block; max-width: 100%; font-weight: 600; font-size: 13.5px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.insp-mod .mod-title:hover { text-decoration: underline; text-underline-offset: 3px; }
.insp-mod .mod-prompt { display: block; font-size: 12.5px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
.insp-mod .mod-c-meta { font-size: 12.5px; color: var(--ink-2); }
.insp-mod .mod-c-meta.insp-mono { font-size: 11.5px; }
.insp-mod .mod-cut { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.insp-mod .mod-c-actions { display: flex; gap: 6px; justify-content: flex-end; }
.insp-mod .mod-meta-inline { display: none; font-size: 11px; margin-top: 4px; }
@media (max-width: 860px) {
  .insp-mod .mod-stats { gap: 6px; }
  .insp-mod .mod-stat { padding: 10px 12px; }
  .insp-mod .mod-stat-n { font-size: 24px; }
  .insp-mod .mod-head { display: none; }
  .insp-mod .mod-row { grid-template-columns: 52px minmax(0, 1fr); gap: 4px 12px; padding: 12px 2px; align-items: start; }
  .insp-mod .mod-c-meta { display: none; }
  .insp-mod .mod-meta-inline { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .insp-mod .mod-c-actions { grid-column: 1 / -1; justify-content: flex-start; margin-top: 6px; }
}
`;
