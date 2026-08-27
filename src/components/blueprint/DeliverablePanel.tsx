"use client";

import Link from "next/link";
import { useState } from "react";
import { copyText, downloadText } from "@/lib/blueprint/client";
import type { Engine } from "@/lib/blueprint/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";

type SaveState = "idle" | "saving" | "saved";

interface Props {
  prompt: string;
  spec: string;
  gauntletText: string;
  engine: Engine;
  filenameBase: string;
  portable: boolean;
  regenerating: boolean;
  onTogglePortable: (next: boolean) => void;
  saveState: SaveState;
  savedProjectId: string | null;
  onSave: () => void;
  onBack: () => void;
}

type Tab = "prompt" | "spec" | "gauntlet";

export function DeliverablePanel({
  prompt,
  spec,
  gauntletText,
  engine,
  filenameBase,
  portable,
  regenerating,
  onTogglePortable,
  saveState,
  savedProjectId,
  onSave,
  onBack,
}: Props) {
  const [tab, setTab] = useState<Tab>("prompt");
  const [copied, setCopied] = useState<Tab | null>(null);

  const textFor = (t: Tab) => (t === "prompt" ? prompt : t === "spec" ? spec : gauntletText);
  const text = textFor(tab);

  const copy = async (which: Tab) => {
    const ok = await copyText(textFor(which));
    if (ok) {
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 1600);
    }
  };

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line p-0.5 text-xs">
          <TabBtn active={tab === "prompt"} onClick={() => setTab("prompt")}>
            Claude Code prompt
          </TabBtn>
          <TabBtn active={tab === "gauntlet"} onClick={() => setTab("gauntlet")}>
            For Gauntlet
          </TabBtn>
          <TabBtn active={tab === "spec"} onClick={() => setTab("spec")}>
            Overview spec
          </TabBtn>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            engine === "ai" ? "bg-brand/15 text-brand" : "bg-panel-2 text-ink-faint",
          )}
        >
          <Icon.Sparkles width={10} height={10} />
          {engine === "ai" ? "AI-written" : "Offline draft"}
        </span>

        {/* Portable toggle — strips references to the user's private skills */}
        <label
          title="Strip references to your private skills and the gauntlet-loop, for a shareable prompt."
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-[10px] font-medium text-ink-muted transition hover:text-ink"
        >
          <input
            type="checkbox"
            checked={portable}
            onChange={(e) => onTogglePortable(e.target.checked)}
            className="h-3 w-3 accent-brand"
          />
          Portable
          {regenerating && <Spinner />}
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => copy(tab)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-2"
          >
            {copied === tab ? <Icon.Check width={13} height={13} /> : <Icon.Copy width={13} height={13} />}
            {copied === tab ? "Copied" : tab === "gauntlet" ? "Copy for Gauntlet" : `Copy ${tab}`}
          </button>
          <button
            onClick={() =>
              downloadText(
                `${filenameBase}-${tab === "prompt" ? "prompt" : tab === "gauntlet" ? "gauntlet" : "overview"}.md`,
                text,
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Download width={13} height={13} />
            Download
          </button>
        </div>
      </div>

      <pre className="max-h-[46vh] overflow-auto rounded-xl border border-line bg-canvas p-4 text-[12.5px] leading-relaxed text-ink-muted">
        <code className="whitespace-pre-wrap break-words">{text}</code>
      </pre>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {saveState === "saved" && savedProjectId ? (
          <Link
            href="/apps/projects-timeline"
            className="inline-flex items-center gap-2 rounded-lg bg-core/15 px-4 py-2 text-sm font-semibold text-core transition hover:bg-core/25"
          >
            <Icon.Check width={15} height={15} />
            Saved — open in Projects Timeline
            <Icon.Launch width={14} height={14} />
          </Link>
        ) : (
          <button
            onClick={onSave}
            disabled={saveState === "saving"}
            className="inline-flex items-center gap-2 rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm font-semibold text-brand transition hover:bg-brand/20 disabled:opacity-50"
          >
            {saveState === "saving" ? <Spinner /> : <Icon.Layers width={15} height={15} />}
            {saveState === "saving" ? "Saving…" : "Save to Projects Timeline"}
          </button>
        )}
        <button
          onClick={onBack}
          className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
        >
          Back to overview
        </button>
        <p className="ml-auto max-w-xs text-right text-[11px] text-ink-faint">
          {tab === "gauntlet"
            ? "Paste into Claude Code — it builds, then runs a Builder-vs-Critic gauntlet against your quality bar until it wins."
            : "Paste the prompt into Claude Code to build it — the overview is saved as a living project with core & supporting features."}
        </p>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 font-medium transition",
        active ? "bg-brand text-white" : "text-ink-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand/40 border-t-brand" />
  );
}
