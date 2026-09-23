"use client";

// The activity feed. It used to be its own tab; it lives on Play now, because
// what people are cooking and who is at a table are the same glance.

import { useCallback, useEffect, useState } from "react";
import { useCook } from "../CookConnect";
import { feedSummary, loadFeed, loadFollowGraph, type FeedEntry } from "@/lib/cook-connect/social";
import {
  Avatar, Button, EmptyState, Loading, Panel, SectionHead, TabStrip, relativeTime, cx,
} from "../ui";
import { BookIcon, BookmarkIcon, FeedIcon, PeopleIcon, SparkIcon, TrophyIcon } from "../icons";

const KIND_ICON = {
  cookbook_published: BookIcon,
  cookbook_saved: BookmarkIcon,
  recipe_added: SparkIcon,
  match_won: TrophyIcon,
  followed: PeopleIcon,
} as const;

const KIND_TONE: Record<string, string> = {
  cookbook_published: "text-[var(--cc-ember)]",
  cookbook_saved: "text-[var(--cc-ember)]",
  recipe_added: "text-[var(--cc-ember)]",
  match_won: "text-[var(--cc-gold)]",
  followed: "text-[var(--cc-ink-muted)]",
};

export function ActivityFeed({ limit = 40 }: { limit?: number }) {
  const { sb, userId, navigate, onlineIds } = useCook();
  const [scope, setScope] = useState<"following" | "everyone">("everyone");
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [followingCount, setFollowingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const graph = await loadFollowGraph(sb, userId);
    setFollowingCount(graph.following.size);
    setEntries(await loadFeed(sb, {
      userId,
      following: scope === "following" ? graph.following : undefined,
      limit,
    }));
    setLoading(false);
  }, [sb, userId, scope, limit]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Panel>
      <SectionHead
        title="Activity"
        count={entries.length}
        action={
          <TabStrip
            tabs={[
              { id: "everyone" as const, label: "Everyone" },
              { id: "following" as const, label: "Following", count: followingCount },
            ]}
            active={scope}
            onChange={setScope}
          />
        }
      />

      {loading ? (
        <Loading label="Reading the feed" />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<FeedIcon size={24} />}
          title={scope === "following" ? "Nothing from the people you follow" : "Nothing has happened yet"}
          body={
            scope === "following"
              ? "Follow a few cooks in Explore and their cookbooks, recipes and results land here."
              : "Publish a cookbook or finish a game and this fills itself in. Everyone's activity shows up here."
          }
          action={
            <Button variant="primary" onClick={() => navigate({ page: "explore" })}>
              Find people
            </Button>
          }
        />
      ) : (
        <ul>
          {entries.map((entry, i) => {
            const Icon = KIND_ICON[entry.kind] ?? FeedIcon;
            const actor = entry.actor;
            return (
              <li
                key={entry.id}
                className={cx(
                  "cc-row flex items-center gap-3 px-3 py-2.5",
                  i > 0 && "border-t border-[var(--cc-line-soft)]",
                )}
              >
                <button
                  type="button"
                  onClick={() => actor && navigate({ page: "profile", userId: actor.id })}
                  className="shrink-0"
                  aria-label={actor ? `Open ${actor.display_name}'s profile` : "Member"}
                >
                  <Avatar
                    id={actor?.id ?? entry.actor_id}
                    name={actor?.display_name ?? "Member"}
                    url={actor?.avatar_url}
                    size={28}
                    online={actor ? onlineIds.has(actor.id) : undefined}
                  />
                </button>

                <span className={cx("shrink-0", KIND_TONE[entry.kind])}>
                  <Icon size={15} />
                </span>

                <p className="min-w-0 flex-1 truncate text-[13px]">
                  <button
                    type="button"
                    onClick={() => actor && navigate({ page: "profile", userId: actor.id })}
                    className="font-semibold transition-colors hover:text-[var(--cc-ember)]"
                  >
                    {actor?.display_name ?? "Someone"}
                  </button>{" "}
                  <span className="text-[var(--cc-ink-muted)]">{feedSummary(entry)}</span>
                </p>

                {entry.kind !== "followed" && entry.kind !== "match_won" && entry.subject_id && (
                  <Button
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => navigate({ page: "cookbook", id: entry.subject_id! })}
                  >
                    Open
                  </Button>
                )}

                <time
                  dateTime={entry.created_at}
                  className="cc-num w-[62px] shrink-0 text-right text-[11px] text-[var(--cc-ink-faint)]"
                >
                  {relativeTime(entry.created_at)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
