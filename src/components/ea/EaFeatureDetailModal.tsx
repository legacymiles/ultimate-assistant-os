"use client";

import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { TagPill } from "./TagPill";
import type { EaFeature } from "@/lib/ea-features/types";

interface Props {
  feature: EaFeature;
  onClose: () => void;
}

export function EaFeatureDetailModal({ feature, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(feature.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-3 sm:p-6"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl animate-fade-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-ink">{feature.title}</h2>
            <p className="mt-1 text-sm text-ink-muted">{feature.summary}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {feature.tags.map((t) => (
                <TagPill key={t} tag={t} />
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-line p-1.5 text-ink-muted transition hover:bg-panel-2 hover:text-ink"
            aria-label="Close"
          >
            <Icon.Close width={16} height={16} />
          </button>
        </div>

        {/* Body — the spec, verbatim and copy-paste ready */}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <pre className="whitespace-pre-wrap break-words rounded-xl border border-line bg-canvas p-4 font-mono text-[13px] leading-relaxed text-ink-muted">
            {feature.body}
          </pre>
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          <button
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-2"
          >
            {copied ? (
              <Icon.Check width={15} height={15} />
            ) : (
              <Icon.Copy width={15} height={15} />
            )}
            {copied ? "Copied!" : "Copy spec"}
          </button>
          <span className="ml-auto text-xs text-ink-faint">Added {feature.addedAt}</span>
        </div>
      </div>
    </div>
  );
}
