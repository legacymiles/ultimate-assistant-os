"use client";

// Cookbooks somebody handed you directly. Different from Saved: a save is
// something public you kept, a share is something private you were let into.

import { useCallback, useEffect, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns, PageHead } from "../Columns";
import { loadSharedWithMe } from "@/lib/cook-connect/shares";
import { countRecipes, loadProfiles, type ProfileMap } from "@/lib/cook-connect/social";
import type { Cookbook, CookbookShare } from "@/lib/cook-connect/types";
import { Avatar, Button, EmptyState, Loading, Panel, SectionHead, Tag, cx, relativeTime } from "../ui";
import { BookmarkIcon } from "../icons";

export function SharedWithMeView() {
  const { sb, userId, navigate } = useCook();
  const [books, setBooks] = useState<Cookbook[]>([]);
  const [shares, setShares] = useState<CookbookShare[]>([]);
  const [owners, setOwners] = useState<ProfileMap>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    const [{ shares: rows, cookbooks }, recipeCounts] = await Promise.all([
      loadSharedWithMe(sb, userId),
      countRecipes(sb),
    ]);
    setShares(rows);
    setBooks(cookbooks);
    setCounts(recipeCounts);
    setOwners(await loadProfiles(sb, cookbooks.map((b) => b.owner_id)));
    setLoading(false);
  }, [sb, userId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Columns>
      <PageHead
        title="Shared with you"
        subtitle="Cookbooks other people opened up to you by link. They stay theirs — you are a reader, not an owner."
      />

      <Panel>
        <SectionHead title="Shared cookbooks" count={books.length} />
        {loading ? (
          <Loading label="Checking" />
        ) : books.length === 0 ? (
          <EmptyState
            icon={<BookmarkIcon size={26} />}
            title="Nothing has been shared with you"
            body="When somebody sends you a Cook Connect share link and you open it, the cookbook lands here — even if it is private."
            action={<Button variant="primary" onClick={() => navigate({ page: "cookbooks" })}>Browse cookbooks</Button>}
          />
        ) : (
          <ul>
            {books.map((b, i) => {
              const share = shares.find((s) => s.cookbook_id === b.id);
              const owner = owners[b.owner_id];
              return (
                <li
                  key={b.id}
                  className={cx(
                    "cc-row flex items-center gap-3 px-3 py-2.5",
                    i > 0 && "border-t border-[var(--cc-line-soft)]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => navigate({ page: "cookbook", id: b.id })}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold transition-colors hover:text-[var(--cc-ember)]">
                        {b.title}
                      </span>
                      {share?.access_level === "copy" && <Tag tone="ember">Can copy</Tag>}
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
                      {owner?.display_name ?? "Member"}
                    </span>
                  </button>

                  <span className="cc-num w-[62px] shrink-0 text-right text-[12px] text-[var(--cc-ink-muted)]">
                    {counts[b.id] ?? 0}
                  </span>
                  <span className="cc-num w-[72px] shrink-0 text-right text-[11px] text-[var(--cc-ink-faint)]">
                    {share ? relativeTime(share.created_at) : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </Columns>
  );
}
