"use client";

// Cookbooks: yours, everybody's, and the ones you keep. Saving is the only
// verb here that changes a leaderboard, so it is the one that gets the colour.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns, PageHead } from "../Columns";
import {
  countRecipes, loadCookbooks, loadProfiles, loadSaves, mySaves, toggleSave, type ProfileMap,
} from "@/lib/cook-connect/social";
import type { Cookbook } from "@/lib/cook-connect/types";
import {
  Avatar, Button, EmptyState, Loading, Panel, SearchField, SectionHead, Tag, TabStrip, cx,
} from "../ui";
import { BookIcon, BookmarkIcon, PlusIcon, SearchIcon } from "../icons";

type Scope = "discover" | "mine" | "saved";

export function CookbooksView() {
  const { sb, userId, navigate, notify } = useCook();
  const [scope, setScope] = useState<Scope>("discover");
  const [term, setTerm] = useState("");
  const [books, setBooks] = useState<Cookbook[]>([]);
  const [owners, setOwners] = useState<ProfileMap>({});
  const [recipeCounts, setRecipeCounts] = useState<Record<string, number>>({});
  const [saveCounts, setSaveCounts] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [all, counts, saves, mine] = await Promise.all([
      loadCookbooks(sb),
      countRecipes(sb),
      loadSaves(sb),
      userId ? mySaves(sb, userId) : Promise.resolve(new Set<string>()),
    ]);
    const visible = all.filter((b) => b.privacy === "public" || b.owner_id === userId);
    setBooks(visible);
    setRecipeCounts(counts);
    setSaveCounts(saves.byCookbook);
    setSaved(mine);
    setOwners(await loadProfiles(sb, visible.map((b) => b.owner_id)));
    setLoading(false);
  }, [sb, userId]);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return books
      .filter((b) => (
        scope === "discover"
        || (scope === "mine" && b.owner_id === userId)
        || (scope === "saved" && saved.has(b.id))
      ))
      .filter((b) => !needle || [b.title, b.description ?? "", owners[b.owner_id]?.display_name ?? ""]
        .some((f) => f.toLowerCase().includes(needle)))
      .sort((a, b) => (saveCounts[b.id] ?? 0) - (saveCounts[a.id] ?? 0));
  }, [books, scope, term, userId, saved, owners, saveCounts]);

  const save = async (book: Cookbook) => {
    if (!userId) return;
    const already = saved.has(book.id);
    setBusy(book.id);
    await toggleSave(sb, userId, book, already);
    setSaved((prev) => {
      const next = new Set(prev);
      if (already) next.delete(book.id);
      else next.add(book.id);
      return next;
    });
    setSaveCounts((prev) => ({ ...prev, [book.id]: (prev[book.id] ?? 0) + (already ? -1 : 1) }));
    setBusy(null);
    notify(already ? `Removed ${book.title} from your saves.` : `Saved ${book.title}.`);
  };

  const mineCount = books.filter((b) => b.owner_id === userId).length;

  return (
    <Columns>
      <PageHead
        title="Cookbooks"
        subtitle="Every cookbook anyone has published. Saving one keeps it on your shelf and pushes it up the leaderboard."
        action={
          <span className="flex items-center gap-1.5">
            <Button onClick={() => navigate({ page: "shared" })}>Shared with you</Button>
            <Button variant="primary" onClick={() => navigate({ page: "new-cookbook" })}>
              <PlusIcon size={14} />
              New cookbook
            </Button>
          </span>
        }
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--cc-line)] p-2">
          <div className="min-w-[200px] flex-1">
            <SearchField
              value={term}
              onChange={setTerm}
              placeholder="Title, description or author"
              icon={<SearchIcon size={14} />}
            />
          </div>
          <TabStrip
            tabs={[
              { id: "discover" as const, label: "Discover", count: books.length },
              { id: "mine" as const, label: "Mine", count: mineCount },
              { id: "saved" as const, label: "Saved", count: saved.size },
            ]}
            active={scope}
            onChange={setScope}
          />
        </div>

        <SectionHead title={scope} count={shown.length} />

        {loading ? (
          <Loading label="Opening the shelf" />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<BookIcon size={26} />}
            title={
              term ? `Nothing matches "${term}"`
                : scope === "mine" ? "You have not written a cookbook yet"
                  : scope === "saved" ? "Nothing saved yet"
                    : "No cookbooks yet"
            }
            body={
              term ? "Try a dish, an author or a cuisine."
                : scope === "mine" ? "Name it, add a recipe, and it goes out to everyone's feed."
                  : scope === "saved" ? "Save a cookbook from Discover and it stays on this shelf."
                    : "Be the first. A cookbook takes one title and one recipe to start."
            }
            action={
              scope !== "saved" ? (
                <Button variant="primary" onClick={() => navigate({ page: "new-cookbook" })}>
                  Start a cookbook
                </Button>
              ) : (
                <Button onClick={() => setScope("discover")}>Browse Discover</Button>
              )
            }
          />
        ) : (
          <>
            <div className="hidden items-center gap-3 border-b border-[var(--cc-line-soft)] px-3 py-1.5
                            text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--cc-ink-faint)] md:flex">
              <span className="flex-1">Cookbook</span>
              <span className="w-[140px]">Author</span>
              <span className="w-[62px] text-right">Recipes</span>
              <span className="w-[54px] text-right">Saves</span>
              <span className="w-[86px]" />
            </div>
            <ul>
              {shown.map((b, i) => {
                const owner = owners[b.owner_id];
                const isMine = b.owner_id === userId;
                const isSaved = saved.has(b.id);
                return (
                  <li
                    key={b.id}
                    className={cx(
                      "cc-row flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5",
                      i > 0 && "border-t border-[var(--cc-line-soft)]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => navigate({ page: "cookbook", id: b.id })}
                      className="min-w-[180px] flex-1 text-left"
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold transition-colors hover:text-[var(--cc-ember)]">
                          {b.title}
                        </span>
                        {b.privacy === "private" && <Tag>Private</Tag>}
                      </span>
                      {b.description && (
                        <span className="mt-0.5 block truncate text-[12px] text-[var(--cc-ink-muted)]">
                          {b.description}
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => navigate({ page: "profile", userId: b.owner_id })}
                      className="flex w-[140px] shrink-0 items-center gap-2 text-left"
                    >
                      <Avatar id={b.owner_id} name={owner?.display_name ?? "Member"} url={owner?.avatar_url} size={22} />
                      <span className="truncate text-[12px] text-[var(--cc-ink-muted)]">
                        {isMine ? "You" : owner?.display_name ?? "Member"}
                      </span>
                    </button>

                    <span className="cc-num w-[62px] shrink-0 text-right text-[12px] text-[var(--cc-ink-muted)]">
                      {recipeCounts[b.id] ?? 0}
                    </span>
                    <span className="cc-num w-[54px] shrink-0 text-right text-[13px] font-semibold text-[var(--cc-ember)]">
                      {saveCounts[b.id] ?? 0}
                    </span>

                    <span className="w-[86px] shrink-0 text-right">
                      {isMine ? (
                        <Button variant="ghost" onClick={() => navigate({ page: "cookbook", id: b.id })}>
                          Open
                        </Button>
                      ) : (
                        <Button
                          variant={isSaved ? "secondary" : "ghost"}
                          disabled={busy === b.id}
                          onClick={() => void save(b)}
                          className={isSaved ? "text-[var(--cc-ember)]" : ""}
                        >
                          <BookmarkIcon size={13} filled={isSaved} />
                          {isSaved ? "Saved" : "Save"}
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel>
    </Columns>
  );
}
