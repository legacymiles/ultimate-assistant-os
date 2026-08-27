"use client";

import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { parseSkillFrontmatter } from "@/lib/skills/parse";
import type { Skill, SkillDraft } from "@/lib/skills/types";

interface Props {
  /** null = adding a new skill; a Skill = editing that skill. */
  initial: Skill | null;
  onClose: () => void;
  onSave: (draft: SkillDraft) => Promise<void>;
}

export function SkillEditorModal({ initial, onClose, onSave }: Props) {
  const isEdit = initial !== null;
  const [body, setBody] = useState(initial?.body ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [overview, setOverview] = useState(initial?.overview ?? "");
  // When editing, fields are already authored — don't auto-overwrite them.
  const [titleTouched, setTitleTouched] = useState(isEdit);
  const [overviewTouched, setOverviewTouched] = useState(isEdit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Auto-fill title/overview from frontmatter as the user pastes the markdown,
  // but never clobber fields the user has manually edited.
  const applyBody = (value: string) => {
    setBody(value);
    const parsed = parseSkillFrontmatter(value);
    if (!titleTouched && parsed.title) setTitle(parsed.title);
    if (!overviewTouched && parsed.overview) setOverview(parsed.overview);
  };

  const autofill = () => {
    const parsed = parseSkillFrontmatter(body);
    if (parsed.title) {
      setTitle(parsed.title);
      setTitleTouched(false);
    }
    if (parsed.overview) {
      setOverview(parsed.overview);
      setOverviewTouched(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Give the skill a title.");
      return;
    }
    if (!body.trim()) {
      setError("Paste the skill prompt.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({ title, overview, body });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the skill.");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-3 sm:p-6"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-black/60" />
      <form
        onSubmit={save}
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl animate-fade-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <h2 className="flex-1 text-lg font-semibold text-ink">
            {isEdit ? "Edit skill" : "Add a skill"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line p-1.5 text-ink-muted transition hover:bg-panel-2 hover:text-ink"
            aria-label="Close"
          >
            <Icon.Close width={16} height={16} />
          </button>
        </div>

        {/* Fields */}
        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4">
          <label className="block">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-ink-faint">
                Skill prompt (paste the .md)
              </span>
              <button
                type="button"
                onClick={autofill}
                className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
              >
                <Icon.Sparkles width={12} height={12} />
                Auto-fill title &amp; overview
              </button>
            </div>
            <textarea
              value={body}
              onChange={(e) => applyBody(e.target.value)}
              rows={10}
              placeholder={"---\nname: my-skill\ndescription: What it does\n---\n\n# My Skill\n..."}
              className="w-full resize-y rounded-xl border border-line bg-canvas px-3.5 py-2.5 font-mono text-[13px] leading-relaxed text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-faint">Title</span>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleTouched(true);
              }}
              placeholder="e.g. Interactive Web Studio"
              className="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-faint">
              Quick overview
            </span>
            <textarea
              value={overview}
              onChange={(e) => {
                setOverview(e.target.value);
                setOverviewTouched(true);
              }}
              rows={2}
              placeholder="One line on what this skill is for."
              className="w-full resize-y rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </label>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-line px-3.5 py-2 text-sm font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-2 disabled:opacity-50"
          >
            {busy ? "Saving…" : isEdit ? "Save changes" : "Add skill"}
          </button>
        </div>
      </form>
    </div>
  );
}
