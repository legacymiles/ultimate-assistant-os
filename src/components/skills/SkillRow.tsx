"use client";

import { Icon } from "../icons";
import type { Skill } from "@/lib/skills/types";

interface Props {
  skill: Skill;
  onOpen: (skill: Skill) => void;
  onEdit: (skill: Skill) => void;
  onDelete: (skill: Skill) => void;
}

export function SkillRow({ skill, onOpen, onEdit, onDelete }: Props) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(skill)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(skill);
        }
      }}
      className="group flex cursor-pointer items-center gap-4 rounded-2xl border border-line bg-panel px-4 py-3.5 transition hover:border-brand/40 hover:bg-panel-2"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-ink">{skill.title}</h3>
          {skill.origin && <OriginBadge origin={skill.origin} />}
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">
          {skill.overview || "No overview yet."}
        </p>
      </div>

      {/* Row actions — hidden until hover/focus on wide screens. Featured
          skills are built into the app, so they can't be edited or deleted. */}
      {skill.source !== "featured" && (
        <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(skill);
            }}
            className="rounded-lg border border-line p-1.5 text-ink-muted transition hover:bg-elevated hover:text-ink"
            aria-label={`Edit ${skill.title}`}
          >
            <Icon.Edit width={15} height={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(skill);
            }}
            className="rounded-lg border border-line p-1.5 text-ink-muted transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400"
            aria-label={`Delete ${skill.title}`}
          >
            <Icon.Trash width={15} height={15} />
          </button>
        </div>
      )}
      <Icon.Chevron
        width={16}
        height={16}
        className="shrink-0 text-ink-faint transition group-hover:text-ink-muted"
      />
    </div>
  );
}

/** Small pill showing where a synced skill came from. "Personal" is accented. */
export function OriginBadge({ origin }: { origin: string }) {
  const personal = origin === "Personal";
  return (
    <span
      className={
        "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
        (personal ? "bg-brand/15 text-brand" : "bg-elevated text-ink-faint")
      }
    >
      {origin}
    </span>
  );
}
