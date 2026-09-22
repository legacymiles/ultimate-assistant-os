"use client";

// The social page. One ledger of what the people you follow have been doing,
// with a rail of who is around and which tables are open — so reading the feed
// and joining a game are the same glance.

import { useCallback, useEffect, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns, PageHead } from "../Columns";
import { feedSummary, loadFeed, loadFollowGraph, type FeedEntry } from "@/lib/cook-connect/social";
import { loadOpenTables, type OpenTable } from "@/lib/cook-connect/matches";
import { loadProfiles, type ProfileMap } from "@/lib/cook-connect/social";
import type { Profile } from "@/lib/cook-connect/types";
import {
  Avatar, Button, EmptyState, Loading, Panel, SectionHead, TabStrip, relativeTime, cx,
} from "../ui";
import { BookIcon, BookmarkIcon, BotIcon, FeedIcon, PeopleIcon, PlayIcon, SparkIcon, TrophyIcon } from "../icons";
import { LoungeDock } from "../play/LoungeDock";

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

export function FeedView() {
  const { sb, userId, navigate, onlineIds } = useCook();
  const [scope, setScope] = useState<"following" | "everyone">("everyone");
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [followingCount, setFollowingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const graph = await loadFollowGraph(sb, userId);
    setFollowingCount(graph.following.size);
    const rows = await loadFeed(sb, {
      userId,
      following: scope === "following" ? graph.following : undefined,
      limit: 60,
    });
    setEntries(rows);
    setLoading(false);
  }, [sb, userId, scope]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Columns rail={<FeedRail />}>
      <PageHead
        title="What everyone is cooking"
        subtitle="Cookbooks published, recipes added, games won. Follow people and this narrows to them."
      />

      <Panel>
        <SectionHead
          title={scope === "following" ? "From people you follow" : "Everyone"}
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
            icon={<FeedIcon size={26} />}
            title={scope === "following" ? "Nothing from the people you follow yet" : "Nothing here yet"}
            body={
              scope === "following"
                ? "Follow a few cooks and their cookbooks, recipes and results will show up here."
                : "Publish a cookbook or finish a game and this page starts filling itself in."
            }
            action={
              <Button variant="primary" onClick={() => navigate({ page: scope === "following" ? "people" : "cookbooks" })}>
                {scope === "following" ? "Find people" : "Start a cookbook"}
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
                      size={30}
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
                    className="cc-num w-[68px] shrink-0 text-right text-[11px] text-[var(--cc-ink-faint)]"
                  >
                    {relativeTime(entry.created_at)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </Columns>
  );
}

/* ── The rail ──────────────────────────────────────────────────── */

function FeedRail() {
  const { sb, userId, navigate, onlineIds } = useCook();
  const [people, setPeople] = useState<Profile[]>([]);
  const [tables, setTables] = useState<OpenTable[]>([]);
  const [names, setNames] = useState<ProfileMap>({});

  const refresh = useCallback(async () => {
    const [{ data }, open] = await Promise.all([
      sb.from("profiles").select("*").order("display_name"),
      loadOpenTables(sb),
    ]);
    setPeople(((data ?? []) as Profile[]).filter((p) => p.id !== userId));
    setTables(open);
    setNames(await loadProfiles(sb, open.flatMap((t) => t.players.map((p) => p.user_id))));
  }, [sb, userId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const online = people.filter((p) => onlineIds.has(p.id));
  const rest = people.filter((p) => !onlineIds.has(p.id)).slice(0, 6 - Math.min(online.length, 6));

  return (
    <>
      <Panel>
        <SectionHead
          title="Open tables"
          count={tables.length}
          action={
            <Button variant="ghost" onClick={() => navigate({ page: "play" })}>
              All
            </Button>
          }
        />
        {tables.length === 0 ? (
          <div className="px-3 py-4">
            <p className="text-[12px] leading-relaxed text-[var(--cc-ink-muted)]">
              No one is waiting for players. Open a table and the computer will fill the empty seats
              until someone joins.
            </p>
            <Button variant="primary" className="mt-2.5 w-full" onClick={() => navigate({ page: "play" })}>
              <PlayIcon size={14} />
              Open a table
            </Button>
          </div>
        ) : (
          <ul>
            {tables.slice(0, 5).map((t, i) => (
              <li
                key={t.match.id}
                className={cx("cc-row px-3 py-2", i > 0 && "border-t border-[var(--cc-line-soft)]")}
              >
                <button
                  type="button"
                  onClick={() => navigate({ page: t.match.game === "spades" ? "spades" : "chess", matchId: t.match.id })}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <span className="flex -space-x-1.5">
                    {t.players.slice(0, 4).map((p) => (
                      p.is_bot ? (
                        <span
                          key={p.id}
                          className="flex h-6 w-6 items-center justify-center rounded-full border-2
                                     border-[var(--cc-panel)] bg-[var(--cc-elevated)] text-[var(--cc-ink-faint)]"
                          title="Computer player"
                        >
                          <BotIcon size={12} />
                        </span>
                      ) : (
                        <span key={p.id} className="rounded-full border-2 border-[var(--cc-panel)]">
                          <Avatar
                            id={p.user_id}
                            name={names[p.user_id]?.display_name ?? "Member"}
                            url={names[p.user_id]?.avatar_url}
                            size={22}
                          />
                        </span>
                      )
                    ))}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-semibold capitalize">{t.match.game}</span>
                    <span className="cc-num block text-[11px] text-[var(--cc-live)]">
                      {t.seatsFree} seat{t.seatsFree === 1 ? "" : "s"} free
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <SectionHead
          title={online.length > 0 ? "Around now" : "Members"}
          count={online.length > 0 ? online.length : undefined}
          action={
            <Button variant="ghost" onClick={() => navigate({ page: "people" })}>
              All
            </Button>
          }
        />
        <ul>
          {[...online, ...rest].slice(0, 8).map((p, i) => (
            <li
              key={p.id}
              className={cx("cc-row px-3 py-2", i > 0 && "border-t border-[var(--cc-line-soft)]")}
            >
              <button
                type="button"
                onClick={() => navigate({ page: "profile", userId: p.id })}
                className="flex w-full items-center gap-2.5 text-left"
              >
                <Avatar id={p.id} name={p.display_name} url={p.avatar_url} size={26} online={onlineIds.has(p.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold">{p.display_name}</span>
                  <span className="block truncate text-[11px] text-[var(--cc-ink-faint)]">
                    {p.city ?? `@${p.handle}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {people.length === 0 && (
            <li className="px-3 py-4 text-[12px] leading-relaxed text-[var(--cc-ink-muted)]">
              Nobody else has joined yet. Your cookbooks are still worth writing.
            </li>
          )}
        </ul>
      </Panel>

      <LoungeDock />
    </>
  );
}
