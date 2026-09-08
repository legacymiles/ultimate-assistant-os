"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../icons";
import { classifyContent, folderPaths } from "@/lib/recall/classify";
import { createItem, ensureFolderPath } from "@/lib/recall/store";
import { fetchLinkMeta, imageToDataUrl, isProbablyUrl } from "@/lib/recall/media";
import { driveConfigured, pickFromDrive } from "@/lib/recall/drive";
import type { Classification, Folder, Item, RecallData } from "@/lib/recall/types";

type Step = "input" | "analyzing" | "confirm";

interface Props {
  folders: Folder[];
  existingTags: string[];
  onClose: () => void;
  onSaved: (data: RecallData, savedCount: number) => void;
}

export function CaptureModal({ folders, existingTags, onClose, onSaved }: Props) {
  const [step, setStep] = useState<Step>("input");
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ dataUrl: string; name: string; type: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [driveNote, setDriveNote] = useState<string | null>(null);

  // Confirm-step editable proposal.
  const [proposal, setProposal] = useState<Classification | null>(null);
  const [pathText, setPathText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [captureUrl, setCaptureUrl] = useState<string | null>(null);
  const [kind, setKind] = useState<Item["kind"]>("note");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const suggestions = folderPaths(folders).slice(0, 10);

  async function handleImageFile(file: File) {
    setError(null);
    try {
      const dataUrl = await imageToDataUrl(file);
      setImage({ dataUrl, name: file.name, type: file.type || "image/jpeg", size: file.size });
    } catch {
      setError("Could not read that image.");
    }
  }

  async function analyze() {
    setError(null);
    const raw = text.trim();
    if (!raw && !image) {
      setError("Add some text, a link, or an image first.");
      return;
    }
    setStep("analyzing");

    let content = raw;
    let url: string | null = null;
    let itemKind: Item["kind"] = "note";
    let urlTitle: string | undefined;

    try {
      if (image) {
        itemKind = "image";
        content = raw || `Image: ${image.name}`;
      } else if (isProbablyUrl(raw)) {
        itemKind = "link";
        const meta = await fetchLinkMeta(raw);
        url = meta.url;
        urlTitle = meta.title;
        content = `${meta.title}\n${meta.text}`;
      }

      const c = await classifyContent({
        content,
        kind: itemKind,
        folders,
        existingTags,
        urlTitle,
      });

      setProposal(c);
      setTitle(c.title);
      setSummary(c.summary);
      setPathText(c.folderPath.join(" / "));
      setTags(c.tags);
      setCaptureUrl(url);
      setKind(itemKind);
      setStep("confirm");
    } catch {
      setError("Something went wrong analyzing that. Try again.");
      setStep("input");
    }
  }

  function save() {
    const path = pathText
      .split(/\s*\/\s*|\s*›\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    const { folderId } = ensureFolderPath(path.length ? path : ["Inbox"], true);
    const { data } = createItem({
      title,
      body: image ? text.trim() || `Image: ${image.name}` : text.trim(),
      summary,
      kind,
      source: captureUrl ? "web" : "manual",
      folderId,
      tags,
      url: captureUrl,
      attachment: image
        ? { name: image.name, type: image.type, size: image.size, url: image.dataUrl }
        : null,
    });
    onSaved(data, 1);
  }

  async function importFromDrive() {
    if (!driveConfigured()) {
      setDriveNote(
        "Drive import needs NEXT_PUBLIC_GOOGLE_CLIENT_ID and NEXT_PUBLIC_GOOGLE_API_KEY set. Until then, paste text/links or upload images.",
      );
      return;
    }
    setError(null);
    setStep("analyzing");
    try {
      const files = await pickFromDrive();
      if (files.length === 0) {
        setStep("input");
        return;
      }
      let data: RecallData | null = null;
      for (const f of files) {
        const content = f.text || f.name;
        const c = await classifyContent({
          content,
          kind: f.dataUrl ? "image" : "drive",
          folders: data?.folders ?? folders,
          existingTags,
          urlTitle: f.name,
        });
        const { folderId } = ensureFolderPath(c.folderPath, true);
        const res = createItem({
          title: c.title || f.name,
          body: f.text || "",
          summary: c.summary,
          kind: f.dataUrl ? "image" : "drive",
          source: "drive",
          folderId,
          tags: c.tags,
          url: f.url ?? null,
          driveId: f.id,
          attachment: f.dataUrl
            ? { name: f.name, type: f.mimeType, size: 0, url: f.dataUrl }
            : null,
        });
        data = res.data;
      }
      if (data) onSaved(data, files.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Drive import failed.");
      setStep("input");
    }
  }

  function addTag(raw: string) {
    const t = raw.toLowerCase().trim().replace(/\s+/g, "-");
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onClick={onClose}>
      <div
        className="animate-fade-in w-full max-w-lg rounded-2xl border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand/15 text-brand">
              <Icon.Plus width={16} height={16} />
            </span>
            <span className="text-sm font-semibold text-ink">
              {step === "confirm" ? "Confirm & file" : "Capture"}
            </span>
            {proposal && step === "confirm" && (
              <span className="rounded-md bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                {proposal.engine === "ai" ? "AI suggested" : "Auto-suggested"}
              </span>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-faint hover:bg-panel-2 hover:text-ink" aria-label="Close">
            <Icon.Close width={16} height={16} />
          </button>
        </div>

        <div className="p-4">
          {step !== "confirm" ? (
            <>
              <textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste text, a link, or a thought you want to keep…"
                rows={5}
                disabled={step === "analyzing"}
                className="w-full resize-none rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
              />

              {image && (
                <div className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-panel-2 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.dataUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{image.name}</span>
                  <button onClick={() => setImage(null)} className="rounded p-1 text-ink-faint hover:text-red-400" aria-label="Remove image">
                    <Icon.Trash width={14} height={14} />
                  </button>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleImageFile(e.target.files[0])}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={step === "analyzing"}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50"
                >
                  <Icon.Image width={15} height={15} /> Image
                </button>
                <button
                  onClick={importFromDrive}
                  disabled={step === "analyzing"}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50"
                >
                  <Icon.Database width={15} height={15} /> Import from Drive
                </button>
                <button
                  onClick={analyze}
                  disabled={step === "analyzing"}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-2 disabled:opacity-60"
                >
                  {step === "analyzing" ? (
                    <>
                      <Icon.Refresh width={15} height={15} className="animate-spin" /> Analyzing…
                    </>
                  ) : (
                    <>
                      <Icon.Sparkles width={15} height={15} /> Analyze
                    </>
                  )}
                </button>
              </div>

              {driveNote && <p className="mt-3 text-xs text-ink-muted">{driveNote}</p>}
              {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
            </>
          ) : (
            <div className="space-y-3.5">
              <Field label="Title">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
              </Field>

              <Field label="Summary">
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
              </Field>

              <Field label="Folder">
                <input
                  value={pathText}
                  onChange={(e) => setPathText(e.target.value)}
                  placeholder="Game Dev / Engines"
                  className="w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
                {suggestions.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => setPathText(s.replace(/›/g, "/"))}
                        className="rounded-md bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-muted transition hover:bg-elevated hover:text-brand"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </Field>

              <Field label="Tags">
                <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-canvas px-2 py-1.5">
                  {tags.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-md bg-brand/15 px-1.5 py-0.5 text-[11px] font-medium text-brand">
                      {t}
                      <button onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
                        <Icon.Close width={11} height={11} />
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addTag(tagInput);
                      }
                    }}
                    placeholder={tags.length ? "" : "add a tag…"}
                    className="min-w-[80px] flex-1 bg-transparent py-0.5 text-xs text-ink outline-none placeholder:text-ink-faint"
                  />
                </div>
              </Field>

              {error && <p className="text-xs text-red-400">{error}</p>}

              <div className="flex items-center justify-between pt-1">
                <button onClick={() => setStep("input")} className="text-xs font-medium text-ink-muted hover:text-ink">
                  ← Back
                </button>
                <button
                  onClick={save}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-2"
                >
                  <Icon.Check width={15} height={15} /> Save to Dashboard
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">{label}</span>
      {children}
    </label>
  );
}
