"use client";

import { Icon } from "../icons";
import { TagPill } from "./TagPill";
import type { EaFeature } from "@/lib/ea-features/types";

interface Props {
  feature: EaFeature;
  activeTags: string[];
  onOpen: (feature: EaFeature) => void;
  onToggleTag: (tag: string) => void;
}

export function EaFeatureRow({ feature, activeTags, onOpen, onToggleTag }: Props) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(feature)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(feature);
        }
      }}
      className="group flex cursor-pointer items-start gap-4 rounded-2xl border border-line bg-panel px-4 py-3.5 transition hover:border-brand/40 hover:bg-panel-2"
    >
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-ink">{feature.title}</h3>
        <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{feature.summary}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {feature.tags.map((t) => (
            <TagPill
              key={t}
              tag={t}
              active={activeTags.includes(t)}
              onClick={onToggleTag}
            />
          ))}
        </div>
      </div>
      <Icon.Chevron
        width={16}
        height={16}
        className="mt-1 shrink-0 text-ink-faint transition group-hover:text-ink-muted"
      />
    </div>
  );
}
