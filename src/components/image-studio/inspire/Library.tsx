"use client";

// My Library — the signed-in user's private workspace: images they saved or
// made, prompts, chips and references. Not a profile: nobody else sees it,
// and there are no follower or like counts anywhere on it.

import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { Compass, Image as ImageIcon, ImagePlus, Layers, LibraryBig, Plus, ScanSearch, Search, Shapes, Wand2 } from "lucide-react";
import { CHIP_CATEGORIES, type ChipCategoryId } from "@/lib/image-studio/inspire/taxonomy";
import { REFERENCE_PURPOSES, type LibraryChip, type LibraryPrompt, type LibraryReference, type PromptOrigin, type ReferencePurpose } from "@/lib/image-studio/inspire/types";
import { PublishDialog } from "./PublishDialog";
import { useInspire } from "./store";
import { Empty } from "./ui";
import {
  ChipBoard,
  GridSkeleton,
  ImageGrid,
  LIB_CSS,
  ORIGIN_LABEL,
  PromptList,
  ReferenceGrid,
  SORTS,
  imageEntries,
  matches,
  plural,
  sortList,
  type ImageKind,
  type SortKey,
} from "./library/shared";

type Tab = "images" | "prompts" | "chips" | "references";
const TABS: { id: Tab; label: string }[] = [
  { id: "images", label: "Images" },
  { id: "prompts", label: "Prompts" },
  { id: "chips", label: "Chips" },
  { id: "references", label: "References" },
];

const IMAGE_FILTERS: { id: "all" | ImageKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "saved", label: "Saved from Explore" },
  { id: "uploaded", label: "Uploaded" },
  { id: "generated", label: "Generated" },
];
const ORIGINS = Object.keys(ORIGIN_LABEL) as PromptOrigin[];

export function Library() {
  const { me, lib, go, requireSignIn, removeItem, saveChip, toast } = useInspire();
  const [tab, setTab] = useState<Tab>("images");
  const [q, setQ] = useState("");
  const [col, setCol] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("new");
  const [imgFilter, setImgFilter] = useState<"all" | ImageKind>("all");
  const [origin, setOrigin] = useState<"all" | PromptOrigin>("all");
  const [chipCat, setChipCat] = useState<"all" | "fav" | ChipCategoryId>("all");
  const [purpose, setPurpose] = useState<"all" | ReferencePurpose>("all");
  const [uploading, setUploading] = useState(false);
  const [chipText, setChipText] = useState("");
  const [chipNewCat, setChipNewCat] = useState<ChipCategoryId>("style");
  const closeUpload = useCallback(() => setUploading(false), []);

  // A collection that was deleted elsewhere drops back to "All".
  const colId = col === "all" || col === "none" || lib.collections.some((c) => c.id === col) ? col : "all";
  const inCol = (ids: string[]) => colId === "all" || (colId === "none" ? ids.length === 0 : ids.includes(colId));

  const { entries, missing } = useMemo(() => imageEntries(lib.items, lib.ownImages, lib.images), [lib.items, lib.ownImages, lib.images]);
  const prompts = useMemo(() => lib.items.filter((i): i is LibraryPrompt => i.kind === "prompt"), [lib.items]);
  const chips = useMemo(() => lib.items.filter((i): i is LibraryChip => i.kind === "chip"), [lib.items]);
  const refs = useMemo(() => lib.items.filter((i): i is LibraryReference => i.kind === "reference"), [lib.items]);
  const counts: Record<Tab, number> = { images: entries.length, prompts: prompts.length, chips: chips.length, references: refs.length };

  const shownImages = sortList(
    entries.filter((e) => (imgFilter === "all" || e.kind === imgFilter) && inCol(e.item?.collectionIds ?? []) && matches(q, e.img.title, e.img.prompt, e.img.description, e.img.creator, e.img.style, e.img.chips.map((c) => c.text).join(" "))),
    sort,
    (e) => e.addedAt,
    (e) => e.img.title,
  );
  const shownPrompts = sortList(
    prompts.filter((p) => (origin === "all" || p.origin === origin) && inCol(p.collectionIds) && matches(q, p.title, p.text, p.chips.map((c) => c.text).join(" "), p.imageId ? lib.images[p.imageId]?.creator : "")),
    sort,
    (p) => p.createdAt,
    (p) => p.title,
  );
  const shownChips = sortList(
    chips.filter((c) => (chipCat === "all" || (chipCat === "fav" ? c.favorite : c.chip.category === chipCat)) && inCol(c.collectionIds) && matches(q, c.chip.text, c.chip.why)),
    sort,
    (c) => c.createdAt,
    (c) => c.chip.text,
  );
  const shownRefs = sortList(
    refs.filter((r) => (purpose === "all" || r.purpose === purpose) && inCol(r.collectionIds) && matches(q, r.name, lib.images[r.imageId]?.title)),
    sort,
    (r) => r.createdAt,
    (r) => r.name,
  );

  const filtered = q.trim() !== "" || colId !== "all" || (tab === "images" && imgFilter !== "all") || (tab === "prompts" && origin !== "all") || (tab === "chips" && chipCat !== "all") || (tab === "references" && purpose !== "all");
  const clearFilters = () => {
    setQ("");
    setCol("all");
    setImgFilter("all");
    setOrigin("all");
    setChipCat("all");
    setPurpose("all");
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length].id;
    setTab(next);
    requestAnimationFrame(() => document.getElementById(`lib-tab-${next}`)?.focus());
  };

  const addChip = async () => {
    const text = chipText.trim();
    if (!text) return toast("Type the chip's words first.", { tone: "bad" });
    await saveChip({ text, category: chipNewCat }, { custom: true });
    setChipText("");
  };

  const head = (
    <header className="insp-page-head">
      <div style={{ minWidth: 0 }}>
        <h1 className="insp-h1" style={{ margin: 0 }}>
          My Library
        </h1>
        <p className="insp-muted" style={{ margin: "10px 0 0", maxWidth: 560 }}>
          Everything you keep — images, prompts, chips and references. Only you can see this page.
        </p>
      </div>
      {me && (
        <button type="button" className="insp-btn insp-btn-primary lib-tap" onClick={() => requireSignIn("upload images", () => setUploading(true))}>
          <ImagePlus size={16} /> Upload image
        </button>
      )}
    </header>
  );

  // ----- signed out / loading ---------------------------------------------------
  if (me && !me.signedIn) {
    return (
      <div className="insp-lib">
        <style>{LIB_CSS}</style>
        {head}
        <Empty
          icon={<LibraryBig size={30} strokeWidth={1.5} />}
          title="Your own private library"
          body="Sign in to keep images you love, prompts that worked, chips you reach for and reference pictures — sorted into collections like “T-shirt Ideas”. Nobody else can see it."
          action={
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <button type="button" className="insp-btn insp-btn-primary lib-tap" onClick={() => requireSignIn("open your library", () => {})}>
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

  const loading = !me || !lib.loaded;

  return (
    <div className="insp-lib">
      <style>{LIB_CSS}</style>
      {head}

      <div className="lib-subbar" style={{ marginBottom: 0 }}>
        <div className="insp-tabs" role="tablist" aria-label="Library sections" onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`lib-tab-${t.id}`}
              type="button"
              role="tab"
              className="insp-tab"
              aria-selected={tab === t.id}
              aria-controls="lib-panel"
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              <span className="insp-count">{loading ? "–" : counts[t.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="lib-controls">
        <label className="insp-search">
          <Search size={16} />
          <input
            className="insp-input"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tab === "images" ? "Search titles, prompts, creators…" : tab === "prompts" ? "Search prompt titles and wording…" : tab === "chips" ? "Search chips…" : "Search references…"}
            aria-label={`Search ${tab}`}
          />
        </label>
        <select className="insp-select" value={colId} onChange={(e) => setCol(e.target.value)} aria-label="Collection">
          <option value="all">All collections</option>
          {lib.collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="none">Not in a collection</option>
        </select>
        {tab === "chips" && (
          <select className="insp-select" value={chipCat} onChange={(e) => setChipCat(e.target.value as typeof chipCat)} aria-label="Chip category">
            <option value="all">All categories</option>
            <option value="fav">Favorites</option>
            {CHIP_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        )}
        <select className="insp-select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort" style={{ minWidth: 110 }}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {tab !== "chips" && (
        <div className="insp-pills" role="group" aria-label="Filter" style={{ marginBottom: 18 }}>
          {tab === "images" &&
            IMAGE_FILTERS.map((f) => (
              <button key={f.id} type="button" className="insp-pill" aria-pressed={imgFilter === f.id} onClick={() => setImgFilter(f.id)}>
                {f.label}
              </button>
            ))}
          {tab === "prompts" &&
            (["all", ...ORIGINS] as const).map((o) => (
              <button key={o} type="button" className="insp-pill" aria-pressed={origin === o} onClick={() => setOrigin(o)}>
                {o === "all" ? "All" : ORIGIN_LABEL[o]}
              </button>
            ))}
          {tab === "references" &&
            [{ id: "all" as const, label: "All" }, ...REFERENCE_PURPOSES].map((p) => (
              <button key={p.id} type="button" className="insp-pill" aria-pressed={purpose === p.id} onClick={() => setPurpose(p.id)}>
                {p.label}
              </button>
            ))}
        </div>
      )}

      {tab === "chips" && !loading && (
        <form
          className="insp-panel"
          style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: 10, marginBottom: 20 }}
          onSubmit={(e) => {
            e.preventDefault();
            void addChip();
          }}
        >
          <span className="insp-kicker" style={{ padding: "0 4px" }}>
            Add custom chip
          </span>
          <input className="insp-input" style={{ flex: "1 1 200px", height: 36 }} value={chipText} onChange={(e) => setChipText(e.target.value)} placeholder="e.g. halftone shading" maxLength={60} aria-label="Chip text" />
          <select className="insp-select" style={{ flex: "0 1 180px", height: 36, backgroundPosition: "calc(100% - 17px) 15px, calc(100% - 12px) 15px" }} value={chipNewCat} onChange={(e) => setChipNewCat(e.target.value as ChipCategoryId)} aria-label="Chip category">
            {CHIP_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <button type="submit" className="insp-btn insp-btn-sm" disabled={!chipText.trim()}>
            <Plus size={14} /> Add chip
          </button>
        </form>
      )}

      <div id="lib-panel" role="tabpanel" aria-labelledby={`lib-tab-${tab}`}>
        {loading ? (
          tab === "images" ? (
            <GridSkeleton />
          ) : (
            <div style={{ display: "grid", gap: 10 }} aria-busy="true" aria-label="Loading">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="insp-skel" style={{ height: tab === "chips" ? 34 : 76, width: tab === "chips" ? `${60 - i * 7}%` : "100%" }} />
              ))}
            </div>
          )
        ) : filtered && ((tab === "images" && !shownImages.length) || (tab === "prompts" && !shownPrompts.length) || (tab === "chips" && !shownChips.length) || (tab === "references" && !shownRefs.length)) && counts[tab] > 0 ? (
          <Empty
            icon={<Search size={26} strokeWidth={1.5} />}
            title="Nothing matches"
            body={`None of your ${tab} match these filters.`}
            action={
              <button type="button" className="insp-btn lib-tap" onClick={clearFilters}>
                Clear filters
              </button>
            }
          />
        ) : tab === "images" ? (
          <>
            {missing.length > 0 && (
              <div className="insp-note" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
                <span style={{ flex: 1 }}>{plural(missing.length, "saved image")} {missing.length === 1 ? "is" : "are"} no longer available — the creator removed or unpublished {missing.length === 1 ? "it" : "them"}.</span>
                <button type="button" className="insp-btn insp-btn-sm" onClick={() => missing.forEach((m) => void removeItem(m))}>
                  Clear {missing.length === 1 ? "it" : "them"}
                </button>
              </div>
            )}
            {shownImages.length ? (
              <ImageGrid entries={shownImages} />
            ) : (
              <Empty
                icon={<ImageIcon size={28} strokeWidth={1.5} />}
                title="No images yet"
                body="Save images you like from Explore, upload your own, or generate one in the Prompt Builder."
                action={
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                    <button type="button" className="insp-btn insp-btn-primary lib-tap" onClick={() => go("explore")}>
                      <Compass size={15} /> Browse Explore
                    </button>
                    <button type="button" className="insp-btn lib-tap" onClick={() => setUploading(true)}>
                      <ImagePlus size={15} /> Upload image
                    </button>
                  </div>
                }
              />
            )}
          </>
        ) : tab === "prompts" ? (
          shownPrompts.length ? (
            <PromptList items={shownPrompts} />
          ) : (
            <Empty
              icon={<Wand2 size={28} strokeWidth={1.5} />}
              title="No saved prompts yet"
              body="Prompts you save from an image, the Builder or Reverse Prompt land here, with every earlier wording kept."
              action={
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  <button type="button" className="insp-btn insp-btn-primary lib-tap" onClick={() => go("reverse")}>
                    <ScanSearch size={15} /> Open Reverse Prompt
                  </button>
                  <button type="button" className="insp-btn lib-tap" onClick={() => go("builder")}>
                    <Wand2 size={15} /> Prompt Builder
                  </button>
                </div>
              }
            />
          )
        ) : tab === "chips" ? (
          shownChips.length ? (
            <ChipBoard items={shownChips} />
          ) : (
            <Empty
              icon={<Shapes size={28} strokeWidth={1.5} />}
              title="No saved chips yet"
              body="Save ingredients from any image's Prompt DNA, or add your own above. Star the ones you use most."
              action={
                <button type="button" className="insp-btn insp-btn-primary lib-tap" onClick={() => go("explore")}>
                  <Compass size={15} /> Find chips in Explore
                </button>
              }
            />
          )
        ) : shownRefs.length ? (
          <ReferenceGrid items={shownRefs} />
        ) : (
          <Empty
            icon={<Layers size={28} strokeWidth={1.5} />}
            title="No references yet"
            body="Add reference pictures in the Prompt Builder — a style, a character, a palette — and they're kept here to reuse."
            action={
              <button type="button" className="insp-btn insp-btn-primary lib-tap" onClick={() => go("builder")}>
                <Wand2 size={15} /> Open the Builder
              </button>
            }
          />
        )}
      </div>

      <PublishDialog open={uploading} onClose={closeUpload} image={null} />
    </div>
  );
}
