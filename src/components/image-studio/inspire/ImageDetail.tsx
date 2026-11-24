"use client";

// The full-size preview and creative breakdown of one image: the picture, who
// made it, its Prompt DNA, save-to-collections, Remix, and Style Discovery —
// images that share its visual DNA, by facet.

import { useEffect, useState } from "react";
import { BookmarkCheck, BookmarkPlus, ChevronDown, Download, Globe2, Lock, Pencil, X } from "lucide-react";
import type { Facet } from "@/lib/image-studio/inspire/discover";
import { deliverableById } from "@/lib/image-studio/inspire/deliverables";
import { galleryCategoryLabel } from "@/lib/image-studio/inspire/taxonomy";
import type { InspireImage } from "@/lib/image-studio/inspire/types";
import { api } from "./api";
import { PromptDNA } from "./PromptDNA";
import { PublishDialog } from "./PublishDialog";
import { deliverableForCategory, useInspire } from "./store";
import { CollectionChecklist, Menu, Modal, Shot, Spinner } from "./ui";

const FACETS: { id: Facet; label: string }[] = [
  { id: "all", label: "Overall" },
  { id: "style", label: "Art style" },
  { id: "lighting", label: "Lighting" },
  { id: "composition", label: "Composition" },
  { id: "texture", label: "Texture" },
  { id: "color", label: "Colour" },
  { id: "mood", label: "Mood" },
];

function SaveControl({ img }: { img: InspireImage }) {
  const { lib, saveImage, setItemCollections, savedImageIds, me, requireSignIn } = useInspire();
  const item = lib.items.find((i) => i.kind === "image" && i.imageId === img.id);
  const saved = savedImageIds.has(img.id);
  return (
    <span style={{ display: "inline-flex" }}>
      <button type="button" className={`insp-btn ${saved ? "" : "insp-btn-primary"}`} style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }} onClick={() => void saveImage(img)}>
        {saved ? <BookmarkCheck size={14} /> : <BookmarkPlus size={14} />} {saved ? "Saved" : "Save"}
      </button>
      <Menu
        label="Save to collections"
        trigger={(open, expanded) => (
          <button
            type="button"
            className={`insp-btn insp-btn-icon ${saved ? "" : "insp-btn-primary"}`}
            style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: "1px solid rgba(0,0,0,.25)" }}
            aria-label="Save to a collection"
            aria-expanded={expanded}
            onClick={() => (me?.signedIn ? open() : requireSignIn("save to collections", () => {}))}
          >
            <ChevronDown size={14} />
          </button>
        )}
      >
        {() => (
          <CollectionChecklist
            selected={item?.collectionIds ?? []}
            onChange={(ids) => {
              if (item) void setItemCollections(item, ids);
              else void saveImage(img, ids);
            }}
          />
        )}
      </Menu>
    </span>
  );
}

export function ImageDetail() {
  const { detail, openImage, sendToBuilder, savePrompt, me, lib } = useInspire();
  const [img, setImg] = useState<InspireImage | null>(null);
  const [related, setRelated] = useState<InspireImage[] | null>(null);
  const [facet, setFacet] = useState<Facet>("all");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  const id = typeof detail === "string" ? detail : detail?.id ?? null;

  useEffect(() => {
    setError("");
    setRelated(null);
    setFacet("all");
    if (!detail) return setImg(null);
    if (typeof detail !== "string") setImg(detail);
    else setImg(null);
  }, [detail]);

  useEffect(() => {
    if (!id) return;
    let live = true;
    setRelated(null);
    api
      .get<{ image: InspireImage; related: InspireImage[] }>(`/images/${encodeURIComponent(id)}?facet=${facet}`)
      .then((r) => {
        if (!live) return;
        setImg(r.image);
        setRelated(r.related);
      })
      .catch((e: Error) => live && (typeof detail === "string" ? setError(e.message) : setRelated([])));
    return () => {
      live = false;
    };
  }, [id, facet, detail]);

  // Keep the modal in sync when the owner edits or publishes.
  const own = img ? lib.ownImages.find((o) => o.id === img.id) : undefined;
  const shown = own ?? img;
  const mine = !!shown && !!me?.id && shown.ownerId === me.id;

  const remix = () => {
    if (!shown) return;
    sendToBuilder(shown.chips, {
      replace: true,
      origin: { kind: "remix", label: shown.title },
      history: shown.prompt,
      deliverable: shown.generation ? (deliverableById(shown.generation.deliverable).id) : deliverableForCategory(shown.category),
    });
  };

  return (
    <Modal open={!!detail} onClose={() => openImage(null)} wide label={shown?.title ?? "Image"}>
      {!shown ? (
        <div style={{ display: "grid", placeItems: "center", height: "100%", minHeight: 300, padding: 30 }}>{error ? <div className="insp-error">{error}</div> : <Spinner size={22} />}</div>
      ) : (
        <div className="insp-detail" style={{ display: "grid", height: "100%" }}>
          <style>{`
            .insp-detail { grid-template-columns: minmax(0, 1.25fr) minmax(360px, 1fr); }
            .insp-detail-stage { position: relative; display: grid; place-items: center; background: #050506; padding: 18px; min-height: 0; overflow: hidden; }
            .insp-detail-panel { overflow-y: auto; padding: 26px 26px 40px; border-left: 1px solid var(--line); }
            @media (max-width: 860px) {
              .insp-detail { grid-template-columns: 1fr; height: auto !important; overflow-y: auto; }
              .insp-detail-stage { max-height: 62dvh; padding: 10px; }
              .insp-detail-panel { border-left: 0; padding: 18px 16px 40px; overflow: visible; }
            }
          `}</style>
          <div className="insp-detail-stage">
            <div aria-hidden style={{ position: "absolute", inset: -40, background: shown.tint, filter: "blur(80px)", opacity: 0.35 }} />
            <Shot img={shown} full fit="contain" style={{ position: "relative", maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", borderRadius: 12, boxShadow: "0 30px 80px -20px rgba(0,0,0,.8)" }} />
          </div>
          <div className="insp-detail-panel">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 className="insp-display" style={{ fontSize: 30, margin: "2px 0 8px" }}>
                  {shown.title}
                </h2>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <span className="insp-mono" style={{ fontSize: 12 }}>
                    @{shown.creator}
                  </span>
                  <span className="insp-faint" style={{ fontSize: 12 }}>
                    {galleryCategoryLabel(shown.category)} · {shown.style}
                  </span>
                  {shown.source === "seed" && <span className="insp-badge">Starter set</span>}
                  {mine && <span className="insp-badge">{shown.visibility === "public" ? <><Globe2 size={10} /> Public</> : <><Lock size={10} /> Private</>}</span>}
                  {shown.model && <span className="insp-badge">{shown.model}</span>}
                </div>
              </div>
              <button type="button" className="insp-btn insp-btn-icon insp-btn-quiet" onClick={() => openImage(null)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            {shown.description && (
              <p className="insp-muted" style={{ margin: "12px 0 0" }}>
                {shown.description}
              </p>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "18px 0 26px" }}>
              <SaveControl img={shown} />
              {mine && (
                <button type="button" className="insp-btn" onClick={() => setEditing(true)}>
                  <Pencil size={14} /> {shown.visibility === "public" ? "Edit" : "Edit or publish"}
                </button>
              )}
              <a className="insp-btn insp-btn-icon" href={shown.src} download={`${shown.title.replace(/[^\w-]+/g, "-").toLowerCase()}.webp`} aria-label="Download full size" title="Download full size">
                <Download size={14} />
              </a>
            </div>

            {shown.prompt ? (
              <PromptDNA
                prompt={shown.prompt}
                chips={shown.chips}
                onRemix={remix}
                onSavePrompt={() => void savePrompt({ text: shown.prompt, chips: shown.chips, origin: "saved", title: shown.title, imageId: shown.id })}
              />
            ) : (
              <div className="insp-note">No prompt was shared with this image.</div>
            )}

            {shown.enhancedPrompt && (
              <div className="insp-panel" style={{ padding: 14, marginTop: 18 }}>
                <div className="insp-kicker" style={{ marginBottom: 6 }}>
                  AI-enhanced version · kept apart from the original
                </div>
                <p className="insp-muted" style={{ margin: 0, fontSize: 13.5 }}>
                  {shown.enhancedPrompt}
                </p>
              </div>
            )}

            {shown.generation && (
              <details className="insp-panel" style={{ padding: "12px 14px", marginTop: 18 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>How it was made</summary>
                <dl style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "6px 12px", margin: "12px 0 0", fontSize: 12.5 }}>
                  <dt className="insp-faint">Deliverable</dt>
                  <dd style={{ margin: 0 }}>{deliverableById(shown.generation.deliverable).label} · {shown.generation.settings.aspect}</dd>
                  <dt className="insp-faint">Drawn by</dt>
                  <dd style={{ margin: 0 }}>{shown.generation.lane}</dd>
                  <dt className="insp-faint">References</dt>
                  <dd style={{ margin: 0 }}>{shown.generation.references.length ? shown.generation.references.map((r) => `${r.name} (${r.purpose})`).join(", ") : "None"}</dd>
                  <dt className="insp-faint">Technical layer</dt>
                  <dd style={{ margin: 0 }} className="insp-muted">{shown.generation.technicalPrompt || "None (Custom)"}</dd>
                  {shown.generation.history.length > 0 && (
                    <>
                      <dt className="insp-faint">Grew from</dt>
                      <dd style={{ margin: 0 }} className="insp-muted">{shown.generation.history[0]}</dd>
                    </>
                  )}
                </dl>
              </details>
            )}

            <section style={{ marginTop: 34 }} aria-label="Style discovery">
              <div className="insp-kicker" style={{ marginBottom: 10 }}>
                Style discovery — shares its…
              </div>
              <div className="insp-pills" role="tablist">
                {FACETS.map((f) => (
                  <button key={f.id} type="button" role="tab" aria-selected={facet === f.id} className="insp-pill" aria-pressed={facet === f.id} onClick={() => setFacet(f.id)}>
                    {f.label}
                  </button>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8, marginTop: 12 }}>
                {related === null
                  ? [0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="insp-skel" style={{ aspectRatio: "1" }} />)
                  : related.map((r) => (
                      <button key={r.id} type="button" onClick={() => openImage(r)} className="insp-card" style={{ aspectRatio: "1", borderRadius: 10 }} title={r.title}>
                        <Shot img={r} style={{ width: "100%", height: "100%" }} />
                      </button>
                    ))}
              </div>
              {related && related.length === 0 && (
                <div className="insp-faint" style={{ fontSize: 12.5, marginTop: 8 }}>
                  No close matches on this facet yet.
                </div>
              )}
            </section>
          </div>
        </div>
      )}
      {mine && shown && <PublishDialog open={editing} onClose={() => setEditing(false)} image={shown} />}
    </Modal>
  );
}
