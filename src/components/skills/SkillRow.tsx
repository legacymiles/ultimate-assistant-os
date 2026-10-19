"use client";

import { useState } from "react";
import { Icon } from "../icons";
import type { Skill } from "@/lib/skills/types";
import { skillMeta } from "@/lib/skills/categories";
import { addedLabel } from "@/lib/skills/sort";

interface Props {
  skill: Skill;
  onOpen: (skill: Skill) => void;
  onEdit: (skill: Skill) => void;
  onDelete: (skill: Skill) => void;
  favorite?: boolean;
  onToggleFavorite?: (skill: Skill) => void;
}

export function SkillRow({ skill, onOpen, onEdit, onDelete, favorite = false, onToggleFavorite }: Props) {
  const meta = skillMeta(skill);
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
      {onToggleFavorite && <FavoriteStar skill={skill} on={favorite} onToggle={onToggleFavorite} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-ink">{skill.title}</h3>
          {skill.origin && <OriginBadge origin={skill.origin} />}
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">
          {skill.overview || "No overview yet."}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[10.5px] text-ink">{meta.command}</code>
          {meta.categories.map((c) => (
            <span
              key={c}
              title={meta.guessed ? "Best guess — add a category to the skill to set it" : undefined}
              className={"rounded-md border px-1.5 py-0.5 text-[10px] " + (meta.guessed ? "border-dashed border-line text-ink-faint" : "border-brand/30 text-brand")}
            >
              {c}
            </span>
          ))}
          {meta.nicknames.slice(0, 4).map((n) => (
            <span key={n} className="rounded-full bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-muted">
              “{n}”
            </span>
          ))}
          {meta.nicknames.length > 4 && <span className="text-[10px] text-ink-faint">+{meta.nicknames.length - 4}</span>}
          {addedLabel(skill.createdAt) && (
            <time dateTime={skill.createdAt} title={new Date(skill.createdAt).toLocaleString()} className="ml-auto pl-1 text-[10px] text-ink-faint">
              {addedLabel(skill.createdAt)}
            </time>
          )}
        </div>
      </div>

      {/* Row actions — hidden until hover/focus on wide screens. Every skill can
          be edited: a built-in is a file, so editing one writes an editable copy
          that takes its place. Only that copy can be deleted, which restores the
          original — the built-in itself has nothing to delete. */}
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
        {skill.source !== "featured" && skill.source !== "studio" && (
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
        )}
      </div>
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

/**
 * The favorite star. Tapping it is the only way into Favorites; a lit star
 * glows, and pops once when tapped. The row itself never moves — a starred
 * skill stays where it was in the list and also appears in Favorites.
 */
export function FavoriteStar({
  skill,
  on,
  onToggle,
  size = 17,
  label,
}: {
  skill: Skill;
  on: boolean;
  onToggle: (skill: Skill) => void;
  size?: number;
  /** Shown next to the star (the detail view uses it). */
  label?: string;
}) {
  const [pop, setPop] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle(skill);
        setPop(true);
        window.setTimeout(() => setPop(false), 380);
      }}
      aria-pressed={on}
      aria-label={on ? `Remove ${skill.title} from favorites` : `Add ${skill.title} to favorites`}
      title={on ? "In your favorites — tap to remove" : "Add to favorites"}
      className={
        "inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg p-1.5 text-xs font-medium transition-colors " +
        (on ? "text-amber-400 hover:text-amber-300" : "text-ink-faint hover:text-amber-400")
      }
    >
      <Icon.Star
        width={size}
        height={size}
        fill={on ? "currentColor" : "none"}
        style={{
          transition: "transform 220ms cubic-bezier(.3,1.6,.5,1), filter 220ms ease",
          transform: pop ? "scale(1.45)" : "scale(1)",
          filter: on
            ? `drop-shadow(0 0 ${pop ? 10 : 5}px rgb(251 191 36 / ${pop ? 1 : 0.75}))`
            : "none",
        }}
      />
      {label && <span>{label}</span>}
    </button>
  );
}
