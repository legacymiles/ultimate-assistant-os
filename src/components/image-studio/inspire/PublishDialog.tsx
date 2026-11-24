"use client";

// Upload an image to your library, or publish one to Explore. Also edits an
// image you own. The prompt is analysed into suggested chips you review and
// edit before anything is shared; Private keeps it in your library only.

import { useEffect, useRef, useState } from "react";
import { Globe2, ImagePlus, Lock, Plus, Sparkles } from "lucide-react";
import { extractChips } from "@/lib/image-studio/inspire/extract";
import { ART_STYLES, CHIP_CATEGORIES, GALLERY_CATEGORIES, SUBJECTS, type ChipCategoryId } from "@/lib/image-studio/inspire/taxonomy";
import type { Chip, InspireImage, Visibility } from "@/lib/image-studio/inspire/types";
import { api, fileToDataUrl, imageFiles } from "./api";
import { useInspire } from "./store";
import { DnaChip, Modal, Spinner } from "./ui";

export interface PublishSeed {
  dataUrl?: string;
  prompt?: string;
  chips?: Chip[];
  title?: string;
  visibility?: Visibility;
}

export function PublishDialog({ open, onClose, image, seed }: { open: boolean; onClose: () => void; image?: InspireImage | null; seed?: PublishSeed }) {
  const { me, upsertOwnImage, toast } = useInspire();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [style, setStyle] = useState<string>("Cyberpunk");
  const [subject, setSubject] = useState<string>("Person");
  const [category, setCategory] = useState<string>("digital-art");
  const [creator, setCreator] = useState("");
  const [chips, setChips] = useState<Chip[]>([]);
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [newChip, setNewChip] = useState("");
  const [newCat, setNewCat] = useState<ChipCategoryId>("style");
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError("");
    setDataUrl(seed?.dataUrl ?? null);
    setTitle(image?.title ?? seed?.title ?? "");
    setDescription(image?.description ?? "");
    setPrompt(image?.prompt ?? seed?.prompt ?? "");
    setModel(image?.model ?? "");
    setStyle(image?.style ?? "Cyberpunk");
    setSubject(image?.subject ?? "Person");
    setCategory(image?.category ?? "digital-art");
    setCreator(image?.creator ?? (me?.email ? me.email.split("@")[0] : ""));
    setChips(image?.chips ?? seed?.chips ?? []);
    setVisibility(image?.visibility ?? seed?.visibility ?? "private");
  }, [open, image, seed, me]);

  const locked = image?.visibility === "public";

  const pick = async (files: File[]) => {
    const f = files[0];
    if (!f) return setError("That wasn't an image file.");
    try {
      setDataUrl(await fileToDataUrl(f, 2048, 0.9));
      setError("");
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 80));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const extract = async () => {
    if (!prompt.trim()) return setError("Paste the prompt first — the ingredients come from it.");
    setExtracting(true);
    setError("");
    try {
      const r = await api.post<{ chips: Chip[] }>("/ai", { action: "extract", prompt });
      setChips(r.chips);
    } catch {
      setChips(extractChips(prompt));
    } finally {
      setExtracting(false);
    }
  };

  const save = async () => {
    setError("");
    if (!image && !dataUrl) return setError("Add an image first.");
    if (visibility === "public" && !prompt.trim()) return setError("Publishing shares the prompt behind the image — add it first.");
    if (visibility === "public" && !title.trim()) return setError("Give it a title before publishing.");
    setBusy(true);
    try {
      const finalChips = chips.length ? chips : prompt.trim() ? extractChips(prompt) : [];
      const fields = { title, description, model, style, subject, category, chips: finalChips, visibility, creator };
      const r = image
        ? await api.patch<{ image: InspireImage }>(`/images/${image.id}`, locked ? fields : { ...fields, prompt })
        : await api.post<{ image: InspireImage }>("/images", { ...fields, prompt, image: dataUrl, source: "upload" });
      upsertOwnImage(r.image);
      toast(r.image.visibility === "public" ? "Published to Explore" : image ? "Saved" : "Added to your library");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const preview = image ? image.thumb : dataUrl;

  return (
    <Modal open={open} onClose={onClose} label={image ? "Edit image" : "Upload an image"}>
      <div style={{ padding: "22px 22px 0" }}>
        <div className="insp-h2">
          {image ? "Details & sharing" : "Add an image"}
        </div>
      </div>
      <div style={{ padding: 22, display: "grid", gap: 16 }}>
        {preview ? (
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <img src={preview} alt="" style={{ width: 120, borderRadius: 12, background: image?.tint ?? "var(--raise)" }} />
            {!image && (
              <button type="button" className="insp-btn insp-btn-sm" onClick={() => fileRef.current?.click()}>
                Replace
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="insp-dropzone"
            data-over={over}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void pick(imageFiles(e.dataTransfer.files));
            }}
            style={{ padding: "34px 16px", display: "grid", placeItems: "center", gap: 8, color: "var(--ink-2)" }}
          >
            <ImagePlus size={26} />
            <span>Drop an image, or click to choose</span>
            <span className="insp-faint" style={{ fontSize: 12 }}>
              PNG, JPG or WebP — stored privately, metadata stripped
            </span>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pick(imageFiles(e.target.files))} />

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <label style={{ gridColumn: "1 / -1" }}>
            <span className="insp-label">Title</span>
            <input className="insp-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={90} placeholder="Neon Ronin" />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            <span className="insp-label">Original prompt {locked && <span className="insp-faint">· locked while published</span>}</span>
            <textarea className="insp-textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={locked} maxLength={4000} placeholder="Exactly what you typed into the image model" />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            <span className="insp-label">Description (optional)</span>
            <input className="insp-input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} />
          </label>
          <label>
            <span className="insp-label">Category</span>
            <select className="insp-select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {GALLERY_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="insp-label">Art style</span>
            <select className="insp-select" value={style} onChange={(e) => setStyle(e.target.value)}>
              {ART_STYLES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="insp-label">Subject</span>
            <select className="insp-select" value={subject} onChange={(e) => setSubject(e.target.value)}>
              {SUBJECTS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="insp-label">AI model (optional)</span>
            <input className="insp-input" value={model} onChange={(e) => setModel(e.target.value)} maxLength={60} placeholder="Flux, Midjourney v7…" />
          </label>
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <span className="insp-label" style={{ margin: 0 }}>
              Prompt ingredients
            </span>
            <button type="button" className="insp-btn insp-btn-sm" onClick={() => void extract()} disabled={extracting || !prompt.trim()}>
              {extracting ? <Spinner size={12} /> : <Sparkles size={13} />} {chips.length ? "Re-extract" : "Suggest chips"}
            </button>
          </div>
          {chips.length ? (
            <div className="insp-chips insp-seq">
              {chips.map((c, i) => (
                <DnaChip key={c.text} chip={c} small style={{ ["--i" as string]: i }} onRemove={() => setChips((cs) => cs.filter((x) => x !== c))} />
              ))}
            </div>
          ) : (
            <div className="insp-faint" style={{ fontSize: 12.5 }}>
              Suggested from your prompt. Review them, remove any that don&apos;t belong, and add your own.
            </div>
          )}
          <form
            style={{ display: "flex", gap: 6, marginTop: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              const t = newChip.trim();
              if (!t || chips.some((c) => c.text.toLowerCase() === t.toLowerCase())) return;
              setChips((cs) => [...cs, { text: t, category: newCat }]);
              setNewChip("");
            }}
          >
            <input className="insp-input" style={{ height: 34 }} value={newChip} onChange={(e) => setNewChip(e.target.value)} placeholder="Add an ingredient" maxLength={80} />
            <select className="insp-select" style={{ height: 34, width: 150 }} value={newCat} onChange={(e) => setNewCat(e.target.value as ChipCategoryId)} aria-label="Category">
              {CHIP_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <button className="insp-btn insp-btn-sm insp-btn-icon" style={{ height: 34, width: 34 }} type="submit" aria-label="Add chip">
              <Plus size={14} />
            </button>
          </form>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {(
            [
              ["private", <Lock key="l" size={15} />, "Private", "Only in your library"],
              ["public", <Globe2 key="g" size={15} />, "Public", "Shown in Explore with its prompt"],
            ] as const
          ).map(([v, icon, label, hint]) => (
            <button
              key={v}
              type="button"
              onClick={() => setVisibility(v)}
              aria-pressed={visibility === v}
              className="insp-panel"
              style={{ padding: 12, textAlign: "left", borderColor: visibility === v ? "rgba(255,255,255,.5)" : undefined, background: visibility === v ? "rgba(255,255,255,.06)" : undefined }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 600 }}>
                {icon} {label}
              </span>
              <span className="insp-faint" style={{ fontSize: 12 }}>
                {hint}
              </span>
            </button>
          ))}
        </div>
        {visibility === "public" && (
          <label>
            <span className="insp-label">Credit as</span>
            <input className="insp-input" value={creator} onChange={(e) => setCreator(e.target.value)} maxLength={40} placeholder="Your creator name" />
          </label>
        )}
        {error && <div className="insp-error">{error}</div>}
      </div>
      <div style={{ position: "sticky", bottom: 0, display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 22px", borderTop: "1px solid var(--line)", background: "var(--bg-2)" }}>
        <button type="button" className="insp-btn insp-btn-quiet" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="insp-btn insp-btn-primary" onClick={() => void save()} disabled={busy}>
          {busy && <Spinner size={13} />} {visibility === "public" ? (image?.visibility === "public" ? "Save" : "Publish") : "Save to library"}
        </button>
      </div>
    </Modal>
  );
}
