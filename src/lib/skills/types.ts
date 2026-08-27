// ---------------------------------------------------------------------------
// Skills Library — shared types.
// A "skill" is a saved markdown prompt with a searchable title + overview.
// Skills are either added by hand (source: "manual") or mirrored from the
// user's Claude Code skill files (source: "claude-code").
// ---------------------------------------------------------------------------

export type SkillSource = "manual" | "claude-code" | "featured";

export interface Skill {
  id: string;
  title: string;
  /** Short one-line description shown in the row. */
  overview: string;
  /** The full markdown skill prompt. */
  body: string;
  /**
   * Where the skill came from. Manual skills are never overwritten by sync.
   * "featured" skills are built into the app (read-only) and always present.
   */
  source: SkillSource;
  /** Stable key for synced skills (folder name or "plugin:name"); null for manual. */
  slug: string | null;
  /** Human label for the source, e.g. "Personal", "superpowers", "vercel". */
  origin: string | null;
  /** Optional link to where the skill lives (e.g. a GitHub repo). */
  sourceUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The editable fields when adding or updating a skill by hand. */
export interface SkillDraft {
  title: string;
  overview: string;
  body: string;
}

/** A skill discovered on disk by the /api/skills/scan route. */
export interface ScannedSkill {
  /** Unique per user: personal folder name, or "plugin:skill" for plugins. */
  slug: string;
  /** "Personal" for the user's own skills, otherwise the plugin name. */
  origin: string;
  title: string;
  overview: string;
  body: string;
}
