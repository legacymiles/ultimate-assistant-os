"use client";

import { KIND_LABELS, type BlueprintKind } from "@/lib/blueprint/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";

interface Props {
  idea: string;
  kind: BlueprintKind;
  audience: string;
  onIdea: (v: string) => void;
  onKind: (v: BlueprintKind) => void;
  onAudience: (v: string) => void;
  onClarify: () => void;
  onSkip: () => void;
  loading: boolean;
}

const KINDS: BlueprintKind[] = ["website", "webapp", "workflow"];

export function IntakePanel({
  idea,
  kind,
  audience,
  onIdea,
  onKind,
  onAudience,
  onClarify,
  onSkip,
  loading,
}: Props) {
  const ready = idea.trim().length >= 12;

  return (
    <div className="animate-fade-in space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          What do you want to build?
        </span>
        <textarea
          value={idea}
          onChange={(e) => onIdea(e.target.value)}
          rows={6}
          autoFocus
          placeholder="Describe your idea in plain words. Don't worry about structure — a rough brain-dump is perfect. e.g. “A site for my coffee roastery where people can read our story, browse beans, and subscribe to a monthly bag…”"
          className="w-full resize-none rounded-xl border border-line bg-canvas px-4 py-3 text-sm leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <span className="mt-1 block text-[10px] text-ink-faint">
          {idea.trim().length < 12
            ? "Add a little more so we have something to work with."
            : "Looking good — we'll ask a couple of sharp questions next."}
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Type
          </span>
          <div className="flex rounded-lg border border-line p-0.5 text-xs">
            {KINDS.map((k) => (
              <button
                key={k}
                onClick={() => onKind(k)}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 font-medium transition",
                  kind === k ? "bg-brand text-white" : "text-ink-muted hover:text-ink",
                )}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Who's it for? <span className="text-ink-faint/70">(optional)</span>
          </span>
          <input
            value={audience}
            onChange={(e) => onAudience(e.target.value)}
            placeholder="e.g. small coffee roasters"
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          onClick={onClarify}
          disabled={!ready || loading}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? (
            <Spinner />
          ) : (
            <Icon.Sparkles width={15} height={15} />
          )}
          {loading ? "Thinking…" : "Clarify my idea"}
        </button>
        <button
          onClick={onSkip}
          disabled={!ready || loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          Skip to overview
          <Icon.ArrowRight width={14} height={14} />
        </button>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
  );
}
