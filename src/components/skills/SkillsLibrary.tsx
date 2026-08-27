"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import {
  createSkill,
  deleteSkill,
  isCloudBacked,
  listSkills,
  syncFromClaudeCode,
  updateSkill,
} from "@/lib/skills/store";
import type { Skill, SkillDraft } from "@/lib/skills/types";
import { categoriesIn, categoryFor } from "@/lib/skills/categories";
import { SkillRow } from "./SkillRow";
import { SkillDetailModal } from "./SkillDetailModal";
import { SkillEditorModal } from "./SkillEditorModal";

type EditorState = { mode: "add" } | { mode: "edit"; skill: Skill } | null;
type SyncMsg = { kind: "ok" | "info" | "error"; text: string } | null;

/** Sort: featured, then hand-added (newest), then Personal, then plugins A–Z. */
function sortSkills(list: Skill[]): Skill[] {
  const rank = (s: Skill) =>
    s.source === "featured" ? 0 : s.source === "manual" ? 1 : s.origin === "Personal" ? 2 : 3;
  return [...list].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    if (rank(a) <= 1) return b.createdAt.localeCompare(a.createdAt);
    const o = (a.origin ?? "").localeCompare(b.origin ?? "");
    return o !== 0 ? o : a.title.localeCompare(b.title);
  });
}

export function SkillsLibrary() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [origin, setOrigin] = useState<string>("all");
  const [detail, setDetail] = useState<Skill | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [local, setLocal] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<SyncMsg>(null);

  const runSync = useCallback(async (auto = false) => {
    setSyncing(true);
    if (!auto) setSyncMsg(null);
    const res = await syncFromClaudeCode();
    if (res.count > 0) {
      try {
        setSkills(await listSkills());
      } catch {
        /* keep current list */
      }
    }
    setSyncing(false);
    if (res.error) setSyncMsg({ kind: "error", text: res.error });
    else if (!res.available)
      setSyncMsg(
        auto
          ? null
          : {
              kind: "info",
              text: "No Claude Code skills found on this server. Sync runs from your own machine (local dev).",
            },
      );
    else
      setSyncMsg({
        kind: "ok",
        text: `Synced ${res.count} skill${res.count === 1 ? "" : "s"} from Claude Code.`,
      });
  }, []);

  useEffect(() => {
    setLocal(!isCloudBacked());
    let mounted = true;
    (async () => {
      try {
        const initial = await listSkills();
        if (mounted) setSkills(initial);
      } catch (err) {
        if (mounted)
          setLoadError(err instanceof Error ? err.message : "Could not load skills.");
      } finally {
        if (mounted) setLoading(false);
      }
      if (mounted) await runSync(true); // auto-sync on open
    })();
    return () => {
      mounted = false;
    };
  }, [runSync]);

  // Auto-dismiss success/info messages.
  useEffect(() => {
    if (syncMsg && syncMsg.kind !== "error") {
      const t = setTimeout(() => setSyncMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, [syncMsg]);

  const origins = useMemo(() => {
    const set = new Set<string>();
    for (const s of skills) if (s.origin) set.add(s.origin);
    const list = Array.from(set);
    list.sort((a, b) =>
      a === "Personal" ? -1 : b === "Personal" ? 1 : a.localeCompare(b),
    );
    return list;
  }, [skills]);

  const categories = useMemo(() => categoriesIn(skills), [skills]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = skills.filter((s) => {
      if (category !== "all" && categoryFor(s) !== category) return false;
      if (origin !== "all" && s.origin !== origin) return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) || s.overview.toLowerCase().includes(q)
      );
    });
    return sortSkills(list);
  }, [skills, query, category, origin]);

  const handleSave = async (draft: SkillDraft) => {
    if (editor?.mode === "edit") {
      const updated = await updateSkill(editor.skill.id, draft);
      setSkills((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setDetail((d) => (d && d.id === updated.id ? updated : d));
    } else {
      const created = await createSkill(draft);
      setSkills((prev) => [created, ...prev]);
    }
    setEditor(null);
  };

  const handleDelete = async (skill: Skill) => {
    if (!window.confirm(`Delete “${skill.title}”? This can’t be undone.`)) return;
    await deleteSkill(skill.id);
    setSkills((prev) => prev.filter((s) => s.id !== skill.id));
    setDetail((d) => (d && d.id === skill.id ? null : d));
  };

  return (
    <div className="min-h-dvh">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2.5 sm:px-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          aria-label="Back to hub"
        >
          <Icon.ArrowLeft width={14} height={14} />
          <span className="hidden sm:inline">Hub</span>
        </Link>
        <span className="ml-1 text-sm font-semibold text-ink">Skills Library</span>
        {local && (
          <span className="ml-2 rounded-md bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand">
            Local mode
          </span>
        )}
      </div>

      <div className="mx-auto max-w-3xl px-3 py-5 sm:px-5 sm:py-8">
        {/* Heading */}
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-ink">My Skills</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Your Claude Code skills, synced and searchable. Click a skill to read and copy
            the full prompt.
          </p>
        </div>

        {/* Search + sync + add */}
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Icon.Search
              width={16}
              height={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search skills by name…"
              className="w-full rounded-xl border border-line bg-panel py-2.5 pl-9 pr-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <button
            onClick={() => runSync(false)}
            disabled={syncing}
            title="Sync skills from your Claude Code folder"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-line px-3 py-2.5 text-sm font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50"
          >
            <Icon.Refresh
              width={16}
              height={16}
              className={syncing ? "animate-spin" : ""}
            />
            <span className="hidden sm:inline">{syncing ? "Syncing…" : "Sync"}</span>
          </button>
          <button
            onClick={() => setEditor({ mode: "add" })}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2"
          >
            <Icon.Plus width={16} height={16} />
            <span className="hidden sm:inline">Add skill</span>
          </button>
        </div>

        {/* Sync status */}
        {syncMsg && (
          <p
            className={
              "mb-3 text-xs " +
              (syncMsg.kind === "error"
                ? "text-red-400"
                : syncMsg.kind === "ok"
                  ? "text-core"
                  : "text-ink-muted")
            }
          >
            {syncMsg.text}
          </p>
        )}

        {/* Category filter */}
        {categories.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
              Category
            </span>
            <FilterChip
              label="All"
              active={category === "all"}
              onClick={() => setCategory("all")}
            />
            {categories.map((c) => (
              <FilterChip
                key={c}
                label={c}
                active={category === c}
                onClick={() => setCategory(c)}
              />
            ))}
          </div>
        )}

        {/* Origin (source) filter */}
        {origins.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
              Source
            </span>
            <FilterChip
              label="All"
              active={origin === "all"}
              onClick={() => setOrigin("all")}
            />
            {origins.map((o) => (
              <FilterChip
                key={o}
                label={o}
                active={origin === o}
                onClick={() => setOrigin(o)}
              />
            ))}
          </div>
        )}

        {/* List */}
        {loading ? (
          <p className="py-16 text-center text-sm text-ink-muted">Loading skills…</p>
        ) : loadError ? (
          <p className="py-16 text-center text-sm text-red-400">{loadError}</p>
        ) : skills.length === 0 ? (
          <EmptyState onAdd={() => setEditor({ mode: "add" })} syncing={syncing} />
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-ink-muted">
            No skills match your filters.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-ink-faint">
              {filtered.length} {filtered.length === 1 ? "skill" : "skills"}
            </p>
            <div className="space-y-2.5">
              {filtered.map((skill) => (
                <SkillRow
                  key={skill.id}
                  skill={skill}
                  onOpen={setDetail}
                  onEdit={(s) => setEditor({ mode: "edit", skill: s })}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      {detail && (
        <SkillDetailModal
          skill={detail}
          onClose={() => setDetail(null)}
          onEdit={(s) => {
            setDetail(null);
            setEditor({ mode: "edit", skill: s });
          }}
          onDelete={handleDelete}
        />
      )}
      {editor && (
        <SkillEditorModal
          initial={editor.mode === "edit" ? editor.skill : null}
          onClose={() => setEditor(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-full border px-2.5 py-1 text-xs font-medium transition " +
        (active
          ? "border-brand bg-brand/15 text-brand"
          : "border-line text-ink-muted hover:bg-panel-2 hover:text-ink")
      }
    >
      {label}
    </button>
  );
}

function EmptyState({ onAdd, syncing }: { onAdd: () => void; syncing: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-panel/50 py-16 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/15 text-brand">
        <Icon.Sparkles width={22} height={22} />
      </div>
      <h3 className="text-sm font-semibold text-ink">
        {syncing ? "Syncing your skills…" : "No skills yet"}
      </h3>
      <p className="mx-auto mt-1 max-w-xs text-xs text-ink-muted">
        {syncing
          ? "Reading your Claude Code skill files."
          : "Your Claude Code skills sync in automatically. You can also add one by hand by pasting its markdown."}
      </p>
      <button
        onClick={onAdd}
        className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2"
      >
        <Icon.Plus width={16} height={16} />
        Add a skill
      </button>
    </div>
  );
}
