"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import {
  createSkill,
  forkSkill,
  isBuiltIn,
  deleteSkill,
  isCloudBacked,
  listSkills,
  syncFromClaudeCode,
  updateSkill,
} from "@/lib/skills/store";
import type { Skill, SkillDraft } from "@/lib/skills/types";
import { categoriesIn, matchesQuery, nicknameClashes, skillMeta } from "@/lib/skills/categories";
import { SkillRow } from "./SkillRow";
import { ADDED, SORTS, addedWithin, isAdded, isSort, sortSkills, type AddedWithin, type SkillSort } from "@/lib/skills/sort";
import { useFavorites } from "@/lib/skills/favorites";
import { SkillDetailModal } from "./SkillDetailModal";
import { SkillEditorModal } from "./SkillEditorModal";
import { DesignGuide } from "./DesignGuide";
import {
  USAGE_FILTERS,
  byMostUsed,
  callsLabel,
  filterByUsage,
  isUsageFilter,
  usageFor,
  type UsageFilter,
} from "@/lib/skills/usage";
import { useSkillUsage } from "@/lib/skills/useSkillUsage";

type EditorState = { mode: "add" } | { mode: "edit"; skill: Skill } | null;
type SyncMsg = { kind: "ok" | "info" | "error"; text: string } | null;

const SORT_KEY = "skills-library:sort:v1";

type View = { sort: SkillSort; added: AddedWithin; usage: UsageFilter };

/** The last sort, "Added" window and usage filter this browser used, if it saved them. */
function readView(): View {
  try {
    const raw = JSON.parse(localStorage.getItem(SORT_KEY) ?? "{}") as { sort?: unknown; added?: unknown; usage?: unknown };
    return {
      sort: isSort(raw.sort) ? raw.sort : "recommended",
      added: isAdded(raw.added) ? raw.added : "any",
      usage: isUsageFilter(raw.usage) ? raw.usage : "any",
    };
  } catch {
    return { sort: "recommended", added: "any", usage: "any" };
  }
}

/** `chromeless` drops the Hub bar when the library is a tab inside Jarvis. */
export function SkillsLibrary({ chromeless = false }: { chromeless?: boolean } = {}) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  // "favorites" is the owner's folder of starred skills; stars sync across devices.
  const [view, setView] = useState<"all" | "favorites">("all");
  const fav = useFavorites();
  const [origin, setOrigin] = useState<string>("all");
  const [sort, setSort] = useState<SkillSort>("recommended");
  const [added, setAdded] = useState<AddedWithin>("any");
  // How often each skill was called (Claude Code, the connector, Jarvis Studio).
  const [usageFilter, setUsageFilter] = useState<UsageFilter>("any");
  const { usage, loaded: usageLoaded, reason: usageReason } = useSkillUsage();
  // Restore after mount so the server render and the first client render agree.
  useEffect(() => {
    const v = readView();
    setSort(v.sort);
    setAdded(v.added);
    setUsageFilter(v.usage);
  }, []);
  const pickView = (next: Partial<View>) => {
    const v: View = { sort: next.sort ?? sort, added: next.added ?? added, usage: next.usage ?? usageFilter };
    setSort(v.sort);
    setAdded(v.added);
    setUsageFilter(v.usage);
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify(v));
    } catch {
      /* private window: the choice just isn't remembered */
    }
  };
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
  // Two skills answering to the same nickname is the confusion nicknames are
  // meant to prevent, so the library says so instead of letting Claude guess.
  const clashes = useMemo(() => [...nicknameClashes(skills).entries()], [skills]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = skills.filter((s) => {
      if (view === "favorites" && !fav.has(s)) return false;
      if (category !== "all" && !skillMeta(s).categories.includes(category)) return false;
      if (origin !== "all" && s.origin !== origin) return false;
      if (!addedWithin(s, added)) return false;
      return matchesQuery(s, q);
    });
    // "Top 10" is a ranking, so it keeps its own most-used order.
    if (usageFilter === "top") return filterByUsage(list, "top", usage);
    return sortSkills(filterByUsage(list, usageFilter, usage), sort, usage);
  }, [skills, query, category, origin, view, fav, sort, added, usageFilter, usage]);

  // Place among ALL skills by calls, so the #1–#3 badges mean the same thing
  // whatever filter is on.
  const ranks = useMemo(() => {
    const m = new Map<string, number>();
    if (!usage) return m;
    byMostUsed(skills, usage)
      .filter((s) => usageFor(s, usage))
      .forEach((s, i) => m.set(s.id, i + 1));
    return m;
  }, [skills, usage]);
  const usageCounts = useMemo(() => {
    const used = ranks.size;
    const calls = skills.reduce((n, s) => n + (usageFor(s, usage)?.count ?? 0), 0);
    return { used, unused: skills.length - used, calls, top: Math.min(10, used) };
  }, [skills, usage, ranks]);

  const handleSave = async (draft: SkillDraft) => {
    if (editor?.mode === "edit" && isBuiltIn(editor.skill)) {
      // A built-in is a file, so editing it writes an editable copy that takes
      // its place. Swap the row rather than appending, or both would show until
      // the next load.
      const fork = await forkSkill(editor.skill, draft);
      setSkills((prev) => prev.map((s) => (s.id === editor.skill.id ? fork : s)));
      setDetail((d) => (d && d.id === editor.skill.id ? fork : d));
    } else if (editor?.mode === "edit") {
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
    // A skill carrying a built-in slug is an edited copy: deleting it restores
    // the original rather than losing anything, and the wording should say so.
    const isCopy = Boolean(skill.slug?.startsWith("studio:")) || Boolean(skill.slug?.startsWith("github:"));
    const message = isCopy
      ? `Discard your edits to “${skill.title}”? The built-in version comes back.`
      : `Delete “${skill.title}”? This can’t be undone.`;
    if (!window.confirm(message)) return;
    await deleteSkill(skill.id);
    setSkills((prev) => prev.filter((s) => s.id !== skill.id));
    setDetail((d) => (d && d.id === skill.id ? null : d));
    // The built-in reappears from the merge on the next load.
    if (isCopy) {
      try {
        setSkills(await listSkills());
      } catch {
        /* the built-in returns on the next load */
      }
    }
  };

  return (
    <div className={chromeless ? "" : "min-h-dvh"}>
      {/* Top bar */}
      {!chromeless && (
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
      )}

      <div className="mx-auto max-w-3xl px-3 py-5 sm:px-5 sm:py-8">
        {/* Heading */}
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-ink">My Skills</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Your Claude Code skills, synced and searchable by name, nickname or category. Click a
            skill to see how to call it and read the full prompt.
          </p>
        </div>

        {/* All / Favorites — the owner's starred skills in one place */}
        <div className="mb-3 flex gap-1 rounded-xl border border-line bg-panel p-1" role="tablist" aria-label="Which skills">
          {(
            [
              { id: "all", label: "All skills", n: skills.length },
              { id: "favorites", label: "★ Favorites", n: fav.count },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={view === t.id}
              onClick={() => setView(t.id)}
              className={
                "flex-1 rounded-lg px-3 py-2 text-sm font-medium transition " +
                (view === t.id ? "bg-brand/15 text-brand" : "text-ink-muted hover:bg-panel-2 hover:text-ink")
              }
            >
              {t.label} <span className="font-mono text-xs opacity-70">{t.n}</span>
            </button>
          ))}
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
              placeholder="Search by name, nickname or category…"
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

        {/* Category filter — always on screen: pinned while you scroll, every
            standard category listed (even empty) so the chips never move. */}
        <div className="sticky top-0 z-10 -mx-3 mb-2 border-b border-line bg-canvas/95 px-3 py-2 backdrop-blur sm:-mx-5 sm:px-5">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin] sm:flex-wrap sm:overflow-visible">
            <span className="mr-1 shrink-0 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
              Category
            </span>
            <FilterChip label="All" active={category === "all"} onClick={() => setCategory("all")} />
            {categories.map((c) => (
              <FilterChip
                key={c.name}
                label={`${c.name} ${c.count}`}
                active={category === c.name}
                dim={c.count === 0}
                onClick={() => setCategory(c.name)}
              />
            ))}
          </div>
        </div>

        {clashes.length > 0 && (
          <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Same nickname on more than one skill — Claude may pick the wrong one:{" "}
            {clashes.slice(0, 4).map(([n, owners]) => `“${n}” (${owners.join(", ")})`).join(" · ")}
            {clashes.length > 4 ? ` · +${clashes.length - 4} more` : ""}. Edit one so each nickname belongs to one skill.
          </p>
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

        {/* Sort + when it was added */}
        <div className="mb-2 flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin] sm:flex-wrap sm:overflow-visible">
          <span className="mr-1 shrink-0 text-[11px] font-medium uppercase tracking-wider text-ink-faint">Sort</span>
          {SORTS.map((o) => (
            <FilterChip key={o.id} label={o.label} active={sort === o.id} onClick={() => pickView({ sort: o.id })} />
          ))}
        </div>
        <div className="mb-4 flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin] sm:flex-wrap sm:overflow-visible">
          <span className="mr-1 shrink-0 text-[11px] font-medium uppercase tracking-wider text-ink-faint">Added</span>
          {ADDED.map((o) => (
            <FilterChip key={o.id} label={o.label} active={added === o.id} onClick={() => pickView({ added: o.id })} />
          ))}
        </div>

        {/* How often each skill gets called — most used, never used */}
        <div className="mb-1 flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin] sm:flex-wrap sm:overflow-visible">
          <span className="mr-1 shrink-0 text-[11px] font-medium uppercase tracking-wider text-ink-faint">Usage</span>
          {USAGE_FILTERS.map((o) => {
            const n = o.id === "used" ? usageCounts.used : o.id === "unused" ? usageCounts.unused : o.id === "top" ? usageCounts.top : null;
            return (
              <FilterChip
                key={o.id}
                label={n === null || !usage ? o.label : `${o.label} ${n}`}
                active={usageFilter === o.id}
                dim={Boolean(usage) && n === 0}
                onClick={() => pickView({ usage: o.id })}
              />
            );
          })}
        </div>
        <p className="mb-4 text-[11px] text-ink-faint">
          {!usageLoaded
            ? "Counting skill calls…"
            : usage
              ? usageCounts.calls > 0
                ? `${callsLabel(usageCounts.calls)} across ${usageCounts.used} of ${skills.length} skills — from Claude Code on your computers, the Jarvis connector and Studio. Updates by itself.`
                : "No skill calls counted yet. Every skill Claude Code, the connector or Studio runs from now on shows up here by itself."
              : `Call counts aren’t available here${usageReason ? ` (${usageReason.replace(/\.$/, "")})` : ""}.`}
        </p>

        {/* Web design guide (separate dropdown) */}
        <DesignGuide skills={skills} onOpen={setDetail} />

        {/* List */}
        {loading ? (
          <p className="py-16 text-center text-sm text-ink-muted">Loading skills…</p>
        ) : loadError ? (
          <p className="py-16 text-center text-sm text-red-400">{loadError}</p>
        ) : skills.length === 0 ? (
          <EmptyState onAdd={() => setEditor({ mode: "add" })} syncing={syncing} />
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-ink-muted">
            {view === "favorites" && fav.count === 0
              ? "No favorites yet. Tap the ☆ on any skill to keep it here."
              : added !== "any"
                ? "No skills added in that time. Try “Any time”."
                : usageFilter === "unused"
                  ? "Every skill here has been used at least once."
                  : usageFilter !== "any"
                    ? "None of these skills have been called yet. Try Usage “Any”."
                    : "No skills match your filters."}
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
                  favorite={fav.has(skill)}
                  onToggleFavorite={fav.toggle}
                  onOpen={setDetail}
                  onEdit={(s) => setEditor({ mode: "edit", skill: s })}
                  onDelete={handleDelete}
                  use={usage ? usageFor(skill, usage) : undefined}
                  rank={ranks.get(skill.id)}
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
          favorite={fav.has(detail)}
          onToggleFavorite={fav.toggle}
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
  dim,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  /** No skills in it yet: still shown, just quieter. */
  dim?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition " +
        (active
          ? "border-brand bg-brand/15 text-brand"
          : dim
            ? "border-line/60 text-ink-faint hover:bg-panel-2 hover:text-ink-muted"
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
