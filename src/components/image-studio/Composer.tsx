"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import type { ImageAgent } from "@/lib/image-studio/agents";
import { imageUrlFromDrop } from "@/lib/image-studio/files";
import { MAX_REFS, type RefRole } from "@/lib/image-studio/prompt";

export interface Ref {
  id: string;
  role: RefRole;
  name: string;
  dataUrl: string;
}

interface Props {
  agent: ImageAgent;
  prompt: string;
  onPrompt: (v: string) => void;
  refs: Ref[];
  onRefs: (refs: Ref[]) => void;
  onFiles: (files: File[]) => void;
  onUrl: (url: string) => void;
  expanded: string | null;
  onExpanded: (v: string | null) => void;
  count: number;
  onCount: (n: number) => void;
  rewriting: boolean;
  onRewrite: () => void;
  onGenerate: () => void;
  error: string;
  notice: string;
}

export function Composer(p: Props) {
  const canGo = !!(p.prompt.trim() || p.expanded?.trim());
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-3.5">
      <div className="flex items-center gap-2">
        <span className="text-lg">{p.agent.icon}</span>
        <span className="text-sm font-semibold text-ink">{p.agent.name}</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {p.agent.examples.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              p.onPrompt(ex);
              p.onExpanded(null);
            }}
            className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          >
            {ex}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-ink-faint">Your prompt</span>
        <textarea
          value={p.prompt}
          onChange={(e) => p.onPrompt(e.target.value)}
          rows={3}
          placeholder="Describe the image you want…"
          className="resize-y rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-[var(--color-brand)]"
        />
      </label>

      <RefTray refs={p.refs} onRefs={p.onRefs} onFiles={p.onFiles} onUrl={p.onUrl} />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={p.onRewrite}
          disabled={!p.prompt.trim() || p.rewriting}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-ink transition hover:bg-panel-2 disabled:opacity-40"
        >
          <Icon.Sparkles width={14} height={14} />
          {p.rewriting ? "Agent is writing…" : p.expanded ? "Rewrite again" : "Rewrite with agent"}
        </button>
      </div>

      {p.expanded !== null && (
        <label className="flex flex-col gap-1">
          <span className="flex items-center justify-between text-[11px] font-medium text-ink-faint">
            Agent&apos;s prompt — edit freely
            <button type="button" onClick={() => p.onExpanded(null)} className="text-ink-faint hover:text-ink">
              Use my prompt instead
            </button>
          </span>
          <textarea
            value={p.expanded}
            onChange={(e) => p.onExpanded(e.target.value)}
            rows={7}
            className="resize-y rounded-lg border border-line bg-panel-2 px-3 py-2 text-[12.5px] leading-relaxed text-ink outline-none focus:border-[var(--color-brand)]"
          />
        </label>
      )}

      <div className="flex items-center gap-2">
        <div className="flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Number of images">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={p.count === n}
              onClick={() => p.onCount(n)}
              className={`h-7 w-7 rounded-md text-xs font-medium transition ${
                p.count === n ? "bg-panel-2 text-ink" : "text-ink-faint hover:text-ink"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={p.onGenerate}
          disabled={!canGo}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          <Icon.Image width={14} height={14} />
          Generate {p.count > 1 ? `${p.count} images` : "image"}
        </button>
      </div>
      {!p.expanded && p.prompt.trim() && (
        <p className="-mt-1 text-[11px] text-ink-faint">Skipping the rewrite adds {p.agent.name}&apos;s house style to your prompt.</p>
      )}

      {p.error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{p.error}</p>}
      {p.notice && !p.error && <p className="rounded-lg bg-panel-2 px-3 py-2 text-[12px] text-ink-muted">{p.notice}</p>}

      <p className="flex items-start gap-1.5 text-[11px] leading-snug text-ink-faint">
        <Icon.Shield width={12} height={12} className="mt-px shrink-0" />
        Only upload photos of yourself or people who agreed to this.
      </p>
    </section>
  );
}

function RefTray({
  refs,
  onRefs,
  onFiles,
  onUrl,
}: {
  refs: Ref[];
  onRefs: (r: Ref[]) => void;
  onFiles: (f: File[]) => void;
  onUrl: (url: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const setRole = (id: string, role: RefRole) => onRefs(refs.map((r) => (r.id === id ? { ...r, role } : r)));

  // Ctrl/Cmd+V a copied image or screenshot anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      // Text pastes carry no files, so typing into the prompt boxes is untouched.
      if (!files.length) return;
      e.preventDefault();
      onFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onFiles]);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) return onFiles(files);
        const url = imageUrlFromDrop(e.dataTransfer.getData("text/uri-list"), e.dataTransfer.getData("text/html"));
        if (url) onUrl(url);
        else onFiles([]);
      }}
      className={`rounded-lg border border-dashed p-2 transition ${dragging ? "border-[var(--color-brand)] bg-panel-2" : "border-line"}`}
    >
      <div className="mb-1.5 flex items-center justify-between px-0.5">
        <span className="text-[11px] font-medium text-ink-faint">
          Reference photos {refs.length ? `(${refs.length}/${MAX_REFS})` : ""}
        </span>
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={refs.length >= MAX_REFS}
          className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink disabled:opacity-40"
        >
          <Icon.Upload width={12} height={12} /> Add
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            onFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {refs.length === 0 ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="w-full rounded-md py-4 text-center text-[12px] text-ink-faint hover:text-ink-muted"
        >
          Click to add, drop photos here, or paste a screenshot — then tag each as a Person or a Style
        </button>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {refs.map((r) => (
            <div key={r.id} className="overflow-hidden rounded-md border border-line bg-panel-2">
              <div className="relative aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.dataUrl} alt={r.name} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => onRefs(refs.filter((x) => x.id !== r.id))}
                  aria-label={`Remove ${r.name}`}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                >
                  <Icon.Close width={10} height={10} />
                </button>
              </div>
              <div className="flex text-[10px] font-medium">
                {(["person", "style"] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setRole(r.id, role)}
                    aria-pressed={r.role === role}
                    className={`flex-1 py-1 capitalize transition ${
                      r.role === role ? "bg-[var(--color-brand)] text-white" : "text-ink-faint hover:text-ink"
                    }`}
                  >
                    {role}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
