"use client";

import { useRef, useState } from "react";
import { getRepo } from "@/lib/repo";
import { useStore } from "@/lib/store";
import { KNOWLEDGE_KIND_LABELS, type KnowledgeKind } from "@/lib/types";
import { fileCategory, formatBytes } from "@/lib/utils";
import { Icon } from "../icons";
import { Field, Modal, PrimaryButton, GhostButton, inputClass } from "../Modal";

const KINDS = Object.keys(KNOWLEDGE_KIND_LABELS) as KnowledgeKind[];

interface PickedFile {
  file: File;
  isImage: boolean;
  dataUrl?: string;
  engine?: "ai" | "heuristic";
  charCount?: number;
}

export function AddKnowledgeModal({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const addKnowledge = useStore((s) => s.addKnowledge);
  const busy = useStore((s) => s.busy);
  const inputRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<KnowledgeKind>("note");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setContent("");
    setKind("note");
    setPicked(null);
    setIngesting(false);
    setIngestError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const close = () => {
    reset();
    onClose();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIngesting(true);
    setIngestError(null);
    try {
      // Read a data URL for image previews / local persistence.
      const isImage = file.type.startsWith("image/") || fileCategory(file.name) === "image";
      let dataUrl: string | undefined;
      if (isImage && file.size < 1_500_000) {
        dataUrl = await readDataUrl(file);
      }

      // Send to the AI ingest endpoint for reading + summarising.
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/ingest", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Ingest failed (${res.status})`);
      }
      const data = await res.json();

      setPicked({ file, isImage, dataUrl, engine: data.engine, charCount: data.charCount });
      setTitle((t) => t || data.title || file.name);
      setContent(data.summary || "");
      if (data.kind) setKind(data.kind as KnowledgeKind);
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : "Could not read this file");
      setPicked({
        file,
        isImage: file.type.startsWith("image/"),
      });
      setTitle((t) => t || file.name.replace(/\.[^.]+$/, ""));
    } finally {
      setIngesting(false);
    }
  };

  const submit = async () => {
    if (!content.trim() && !picked) return;
    const local = getRepo().kind === "local";
    await addKnowledge(projectId, {
      kind,
      title: title.trim() || KNOWLEDGE_KIND_LABELS[kind],
      content: content.trim(),
      attachment: picked
        ? {
            name: picked.file.name,
            type: picked.file.type || fileCategory(picked.file.name),
            size: picked.file.size,
            dataUrl: local ? picked.dataUrl : undefined,
            blob: local ? undefined : picked.file,
          }
        : null,
    });
    close();
  };

  return (
    <Modal
      open={open}
      title="Add to Knowledge Inbox"
      onClose={close}
      wide
      footer={
        <>
          <GhostButton onClick={close}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={busy || ingesting || (!content.trim() && !picked)}>
            Save to Inbox
          </PrimaryButton>
        </>
      }
    >
      {/* Upload + AI read */}
      <Field
        label="Upload a file (optional)"
        hint="PDF, Word doc, text, or image. The AI reads it and writes a summary below — review and edit before saving."
      >
        <input
          ref={inputRef}
          type="file"
          hidden
          accept=".pdf,.doc,.docx,.txt,.md,.rtf,.csv,.json,.png,.jpg,.jpeg,.gif,.webp,.svg,image/*,application/pdf"
          onChange={onFile}
        />
        {!picked ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={ingesting}
            className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-line py-6 text-center transition hover:border-brand/50 disabled:opacity-60"
          >
            <Icon.Upload width={20} height={20} className="text-ink-faint" />
            <span className="text-sm font-medium text-ink-muted">
              {ingesting ? "Reading & summarizing…" : "Click to upload a file"}
            </span>
            <span className="text-[11px] text-ink-faint">PDF · DOCX · TXT · MD · Images</span>
          </button>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas p-3">
            {picked.dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={picked.dataUrl}
                alt={picked.file.name}
                className="h-11 w-11 shrink-0 rounded-md object-cover"
              />
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-panel-2 text-[10px] font-bold uppercase text-ink-muted">
                {picked.file.name.split(".").pop()?.slice(0, 4)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-ink">{picked.file.name}</div>
              <div className="text-[11px] text-ink-faint">
                {formatBytes(picked.file.size)}
                {ingesting && " · reading…"}
                {!ingesting && picked.engine === "ai" && " · ✦ summarised by AI"}
                {!ingesting && picked.engine === "heuristic" && " · auto-summary"}
                {picked.charCount ? ` · ${picked.charCount.toLocaleString()} chars read` : ""}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setPicked(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
              className="rounded-md p-1.5 text-ink-faint transition hover:text-red-400"
              aria-label="Remove file"
            >
              <Icon.Close width={15} height={15} />
            </button>
          </div>
        )}
        {ingestError && <span className="mt-1 block text-xs text-red-400">{ingestError}</span>}
      </Field>

      <Field label="Type">
        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={
                "rounded-full border px-3 py-1.5 text-xs font-medium transition " +
                (kind === k
                  ? "border-brand bg-brand/15 text-ink"
                  : "border-line text-ink-muted hover:bg-panel-2")
              }
            >
              {KNOWLEDGE_KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Title" hint="Optional — defaults to the type or file name.">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Short title"
          className={inputClass}
        />
      </Field>

      <Field
        label={picked ? "Summary (editable)" : "Content"}
        hint={
          picked
            ? "The AI's summary of your file. Edit anything before saving."
            : "Paste notes, ideas, an AI conversation, a bug report, a brain dump — anything. The AI Analyst reads this."
        }
      >
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          placeholder="What do you want to remember about this project?"
          className={inputClass + " resize-none"}
        />
      </Field>
    </Modal>
  );
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
