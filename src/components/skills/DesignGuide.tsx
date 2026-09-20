"use client";

import { useState } from "react";
import { Icon } from "../icons";
import type { Skill } from "@/lib/skills/types";
import { DESIGN_GUIDE, GUIDE_KIND_LABEL, type GuideKind } from "@/lib/skills/design-guide";

const KIND_STYLE: Record<GuideKind, string> = {
  yours: "bg-panel-2 text-ink-muted",
  anthropic: "bg-brand/15 text-brand",
  recommended: "bg-amber-500/15 text-amber-400",
};

/** Collapsible "which web design skill?" guide: one paragraph per skill. */
export function DesignGuide({
  skills,
  onOpen,
}: {
  skills: Skill[];
  onOpen: (skill: Skill) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const bySlug = new Map(skills.filter((s) => s.slug).map((s) => [s.slug as string, s]));

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked; command is still visible */
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-line bg-panel">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <Icon.Chevron
          width={14}
          height={14}
          className={"shrink-0 text-ink-faint transition " + (open ? "rotate-90" : "")}
        />
        <span className="text-sm font-semibold text-ink">Web design guide</span>
        <span className="text-xs text-ink-faint">
          which skill to use, and what each one is for · {DESIGN_GUIDE.length}
        </span>
      </button>

      {open && (
        <div className="divide-y divide-line border-t border-line">
          {DESIGN_GUIDE.map((g) => {
            const skill = bySlug.get(g.slug);
            return (
              <div key={g.slug} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-[13px] font-semibold text-ink">{g.name}</span>
                  <span
                    className={
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
                      KIND_STYLE[g.kind]
                    }
                  >
                    {GUIDE_KIND_LABEL[g.kind]}
                  </span>
                  <span className="text-xs text-ink-faint">{g.bestFor}</span>
                  <span className="ml-auto flex items-center gap-1.5">
                    {skill ? (
                      <button
                        onClick={() => onOpen(skill)}
                        className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink-muted hover:bg-panel-2 hover:text-ink"
                      >
                        Open
                      </button>
                    ) : (
                      g.install && (
                        <button
                          onClick={() => copy(g.install!)}
                          title={g.install}
                          className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink-muted hover:bg-panel-2 hover:text-ink"
                        >
                          {copied === g.install ? "Copied" : "Copy install"}
                        </button>
                      )
                    )}
                    {g.url && !skill && (
                      <a
                        href={g.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink-muted hover:bg-panel-2 hover:text-ink"
                      >
                        GitHub
                      </a>
                    )}
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{g.paragraph}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
