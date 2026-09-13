"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import type { AnalyzeResult } from "@/lib/ai-rankings/analyzeLink";

interface Props {
  tree: Record<string, string[]>;
  knownFeatures: string[];
  onResult: (result: AnalyzeResult) => void;
  onClose: () => void;
}

/** Paste a link → the whole entry is filled in and added to the board. */
export function AnalyzeLink({ tree, knownFeatures, onResult, onClose }: Props) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    input.current?.focus();
    // Closing mid-read cancels it, so a dismissed request can't add an entry later.
    return () => abort.current?.abort();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const analyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    try {
      const res = await fetch("/api/ai-rankings/analyze-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, tree, knownFeatures }),
        signal: abort.current.signal,
      });
      const json = (await res.json()) as AnalyzeResult & { error?: string };
      if (!res.ok || json.error || !json.entry) {
        setError(json.error ?? "That link couldn't be analyzed.");
        setBusy(false);
        return;
      }
      onResult(json);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError("Couldn't reach the analyzer — check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[14vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={analyze}
        className="animate-fade-in w-full max-w-md rounded-xl border border-line bg-panel p-4 shadow-2xl"
        role="dialog"
        aria-labelledby="analyze-link-title"
      >
        <div className="mb-1 flex items-center gap-2">
          <Icon.Link width={14} height={14} className="text-brand" />
          <h2 id="analyze-link-title" className="flex-1 text-sm font-semibold text-ink">
            Add from a link
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ink-faint transition hover:bg-panel-2 hover:text-ink"
            aria-label="Close"
          >
            <Icon.Close width={13} height={13} />
          </button>
        </div>
        <p className="mb-3 text-[12px] leading-relaxed text-ink-muted">
          Paste a website, GitHub repo or Hugging Face page. It reads the page and makes the entry —
          name, notes, pricing, open source, hosting and features.
        </p>

        <div className="flex gap-1.5">
          <input
            ref={input}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
            placeholder="https://…"
            inputMode="url"
            className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2.5 py-1.5 font-mono text-[12px] text-ink outline-none focus:border-brand disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-2 disabled:opacity-40"
          >
            <Icon.Sparkles width={12} height={12} />
            {busy ? "Analyzing…" : "Analyze"}
          </button>
        </div>

        {busy && (
          <p className="mt-2.5 animate-pulse font-mono text-[11px] text-ink-faint">
            Reading the page, its code and model links, then filling in the entry…
          </p>
        )}
        {error && <p className="mt-2.5 text-[12px] text-rose-300">{error}</p>}
      </form>
    </div>
  );
}
