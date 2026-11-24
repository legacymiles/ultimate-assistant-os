"use client";

// Reverse Prompt: drop, paste or pick an image (or up to four), and the vision
// model writes the prompt that would recreate it — describing only what it can
// see — broken into the same Prompt DNA chips as everything else.

import { useCallback, useEffect, useRef, useState } from "react";
import { BookmarkPlus, Check, ClipboardPaste, Copy, ImagePlus, Pencil, RefreshCw, ScanSearch, Wand2, X } from "lucide-react";
import { extractChips } from "@/lib/image-studio/inspire/extract";
import type { Chip, InspireImage } from "@/lib/image-studio/inspire/types";
import { api, fileToDataUrl, imageFiles } from "./api";
import { PromptDNA } from "./PromptDNA";
import { PublishDialog } from "./PublishDialog";
import { useInspire } from "./store";
import { Spinner } from "./ui";

const MAX = 4;

interface Result {
  prompt: string;
  chips: Chip[];
  analysis: Record<string, string>;
  offline?: boolean;
  warning?: string;
}

const ANALYSIS_LABELS: [string, string][] = [
  ["subject", "Main subject"],
  ["details", "Identifying details"],
  ["clothing", "Clothing & materials"],
  ["pose", "Pose & position"],
  ["background", "Background"],
  ["camera", "Camera & framing"],
  ["lighting", "Lighting"],
  ["palette", "Colour palette"],
  ["style", "Style & rendering"],
  ["textures", "Textures"],
  ["composition", "Composition"],
  ["mood", "Mood"],
];

export function Reverse() {
  const { requireSignIn, sendToBuilder, savePrompt, upsertOwnImage, copy, toast, me, refreshMe } = useInspire();
  const [shots, setShots] = useState<{ id: string; dataUrl: string; name: string }[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedImage, setSavedImage] = useState<InspireImage | null>(null);
  const [publishing, setPublishing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const add = useCallback(async (files: File[]) => {
    setError("");
    if (!files.length) return setError("That wasn't an image. Try a PNG, JPG or WebP.");
    const next: { id: string; dataUrl: string; name: string }[] = [];
    for (const f of files.slice(0, MAX)) {
      try {
        next.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, dataUrl: await fileToDataUrl(f, 1536, 0.9), name: f.name || "Pasted image" });
      } catch (e) {
        setError((e as Error).message);
      }
    }
    setShots((s) => [...s, ...next].slice(0, MAX));
    setResult(null);
    setSavedImage(null);
  }, []);

  // Paste anywhere on this screen.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = imageFiles(e.clipboardData?.items);
      if (!files.length) return;
      e.preventDefault();
      void add(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [add]);

  const analyse = (refine = false) =>
    requireSignIn("reverse-engineer prompts", async () => {
      if (!shots.length) return setError("Add an image first.");
      setBusy(true);
      setError("");
      try {
        const r = await api.post<Result>("/ai", {
          action: "reverse",
          images: shots.map((s) => s.dataUrl),
          ...(refine && result ? { instructions, previous: editing ? draft : result.prompt } : {}),
        });
        setResult(r);
        setDraft(r.prompt);
        setEditing(false);
        setSavedImage(null);
        if (refine) setInstructions("");
        void refreshMe();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    });

  const prompt = editing ? draft : (result?.prompt ?? "");
  const chips = result ? (editing && draft !== result.prompt ? extractChips(draft) : result.chips) : [];

  const saveAll = () =>
    requireSignIn("save to your library", async () => {
      if (!result || !shots[0]) return;
      setSaving(true);
      try {
        const r = await api.post<{ image: InspireImage }>("/images", {
          image: shots[0].dataUrl,
          source: "reverse",
          visibility: "private",
          title: shots[0].name.replace(/\.[^.]+$/, "").slice(0, 80) || "Reverse prompt",
          prompt,
          chips,
        });
        upsertOwnImage(r.image);
        setSavedImage(r.image);
        await savePrompt({ text: prompt, chips, origin: "reverse", title: r.image.title, imageId: r.image.id });
      } catch (e) {
        toast((e as Error).message, { tone: "bad" });
      } finally {
        setSaving(false);
      }
    });

  const reset = () => {
    setShots([]);
    setResult(null);
    setError("");
    setSavedImage(null);
  };

  return (
    <div>
      <header className="insp-page-head">
        <div style={{ maxWidth: 640 }}>
          <h1 className="insp-h1" style={{ margin: "0 0 10px" }}>
            Reverse Prompt
          </h1>
          <p className="insp-muted" style={{ margin: 0, fontSize: 14.5 }}>
            Upload, drop or paste an image. The vision model writes the prompt that would recreate it, then splits it into ingredients you can keep.
          </p>
        </div>
        {shots.length > 0 && (
          <button type="button" className="insp-btn insp-btn-quiet" onClick={reset}>
            Start over
          </button>
        )}
      </header>

      {!shots.length ? (
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
            void add(imageFiles(e.dataTransfer.files));
          }}
          style={{ width: "100%", minHeight: 340, display: "grid", placeItems: "center", alignContent: "center", gap: 14, color: "var(--ink-2)", padding: 30 }}
        >
          <span style={{ width: 64, height: 64, borderRadius: 20, display: "grid", placeItems: "center", border: "1px solid var(--line-2)", background: "rgba(255,255,255,.03)" }}>
            <ImagePlus size={28} />
          </span>
          <span className="insp-h2">Drop an image here</span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", fontSize: 13 }}>
            <span>or click to choose</span>
            <span className="insp-faint">·</span>
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <ClipboardPaste size={14} /> paste with Ctrl/⌘ + V
            </span>
            <span className="insp-faint">·</span>
            <span>up to {MAX} references</span>
          </span>
        </button>
      ) : (
        <div className="insp-reverse" style={{ display: "grid", gap: 24 }}>
          <style>{`
            .insp-reverse { grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); align-items: start; }
            .insp-scan { position: absolute; left: 0; right: 0; height: 30%; background: linear-gradient(to bottom, transparent, rgba(255,255,255,.18) 70%, rgba(255,255,255,.75) 98%, transparent); mix-blend-mode: screen; animation: insp-scan 1.8s cubic-bezier(.45,0,.55,1) infinite; }
            @keyframes insp-scan { from { top: -30%; } to { top: 100%; } }
            @media (max-width: 980px) { .insp-reverse { grid-template-columns: 1fr; } }
          `}</style>
          <div style={{ display: "grid", gap: 10, position: "sticky", top: 12 }}>
            <div data-standout="scan" style={{ position: "relative", borderRadius: 18, overflow: "hidden", background: "#050506", border: "1px solid var(--line)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shots[0].dataUrl} alt="Your reference" style={{ display: "block", width: "100%", maxHeight: "64dvh", objectFit: "contain" }} />
              {busy && <div className="insp-scan" aria-hidden />}
              {busy && (
                <div style={{ position: "absolute", left: 12, bottom: 12, display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 999, background: "rgba(0,0,0,.6)", backdropFilter: "blur(8px)", fontSize: 12.5 }}>
                  <Spinner size={12} /> Reading the image…
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {shots.map((s, i) => (
                <span key={s.id} style={{ position: "relative" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.dataUrl} alt={s.name} style={{ width: 58, height: 58, objectFit: "cover", borderRadius: 10, border: i === 0 ? "1.5px solid var(--ink)" : "1px solid var(--line-2)" }} />
                  <button
                    type="button"
                    aria-label={`Remove ${s.name}`}
                    onClick={() => {
                      setShots((all) => all.filter((x) => x.id !== s.id));
                      setResult(null);
                    }}
                    style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 999, background: "var(--ink)", color: "#0a0a0c", display: "grid", placeItems: "center" }}
                  >
                    <X size={11} strokeWidth={3} />
                  </button>
                </span>
              ))}
              {shots.length < MAX && (
                <button type="button" className="insp-btn insp-btn-icon" style={{ width: 58, height: 58, borderRadius: 10 }} onClick={() => fileRef.current?.click()} aria-label="Add another reference">
                  <ImagePlus size={18} />
                </button>
              )}
              {shots.length > 1 && (
                <span className="insp-faint" style={{ fontSize: 12 }}>
                  The first image leads; the rest add shared style and subject details.
                </span>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gap: 18 }}>
            {!result ? (
              <div className="insp-panel" style={{ padding: 22, display: "grid", gap: 14 }}>
                <div className="insp-h2">Ready to read {shots.length > 1 ? `${shots.length} images` : "this image"}</div>
                <p className="insp-muted" style={{ margin: 0 }}>
                  It looks at the subject, clothing, pose, background, camera angle, lighting, colour, style, textures, composition and mood — and only describes what is actually visible.
                </p>
                <div>
                  <button type="button" className="insp-btn insp-btn-primary insp-btn-lg" onClick={() => void analyse(false)} disabled={busy}>
                    {busy ? <Spinner size={14} /> : <ScanSearch size={16} />} {busy ? "Reading…" : "Write the prompt"}
                  </button>
                </div>
                {me && !me.ai && (
                  <div className="insp-note">No AI key is set, so only measurable things — shape, brightness and colour — can be described. Add OPENROUTER_API_KEY for a full recreation prompt.</div>
                )}
              </div>
            ) : (
              <>
                {result.warning && <div className="insp-note">{result.warning}</div>}
                <div className="insp-panel" style={{ padding: 18, display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="insp-kicker" style={{ flex: 1 }}>
                      Recreation prompt{editing ? " · editing" : ""}
                    </span>
                    <button type="button" className="insp-btn insp-btn-sm" onClick={() => void copy(prompt, "Prompt copied")}>
                      <Copy size={13} /> Copy
                    </button>
                    <button type="button" className="insp-btn insp-btn-sm" onClick={() => setEditing((e) => !e)} aria-pressed={editing}>
                      {editing ? <Check size={13} /> : <Pencil size={13} />} {editing ? "Done" : "Edit"}
                    </button>
                    <button type="button" className="insp-btn insp-btn-sm" onClick={() => void analyse(false)} disabled={busy}>
                      {busy ? <Spinner size={12} /> : <RefreshCw size={13} />} Regenerate
                    </button>
                  </div>
                  {editing ? (
                    <textarea className="insp-textarea" value={draft} onChange={(e) => setDraft(e.target.value)} rows={7} aria-label="Edit the prompt" />
                  ) : (
                    <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7 }}>{prompt}</p>
                  )}
                  <form
                    style={{ display: "flex", gap: 8 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (instructions.trim()) void analyse(true);
                    }}
                  >
                    <input className="insp-input" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Refine: “warmer light”, “she wears a red jacket”, “make it 35mm film”" maxLength={800} aria-label="Refinement instructions" />
                    <button className="insp-btn" type="submit" disabled={busy || !instructions.trim()}>
                      Refine
                    </button>
                  </form>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="insp-btn insp-btn-primary"
                      onClick={() => sendToBuilder(chips, { replace: true, origin: { kind: "reverse", label: shots[0].name || "your image" }, history: prompt })}
                    >
                      <Wand2 size={14} /> Open in Prompt Builder
                    </button>
                    <button type="button" className="insp-btn" onClick={() => void saveAll()} disabled={saving || !!savedImage}>
                      {saving ? <Spinner size={13} /> : savedImage ? <Check size={14} /> : <BookmarkPlus size={14} />} {savedImage ? "Saved to library" : "Save image, prompt & chips"}
                    </button>
                    {savedImage && (
                      <button type="button" className="insp-btn insp-btn-quiet" onClick={() => setPublishing(true)}>
                        Publish to Explore…
                      </button>
                    )}
                  </div>
                </div>

                <div className="insp-panel" style={{ padding: 18 }}>
                  <PromptDNA prompt={prompt} chips={chips} hidePrompt />
                </div>

                {Object.keys(result.analysis).length > 0 && (
                  <div className="insp-panel" style={{ padding: 18 }}>
                    <div className="insp-kicker" style={{ marginBottom: 10 }}>
                      What the model saw
                    </div>
                    <dl style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: "8px 14px", margin: 0, fontSize: 13.5 }}>
                      {ANALYSIS_LABELS.filter(([k]) => result.analysis[k]).map(([k, label]) => (
                        <div key={k} style={{ display: "contents" }}>
                          <dt className="insp-faint">{label}</dt>
                          <dd style={{ margin: 0 }}>{result.analysis[k]}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                <p className="insp-faint" style={{ margin: 0, fontSize: 12.5 }}>
                  The prompt describes only what is visible. How closely a new image matches depends on the generation model — and on whether it accepts reference images, which help far more than words for faces and exact layouts.
                </p>
              </>
            )}
            {error && <div className="insp-error">{error}</div>}
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void add(imageFiles(e.target.files))} />
      {savedImage && <PublishDialog open={publishing} onClose={() => setPublishing(false)} image={savedImage} />}
    </div>
  );
}
