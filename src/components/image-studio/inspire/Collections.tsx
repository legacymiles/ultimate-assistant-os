"use client";

// Collections — named folders over the private library ("T-shirt Ideas",
// "Logo Inspiration"). A folder only groups things: deleting one never
// deletes what is in it. Items can sit in several collections at once.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Compass, FolderMinus, FolderOpen, FolderPlus, Image as ImageIcon, Layers, Library as LibraryIcon, Pencil, Plus, Shapes, Trash2, Wand2, X } from "lucide-react";
import { hueOf } from "@/lib/image-studio/inspire/taxonomy";
import type { Collection, InspireImage, LibraryChip, LibraryImage, LibraryItem, LibraryPrompt, LibraryReference } from "@/lib/image-studio/inspire/types";
import { api } from "./api";
import { useInspire } from "./store";
import { Empty, Shot, Spinner } from "./ui";
import { ChipBoard, Confirm, ImageGrid, LIB_CSS, PromptList, ReferenceGrid, entriesForItems, plural } from "./library/shared";

interface Contents {
  images: LibraryImage[];
  prompts: LibraryPrompt[];
  chips: LibraryChip[];
  refs: LibraryReference[];
}

function contentsOf(items: LibraryItem[], id: string): Contents {
  const out: Contents = { images: [], prompts: [], chips: [], refs: [] };
  for (const i of items) {
    if (!i.collectionIds.includes(id)) continue;
    if (i.kind === "image") out.images.push(i);
    else if (i.kind === "prompt") out.prompts.push(i);
    else if (i.kind === "chip") out.chips.push(i);
    else out.refs.push(i);
  }
  return out;
}

function countLine(c: Contents): string {
  const parts = [
    c.images.length && plural(c.images.length, "image"),
    c.prompts.length && plural(c.prompts.length, "prompt"),
    c.chips.length && plural(c.chips.length, "chip"),
    c.refs.length && plural(c.refs.length, "reference"),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Empty";
}

function setUrlCollection(id: string | null) {
  try {
    const u = new URL(window.location.href);
    if (id) u.searchParams.set("c", id);
    else u.searchParams.delete("c");
    window.history.replaceState(null, "", u.pathname + u.search);
  } catch {
    /* the URL is a nicety; the view still works */
  }
}

export function Collections() {
  const { me, lib, go, requireSignIn, createCollection, toast } = useInspire();
  const params = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(() => params.get("c"));
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const open = useCallback((id: string | null) => {
    setOpenId(id);
    setUrlCollection(id);
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, []);

  const current = openId ? lib.collections.find((c) => c.id === openId) : undefined;
  // A link to a collection that no longer exists falls back to the grid.
  useEffect(() => {
    if (openId && lib.loaded && !current) setUrlCollection(null);
  }, [openId, lib.loaded, current]);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    setCreating(true);
    const c = await createCollection(n);
    setCreating(false);
    if (c) {
      setName("");
      setAdding(false);
      toast(`Created "${c.name}"`);
    }
  };

  if (me && !me.signedIn) {
    return (
      <div className="insp-lib">
        <style>{LIB_CSS}</style>
        <Head />
        <Empty
          icon={<FolderOpen size={30} strokeWidth={1.5} />}
          title="Sort your finds into collections"
          body="Make folders like “T-shirt Ideas” or “Logo Inspiration” and drop images, prompts, chips and references into them. Private to you."
          action={
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <button type="button" className="insp-btn insp-btn-primary lib-tap" onClick={() => requireSignIn("make collections", () => {})}>
                Sign in
              </button>
              <button type="button" className="insp-btn lib-tap" onClick={() => go("explore")}>
                <Compass size={15} /> Browse Explore
              </button>
            </div>
          }
        />
      </div>
    );
  }

  if (current) {
    return (
      <div className="insp-lib">
        <style>{LIB_CSS}</style>
        <Detail collection={current} onBack={() => open(null)} />
      </div>
    );
  }

  const loading = !me || !lib.loaded;

  return (
    <div className="insp-lib">
      <style>{LIB_CSS}</style>
      <Head>
        {adding ? (
          <form
            style={{ display: "flex", gap: 6, flexWrap: "wrap", width: "min(420px, 100%)" }}
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input
              autoFocus
              className="insp-input"
              style={{ flex: "1 1 200px" }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setAdding(false);
              }}
              placeholder="T-shirt Ideas"
              maxLength={60}
              aria-label="New collection name"
            />
            <button type="submit" className="insp-btn insp-btn-primary lib-tap" style={{ height: 40 }} disabled={!name.trim() || creating}>
              {creating ? <Spinner size={14} /> : <Check size={15} />} Create
            </button>
            <button type="button" className="insp-btn insp-btn-quiet insp-btn-icon lib-tap" style={{ height: 40, width: 40 }} onClick={() => setAdding(false)} aria-label="Cancel">
              <X size={16} />
            </button>
          </form>
        ) : (
          <button type="button" className="insp-btn insp-btn-primary lib-tap" onClick={() => requireSignIn("make collections", () => setAdding(true))}>
            <Plus size={16} /> New collection
          </button>
        )}
      </Head>

      {loading ? (
        <div className="col-grid" aria-busy="true" aria-label="Loading">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <div className="insp-skel" style={{ aspectRatio: "1 / 1" }} />
              <div className="insp-skel" style={{ height: 14, width: "60%", marginTop: 12 }} />
              <div className="insp-skel" style={{ height: 10, width: "40%", marginTop: 8 }} />
            </div>
          ))}
        </div>
      ) : lib.collections.length === 0 ? (
        <Empty
          icon={<FolderPlus size={30} strokeWidth={1.5} />}
          title="No collections yet"
          body="Make one for each project — “T-shirt Ideas”, “Logo Inspiration”, “Client: Northwind”. Then use the folder button on any image, prompt or chip to file it."
          action={
            <button type="button" className="insp-btn insp-btn-primary lib-tap" onClick={() => setAdding(true)}>
              <Plus size={15} /> New collection
            </button>
          }
        />
      ) : (
        <div className="col-grid">
          {lib.collections.map((c) => (
            <Tile key={c.id} collection={c} onOpen={() => open(c.id)} />
          ))}
        </div>
      )}
      <style>{COL_CSS}</style>
    </div>
  );
}

function Head({ children }: { children?: ReactNode }) {
  return (
    <header className="insp-page-head">
      <div style={{ minWidth: 0 }}>
        <h1 className="insp-h1" style={{ margin: 0 }}>
          Collections
        </h1>
        <p className="insp-muted" style={{ margin: "10px 0 0", maxWidth: 560 }}>
          Folders for your library. One item can live in several; deleting a folder keeps everything in it.
        </p>
      </div>
      {children}
    </header>
  );
}

function Tile({ collection, onOpen }: { collection: Collection; onOpen: () => void }) {
  const { lib } = useInspire();
  const c = useMemo(() => contentsOf(lib.items, collection.id), [lib.items, collection.id]);

  const cells = useMemo(() => {
    const imgs: InspireImage[] = [];
    const seen = new Set<string>();
    const push = (id?: string) => {
      const img = id ? lib.images[id] : undefined;
      if (img && !seen.has(img.id) && imgs.length < 4) {
        seen.add(img.id);
        imgs.push(img);
      }
    };
    c.images.forEach((i) => push(i.imageId));
    c.refs.forEach((i) => push(i.imageId));
    c.prompts.forEach((i) => push(i.imageId));
    const out: ({ kind: "img"; img: InspireImage } | { kind: "chip"; chip: LibraryChip } | { kind: "text"; text: string } | { kind: "blank" })[] = imgs.map((img) => ({ kind: "img", img }));
    for (const ch of c.chips) if (out.length < 4) out.push({ kind: "chip", chip: ch });
    for (const p of c.prompts) if (out.length < 4) out.push({ kind: "text", text: p.text });
    while (out.length < 4) out.push({ kind: "blank" });
    return out;
  }, [c, lib.images]);

  return (
    <button type="button" className="col-tile" onClick={onOpen} aria-label={`Open ${collection.name} — ${countLine(c)}`}>
      <span className="col-cover">
        {cells.map((cell, i) =>
          cell.kind === "img" ? (
            <Shot key={i} img={cell.img} style={{ width: "100%", height: "100%", display: "block" }} alt="" />
          ) : cell.kind === "chip" ? (
            <span key={i} className="col-swatch" style={{ ["--h" as string]: String(hueOf(cell.chip.chip.category)) }}>
              <span>{cell.chip.chip.text}</span>
            </span>
          ) : cell.kind === "text" ? (
            <span key={i} className="col-text">
              {cell.text}
            </span>
          ) : (
            <span key={i} className="col-blank" />
          ),
        )}
      </span>
      <span className="col-name">{collection.name}</span>
      <span className="insp-faint insp-mono" style={{ fontSize: 11 }}>
        {countLine(c)}
      </span>
    </button>
  );
}

function Detail({ collection, onBack }: { collection: Collection; onBack: () => void }) {
  const { lib, go, reloadLibrary, setItemCollections, toast } = useInspire();
  const c = useMemo(() => contentsOf(lib.items, collection.id), [lib.items, collection.id]);
  const images = useMemo(() => entriesForItems(c.images, lib.ownImages, lib.images), [c.images, lib.ownImages, lib.images]);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(collection.name);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const closeDelete = useCallback(() => setDeleting(false), []);
  const total = c.images.length + c.prompts.length + c.chips.length + c.refs.length;

  const rename = async () => {
    const n = name.trim();
    if (!n || n === collection.name) return setRenaming(false);
    setSaving(true);
    try {
      await api.patch("/collections", { id: collection.id, name: n });
      await reloadLibrary();
      setRenaming(false);
      toast(`Renamed to "${n}"`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't rename it.", { tone: "bad" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.del(`/collections?id=${encodeURIComponent(collection.id)}`);
      setDeleting(false);
      onBack();
      await reloadLibrary();
      toast(`Deleted "${collection.name}" — everything in it is still in your library`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't delete it.", { tone: "bad" });
    }
  };

  const takeOut = (item: LibraryItem) => {
    void setItemCollections(
      item,
      item.collectionIds.filter((x) => x !== collection.id),
    );
    toast(`Removed from ${collection.name}`, { action: { label: "Undo", run: () => void setItemCollections(item, [...new Set([...item.collectionIds, collection.id])]) } });
  };
  const takeOutButton = (item: LibraryItem) => (
    <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet insp-btn-icon" onClick={() => takeOut(item)} aria-label={`Remove from ${collection.name}`} title={`Remove from ${collection.name}`}>
      <FolderMinus size={14} />
    </button>
  );

  return (
    <>
      <div style={{ paddingTop: 24 }}>
        <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet" onClick={onBack}>
          <ArrowLeft size={14} /> All collections
        </button>
      </div>
      <header className="insp-page-head" style={{ paddingTop: 14 }}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          {renaming ? (
            <form
              style={{ display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 520 }}
              onSubmit={(e) => {
                e.preventDefault();
                void rename();
              }}
            >
              <input
                autoFocus
                className="insp-input"
                style={{ flex: "1 1 220px", height: 46, fontSize: 18, fontWeight: 600 }}
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setRenaming(false);
                }}
                aria-label="Collection name"
              />
              <button type="submit" className="insp-btn insp-btn-primary lib-tap" style={{ height: 46 }} disabled={saving || !name.trim()}>
                {saving ? <Spinner size={14} /> : <Check size={15} />} Save
              </button>
              <button type="button" className="insp-btn insp-btn-quiet lib-tap" style={{ height: 46 }} onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <h1 className="insp-h1" style={{ margin: 0, overflowWrap: "anywhere" }}>
              {collection.name}
            </h1>
          )}
          <p className="insp-faint insp-mono" style={{ margin: "10px 0 0", fontSize: 12 }}>
            {countLine(c)}
          </p>
        </div>
        {!renaming && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              className="insp-btn lib-tap"
              onClick={() => {
                setName(collection.name);
                setRenaming(true);
              }}
            >
              <Pencil size={14} /> Rename
            </button>
            <button type="button" className="insp-btn insp-btn-danger lib-tap" onClick={() => setDeleting(true)}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        )}
      </header>

      {total === 0 ? (
        <Empty
          icon={<FolderOpen size={30} strokeWidth={1.5} />}
          title="This collection is empty"
          body="Use the folder button on any image, prompt, chip or reference to file it here — in Explore, in your Library, or right under an image."
          action={
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <button type="button" className="insp-btn insp-btn-primary lib-tap" onClick={() => go("explore")}>
                <Compass size={15} /> Browse Explore
              </button>
              <button type="button" className="insp-btn lib-tap" onClick={() => go("library")}>
                <LibraryIcon size={15} /> Open My Library
              </button>
            </div>
          }
        />
      ) : (
        <div style={{ display: "grid", gap: 40 }}>
          {c.images.length > 0 && (
            <Section icon={<ImageIcon size={15} />} title="Images" count={c.images.length}>
              {images.length < c.images.length && (
                <div className="insp-note" style={{ marginBottom: 12 }}>
                  {plural(c.images.length - images.length, "saved image")} in here {c.images.length - images.length === 1 ? "is" : "are"} no longer available.
                </div>
              )}
              <ImageGrid
                entries={images}
                extraMenu={(e, close) =>
                  e.item ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="insp-menu-item"
                      onClick={() => {
                        close();
                        if (e.item) takeOut(e.item);
                      }}
                    >
                      <FolderMinus size={15} /> Remove from {collection.name}
                    </button>
                  ) : null
                }
              />
            </Section>
          )}
          {c.prompts.length > 0 && (
            <Section icon={<Wand2 size={15} />} title="Prompts" count={c.prompts.length}>
              <PromptList items={[...c.prompts].sort((a, b) => b.createdAt.localeCompare(a.createdAt))} extra={takeOutButton} />
            </Section>
          )}
          {c.chips.length > 0 && (
            <Section icon={<Shapes size={15} />} title="Chips" count={c.chips.length}>
              <ChipBoard
                items={c.chips}
                barExtra={(selected, clear) => (
                  <button
                    type="button"
                    className="insp-btn insp-btn-sm"
                    onClick={() => {
                      for (const ch of selected) void setItemCollections(ch, ch.collectionIds.filter((x) => x !== collection.id));
                      toast(`Removed ${plural(selected.length, "chip")} from ${collection.name}`);
                      clear();
                    }}
                  >
                    <FolderMinus size={14} /> Remove from collection
                  </button>
                )}
              />
            </Section>
          )}
          {c.refs.length > 0 && (
            <Section icon={<Layers size={15} />} title="References" count={c.refs.length}>
              <ReferenceGrid items={c.refs} extra={takeOutButton} />
            </Section>
          )}
        </div>
      )}

      <Confirm
        open={deleting}
        onClose={closeDelete}
        title={`Delete "${collection.name}"?`}
        body={`The folder goes away. ${total ? `The ${plural(total, "item")} in it stay in your library and in any other collections.` : "It's empty, so nothing else changes."}`}
        confirmLabel="Delete collection"
        onConfirm={remove}
      />
      <style>{COL_CSS}</style>
    </>
  );
}

function Section({ icon, title, count, children }: { icon: ReactNode; title: string; count: number; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, color: "var(--ink-2)" }}>
        {icon}
        <h2 className="insp-h2" style={{ margin: 0, fontSize: 18, color: "var(--ink)" }}>
          {title}
        </h2>
        <span className="insp-count">{count}</span>
      </div>
      {children}
    </section>
  );
}

const COL_CSS = `
.insp-lib .col-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 22px 16px; }
.insp-lib .col-tile { display: flex; flex-direction: column; gap: 4px; text-align: left; border-radius: 18px; padding: 0 0 6px; }
.insp-lib .col-cover { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 3px; aspect-ratio: 1 / 1; border-radius: 16px; overflow: hidden; background: var(--line); border: 1px solid var(--line); margin-bottom: 8px; transition: border-color 0.25s, transform 0.35s var(--ease), box-shadow 0.35s; }
.insp-lib .col-tile:hover .col-cover, .insp-lib .col-tile:focus-visible .col-cover { border-color: var(--line-2); transform: translateY(-2px); box-shadow: 0 18px 40px -20px rgba(0, 0, 0, 0.9); }
.insp-lib .col-cover > * { min-width: 0; min-height: 0; overflow: hidden; }
.insp-lib .col-cover img { object-fit: cover; }
.insp-lib .col-swatch { display: grid; place-items: end start; padding: 8px; background: radial-gradient(120% 90% at 20% 10%, oklch(0.7 0.15 var(--h) / 0.55), oklch(0.3 0.08 var(--h) / 0.5) 70%), var(--raise); }
.insp-lib .col-swatch span { font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.08em; text-transform: uppercase; color: oklch(0.94 0.05 var(--h)); line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.insp-lib .col-text { padding: 9px; font-size: 10.5px; line-height: 1.45; color: var(--ink-3); background: var(--raise); display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; }
.insp-lib .col-blank { background: var(--raise); }
.insp-lib .col-name { font-weight: 600; font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 860px) { .insp-lib .col-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 10px; } }
`;
