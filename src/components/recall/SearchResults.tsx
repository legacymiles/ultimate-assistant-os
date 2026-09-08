"use client";

import { useMemo } from "react";
import { Icon } from "../icons";
import { folderPathString } from "@/lib/recall/store";
import { search } from "@/lib/recall/search";
import { primaryFields } from "@/lib/recall/schemas";
import type { Item, RecallData, SectionId } from "@/lib/recall/types";
import { SECTION_OF } from "@/lib/recall/types";
import { Row } from "./Section";

// ---------------------------------------------------------------------------
// One search box over everything: notes, tasks, links, files, logins, websites,
// folder names and tags. Structured field values are indexed, and so is the
// text READ OUT of uploaded PDFs, docs and images — so a phrase that only ever
// existed inside a document still finds it.
// Saved passwords are never searched — a password is not a search term.
// ---------------------------------------------------------------------------

// Sub-folders are not an item bucket, so search never groups into them.
type ResultGroup = Exclude<SectionId, "subfolders">;

const GROUP_META: Record<ResultGroup, { label: string; icon: typeof Icon.File }> = {
  notes: { label: "Notes & Ideas", icon: Icon.File },
  todos: { label: "To-Dos", icon: Icon.Check2 },
  links: { label: "Links & Resources", icon: Icon.Link },
  logins: { label: "Logins", icon: Icon.Key },
  websites: { label: "Websites", icon: Icon.Globe },
};

const ORDER: ResultGroup[] = ["websites", "logins", "notes", "links", "todos"];

interface Props {
  query: string;
  data: RecallData;
  activeTags: string[];
  onToggleTag: (tag: string) => void;
  onNavigate: (folderId: string | null) => void;
  onOpenItem: (item: Item) => void;
}

export function SearchResults({
  query,
  data,
  activeTags,
  onToggleTag,
  onNavigate,
  onOpenItem,
}: Props) {
  const result = useMemo(() => search(query, data), [query, data]);

  const items = useMemo(() => {
    const hits = result.items.map((s) => s.item);
    return activeTags.length
      ? hits.filter((i) => activeTags.every((t) => i.tags.includes(t)))
      : hits;
  }, [result.items, activeTags]);

  const groups = useMemo(() => {
    const g = new Map<ResultGroup, Item[]>();
    for (const it of items) {
      const k = SECTION_OF[it.kind] ?? "notes";
      const arr = g.get(k);
      if (arr) arr.push(it);
      else g.set(k, [it]);
    }
    return g;
  }, [items]);

  const total = items.length;

  return (
    <div>
      <div className="mb-3 flex items-baseline gap-2">
        <h1 className="text-xl font-bold tracking-tight text-ink">
          {total} {total === 1 ? "result" : "results"}
        </h1>
        <span className="truncate text-[11px] text-ink-faint">for “{query}”</span>
      </div>

      {/* Matching folders and tags — jump straight there */}
      {(result.folders.length > 0 || result.tags.length > 0) && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {result.folders.slice(0, 8).map((f) => (
            <button
              key={f.id}
              onClick={() => onNavigate(f.id)}
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-panel px-2 py-1 text-[11px] text-ink-muted transition hover:border-brand/40 hover:text-ink"
            >
              <Icon.Folder width={11} height={11} />
              {folderPathString(data.folders, f.id)}
            </button>
          ))}
          {result.tags.slice(0, 10).map((t) => (
            <button
              key={t}
              onClick={() => onToggleTag(t)}
              className={
                "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition " +
                (activeTags.includes(t)
                  ? "border-brand bg-brand/15 text-brand"
                  : "border-line text-ink-muted hover:text-ink")
              }
            >
              <Icon.Tag width={10} height={10} />
              {t}
            </button>
          ))}
        </div>
      )}

      {total === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-panel/40 py-14 text-center">
          <p className="text-sm font-medium text-ink">Nothing matches “{query}”</p>
          <p className="mt-1 text-xs text-ink-muted">
            Search covers titles, notes, tags, every field on a website or login, and the text read out of your files.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {ORDER.filter((k) => groups.has(k)).map((key) => {
            const meta = GROUP_META[key];
            const GroupIcon = meta.icon;
            const list = groups.get(key) as Item[];
            return (
              <div key={key} className="rounded-2xl border border-line bg-panel/40 px-3 py-2">
                <div className="mb-1 flex items-center gap-2 px-1 py-1">
                  <GroupIcon width={13} height={13} className="text-ink-faint" />
                  <span className="text-[13px] font-medium text-ink-muted">{meta.label}</span>
                  <span className="rounded-md bg-panel-2 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-ink-faint">
                    {list.length}
                  </span>
                </div>
                {list.map((it) => {
                  const fields = it.fields ?? {};
                  const detail =
                    primaryFields(it.kind)
                      .map((f) => fields[f.key])
                      .filter(Boolean)
                      .join("  ·  ") ||
                    it.url ||
                    it.summary ||
                    it.body;
                  // When the hit came from inside a file, show that.
                  const fromContents =
                    it.extractStatus === "ok" &&
                    !!it.extract &&
                    it.extract.toLowerCase().includes(query.trim().toLowerCase()) &&
                    !it.title.toLowerCase().includes(query.trim().toLowerCase());
                  return (
                    <Row
                      key={it.id}
                      onClick={() => {
                        // Records and logins live in their folder page; notes
                        // and links open in the detail modal.
                        if (it.kind === "website" || it.kind === "credential") {
                          onNavigate(it.folderId);
                        } else {
                          onOpenItem(it);
                        }
                      }}
                      tone={it.kind === "todo" && it.done ? "muted" : "default"}
                    >
                      <span className="shrink-0 text-ink-faint">
                        <GroupIcon width={13} height={13} />
                      </span>
                      <span className="shrink-0 text-[13px] text-ink">{it.title}</span>
                      <span className="min-w-0 truncate font-mono text-[10px] text-ink-faint">
                        {detail}
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-[10px] text-ink-faint">
                        {fromContents && (
                          <span className="text-emerald-300/70" title="Matched text inside this file">
                            in contents
                          </span>
                        )}
                        {folderPathString(data.folders, it.folderId)}
                      </span>
                    </Row>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
