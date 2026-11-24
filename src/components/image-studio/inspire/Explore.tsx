"use client";

// Explore: the "Immersive lab". The first screen is the Prompt Scan hero; the
// gallery rises over it as a sheet. Images lead; the only extra signal on a
// card is its DNA ribbon, and hovering a card scans the picture away to the
// prompt underneath it (one WebGL context, on the hovered card only).

import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, BookmarkCheck, Search, X } from "lucide-react";
import { searchGallery } from "@/lib/image-studio/inspire/discover";
import { ART_STYLES, GALLERY_CATEGORIES, SUBJECTS } from "@/lib/image-studio/inspire/taxonomy";
import type { InspireImage } from "@/lib/image-studio/inspire/types";
import { api } from "./api";
import { Hero } from "./Hero";
import { DnaRibbon } from "./PromptDNA";
import { PromptScan } from "./PromptScan";
import { PublishDialog } from "./PublishDialog";
import { useInspire } from "./store";
import { Empty, layoutMasonry, Shot, useColumns } from "./ui";

export function ImageCard({ img, onOpen }: { img: InspireImage; onOpen: () => void }) {
  const { savedImageIds, saveImage } = useInspire();
  const saved = savedImageIds.has(img.id);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [scan, setScan] = useState(false);
  const wait = useRef(0);
  const enter = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !img.prompt) return;
    if (!window.matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)").matches) return;
    // A short wait, so sweeping the mouse across the grid doesn't spin up a context per card.
    wait.current = window.setTimeout(() => setScan(true), 110);
  };
  const leave = () => {
    window.clearTimeout(wait.current);
    setScan(false);
  };
  useEffect(() => () => window.clearTimeout(wait.current), []);
  return (
    <div ref={setEl} className="insp-card" style={{ aspectRatio: `${img.width} / ${img.height}` }} onPointerEnter={enter} onPointerLeave={leave}>
      <button type="button" onClick={onOpen} aria-label={`${img.title} by ${img.creator}`} style={{ position: "absolute", inset: 0, display: "block", width: "100%", height: "100%" }}>
        {/* The average colour, so a card is never a dark hole while it loads. */}
        <span aria-hidden style={{ position: "absolute", inset: 0, background: img.tint || "var(--raise)" }} />
        <Shot img={img} style={{ position: "relative", width: "100%", height: "100%" }} />
        {scan && <PromptScan mode="card" image={{ src: img.thumb, width: img.width, height: img.height }} prompt={img.prompt} host={el} />}
        <span className="insp-card-veil" />
        <span className="insp-card-info">
          <span style={{ display: "block", fontWeight: 600, fontSize: 13.5, color: "#fff", lineHeight: 1.25 }}>{img.title}</span>
          <span className="insp-mono" style={{ display: "block", fontSize: 10.5, color: "rgba(255,255,255,.65)", marginTop: 2 }}>
            @{img.creator}
          </span>
        </span>
        <span className="insp-card-ribbon">
          <DnaRibbon chips={img.chips} />
        </span>
      </button>
      <button
        type="button"
        className="insp-card-save insp-btn insp-btn-sm insp-btn-icon"
        style={{ background: saved ? "var(--ink)" : "rgba(10,10,12,.55)", color: saved ? "#0a0a0c" : "#fff", borderColor: "rgba(255,255,255,.2)", backdropFilter: "blur(8px)" }}
        aria-label={saved ? "Saved to your library" : "Save to your library"}
        aria-pressed={saved}
        onClick={() => void saveImage(img)}
      >
        {saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
      </button>
    </div>
  );
}

export function Masonry({ images, onOpen }: { images: InspireImage[]; onOpen: (img: InspireImage) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cols = useColumns(ref);
  const columns = useMemo(() => layoutMasonry(images, cols), [images, cols]);
  return (
    <div ref={ref} className="insp-masonry">
      {columns.map((col, i) => (
        <div key={i} className="insp-masonry-col">
          {col.map((img) => (
            <ImageCard key={img.id} img={img} onOpen={() => onOpen(img)} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Explore() {
  const { openImage, lib, requireSignIn } = useInspire();
  const [all, setAll] = useState<InspireImage[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [style, setStyle] = useState("all");
  const [subject, setSubject] = useState("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [publishing, setPublishing] = useState(false);
  const publicOwn = lib.ownImages.filter((i) => i.visibility === "public").map((i) => i.id).join(",");

  useEffect(() => {
    let live = true;
    api
      .get<{ images: InspireImage[] }>("/images?scope=public")
      .then((r) => live && (setAll(r.images), setError("")))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [publicOwn]);

  const images = useMemo(() => (all ? searchGallery(all, { q, category, style, subject, sort }) : []), [all, q, category, style, subject, sort]);
  const filtered = q || category !== "all" || style !== "all" || subject !== "all";
  const clear = () => {
    setQ("");
    setCategory("all");
    setStyle("all");
    setSubject("all");
  };

  return (
    <div>
      <Hero images={all} onShare={() => requireSignIn("share your images", () => setPublishing(true))} />

      <section className="insp-sheet" aria-label="Inspiration library">
      <div className="insp-sheet-grab" aria-hidden />
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "4px 0 2px" }}>
        <h2 className="insp-h2" style={{ margin: 0 }}>
          The library{all ? <span className="insp-faint insp-mono" style={{ fontSize: 12, marginLeft: 10, letterSpacing: ".04em" }}>{all.length} images</span> : null}
        </h2>
        <span className="insp-faint insp-hover-only" style={{ fontSize: 12.5 }}>Hover any picture to scan it back into its prompt.</span>
      </div>
      <div style={{ position: "sticky", top: 0, zIndex: 20, margin: "0 -4px", padding: "10px 4px 12px", }} className="insp-explore-bar">
        <div className="insp-explore-filters">
          <label className="insp-search" style={{ flex: "1 1 320px" }}>
            <Search size={17} />
            <input className="insp-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search subjects, styles, creators or words in prompts" aria-label="Search images" type="search" />
          </label>
          <select className="insp-select" style={{ width: "auto", minWidth: 140, borderRadius: 999 }} value={style} onChange={(e) => setStyle(e.target.value)} aria-label="Art style">
            <option value="all">Any style</option>
            {ART_STYLES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select className="insp-select" style={{ width: "auto", minWidth: 130, borderRadius: 999 }} value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject">
            <option value="all">Any subject</option>
            {SUBJECTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select className="insp-select" style={{ width: "auto", minWidth: 120, borderRadius: 999 }} value={sort} onChange={(e) => setSort(e.target.value as "newest" | "oldest")} aria-label="Sort">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </div>
        <div className="insp-pills" style={{ marginTop: 10 }} role="group" aria-label="Category">
          <button type="button" className="insp-pill" aria-pressed={category === "all"} onClick={() => setCategory("all")}>
            All
          </button>
          {GALLERY_CATEGORIES.map((c) => (
            <button key={c.id} type="button" className="insp-pill" aria-pressed={category === c.id} onClick={() => setCategory(category === c.id ? "all" : c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="insp-error" style={{ marginBottom: 14 }}>{error}</div>}

      <div>
      {!all && !error ? (
        <div className="insp-masonry" aria-busy="true" aria-label="Loading images">
          {[0, 1, 2, 3].map((c) => (
            <div key={c} className="insp-masonry-col" data-skel-col={c}>
              {[1.3, 0.8, 1.1].map((h, i) => (
                <div key={i} className="insp-skel" style={{ aspectRatio: `1 / ${h + ((c + i) % 3) * 0.15}` }} />
              ))}
            </div>
          ))}
        </div>
      ) : images.length ? (
        <>
          {filtered && (
            <div className="insp-faint" style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 12px", fontSize: 12.5 }}>
              {images.length} match{images.length === 1 ? "" : "es"}
              <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet" onClick={clear}>
                <X size={12} /> Clear filters
              </button>
            </div>
          )}
          <Masonry images={images} onOpen={openImage} />
        </>
      ) : (
        all && (
          <Empty
            icon={<Search size={26} />}
            title="Nothing matches that yet"
            body="Try a broader word — searches cover titles, creators, styles and every word inside the prompts."
            action={
              <button type="button" className="insp-btn" onClick={clear}>
                Clear filters
              </button>
            }
          />
        )
      )}
      </div>
      </section>
      <PublishDialog open={publishing} onClose={() => setPublishing(false)} />
    </div>
  );
}
