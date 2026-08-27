"use client";

import { useState } from "react";
import { copyText, downloadText } from "@/lib/soundprint/client";
import { PLATFORMS } from "@/lib/soundprint/platforms";
import { swapNotice } from "@/lib/soundprint/performers";
import { promptsToMarkdown } from "@/lib/soundprint/prompt-template";
import type { AnalysisResult } from "@/lib/soundprint/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";
import { SunoStudio } from "./SunoStudio";

export function ResultPanel({ result }: { result: AnalysisResult }) {
  const { breakdown, prompts, performers, engine, notice } = result;
  const platform = PLATFORMS[prompts.platform];

  return (
    <div className="animate-fade-in space-y-3">
      {/* Engine + download */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            engine === "ai" ? "bg-core/15 text-core" : "bg-panel-2 text-ink-faint",
          )}
        >
          <Icon.Sparkles width={10} height={10} />
          {engine === "ai" ? "AI breakdown" : "Offline draft"}
        </span>
        <button
          onClick={() =>
            downloadText(
              `${slug(prompts.title) || "soundprint"}.md`,
              promptsToMarkdown(prompts, breakdown),
            )
          }
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
        >
          <Icon.Download width={12} height={12} />
          Download
        </button>
      </div>

      {notice && (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
          {notice}
        </p>
      )}

      {/* Performer swaps */}
      {performers.length > 0 && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Icon.Mic width={12} height={12} className="text-amber-300" />
            <span className="text-[11px] font-semibold text-amber-200">
              {swapNotice(performers.length)}
            </span>
          </div>
          <ul className="space-y-1.5">
            {performers.map((p) => (
              <li key={p.name} className="text-[11px] leading-relaxed text-ink-muted">
                <span className="font-semibold text-ink">{p.name}</span> → {p.profile}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Understanding */}
      {breakdown.understood && (
        <p className="rounded-lg border border-line bg-panel-2/50 px-3 py-2 text-xs italic leading-relaxed text-ink-muted">
          {breakdown.understood}
        </p>
      )}

      {/* The two prompts — the whole point */}
      <PromptBox
        label={platform.styleFieldName}
        badge="Prompt 1"
        text={prompts.style}
        mono
      />

      {prompts.exclude && (
        <PromptBox label="Exclude Styles" badge="Keeps the beat out" text={prompts.exclude} mono />
      )}

      <PromptBox label={platform.lyricsFieldName} badge="Prompt 2" text={prompts.lyrics} />

      {/* Create on Suno, then paste the link to play the real track */}
      <SunoStudio prompts={prompts} />

      {/* Breakdown */}
      <details className="group rounded-xl border border-line bg-panel" open>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
          <Icon.Layers width={13} height={13} className="text-ink-faint" />
          <span className="text-xs font-semibold text-ink">Style breakdown</span>
          <Icon.Chevron
            width={11}
            height={11}
            className="ml-auto text-ink-faint transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="space-y-2.5 border-t border-line px-3 py-3">
          <Chips label="Genres" items={breakdown.genres} tone="brand" />
          <Chips label="Mood" items={breakdown.moods} tone="support" />
          <Row label="Tempo" value={breakdown.tempo} />
          <Row label="Key" value={breakdown.key} />
          <Chips label="Instrumentation" items={breakdown.instrumentation} />
          <Chips label="Production" items={breakdown.production} />
          <Row label="Structure" value={breakdown.structure} />
          <Row label="Era" value={breakdown.era} />

          {breakdown.vocal && (
            <>
              <Row label="Voice" value={breakdown.vocal.range} />
              <Chips label="Texture" items={breakdown.vocal.texture} />
              <Chips label="Delivery" items={breakdown.vocal.delivery} />
              <Chips label="Treatment" items={breakdown.vocal.effects} />
            </>
          )}

          <Chips label="Adjacent" items={breakdown.adjacent} />
          <Chips label="Avoid" items={breakdown.avoid} tone="danger" />
        </div>
      </details>

      {/* How to use it */}
      {prompts.notes.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-line bg-panel-2/40 p-3 text-[11px] leading-relaxed text-ink-muted">
          {prompts.notes.map((n, i) => (
            <li key={i}>· {n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PromptBox({
  label,
  badge,
  text,
  mono,
}: {
  label: string;
  badge: string;
  text: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-xs font-semibold text-ink">{label}</span>
        <span className="rounded-md bg-panel-2 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-faint">
          {badge}
        </span>
        <span className="ml-auto text-[10px] text-ink-faint">{text.length} chars</span>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-brand-2"
        >
          {copied ? <Icon.Check width={11} height={11} /> : <Icon.Copy width={11} height={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className={cn(
          "max-h-64 overflow-auto px-3 py-2.5 text-[12px] leading-relaxed text-ink-muted",
          mono ? "font-mono" : "font-sans",
        )}
      >
        <code className="whitespace-pre-wrap break-words">{text}</code>
      </pre>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-[11px]">
      <span className="w-24 shrink-0 text-ink-faint">{label}</span>
      <span className="text-ink-muted">{value}</span>
    </div>
  );
}

function Chips({
  label,
  items,
  tone = "neutral",
}: {
  label: string;
  items: string[];
  tone?: "neutral" | "brand" | "support" | "danger";
}) {
  if (!items.length) return null;
  const toneCls = {
    neutral: "border-line bg-panel-2 text-ink-muted",
    brand: "border-brand/40 bg-brand/10 text-brand",
    support: "border-support/40 bg-support/10 text-support",
    danger: "border-red-500/30 bg-red-500/10 text-red-300",
  }[tone];

  return (
    <div className="flex gap-2 text-[11px]">
      <span className="w-24 shrink-0 pt-0.5 text-ink-faint">{label}</span>
      <div className="flex flex-wrap gap-1">
        {items.map((i) => (
          <span key={i} className={cn("rounded-full border px-1.5 py-0.5", toneCls)}>
            {i}
          </span>
        ))}
      </div>
    </div>
  );
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
