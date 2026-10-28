"use client";

// The feed — a social scroll on each half of the app (owner's ask, Oct 2026).
//
//   Cookbook: recipes from the people you follow as big photo posts, with
//             saves, new cookbooks and follows between them.
//   Connect:  wins, follows and who is online to play.
//
// Posts rise in as they scroll into view, and more load as you reach the end.
// "Following" is the default (Settings can change it); with nobody followed
// yet, the feed shows everyone so it is never empty for a new account.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns } from "../Columns";
import {
  feedSummary, loadFeed, loadFollowGraph, loadPlayerLeaderboard, loadVisibleRecipes, searchPeople, toggleFollow,
  type FeedEntry, type RecipeWithContext,
} from "@/lib/cook-connect/social";
import { FEED_KINDS } from "@/lib/cook-connect/sides";
import { usePersonal } from "@/lib/cook-connect/personal";
import { formatWinRate, type PlayerRecord } from "@/lib/cook-connect/stats";
import type { Profile } from "@/lib/cook-connect/types";
import { Avatar, Button, EmptyState, Panel, SectionHead, TabStrip, relativeTime, cx } from "../ui";
import { BookIcon, BookmarkIcon, FeedIcon, PeopleIcon, PlayIcon, TrophyIcon } from "../icons";
import { RecipeCard } from "../social/RecipeCard";
import { RankBadge } from "../social/RankPicker";
import { Reveal } from "../social/Reveal";

type Item =
  | { type: "recipe"; at: string; key: string; recipe: RecipeWithContext }
  | { type: "activity"; at: string; key: string; entry: FeedEntry };

const PAGE = 10;

export function FeedView() {
  const { sb, userId, side, navigate, onlineIds, notify } = useCook();
  const isConnect = side === "connect";
  const { ranks, settings, setRank } = usePersonal(userId);
  const [scope, setScope] = useState<"following" | "everyone">(settings.feedScope);
  const [recipes, setRecipes] = useState<RecipeWithContext[]>([]);
  const [activity, setActivity] = useState<FeedEntry[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [records, setRecords] = useState<Record<string, PlayerRecord>>({});
  const [graph, setGraph] = useState({ following: new Set<string>(), followers: new Set<string>() });
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const [g, recs, acts, everyone, board] = await Promise.all([
      loadFollowGraph(sb, userId),
      isConnect ? Promise.resolve([] as RecipeWithContext[]) : loadVisibleRecipes(sb, userId),
      loadFeed(sb, {
        userId,
        limit: 120,
        // Recipes show as photo posts, so their one-line activity would say it twice.
        kinds: FEED_KINDS[side].filter((k) => k !== "recipe_added"),
      }),
      searchPeople(sb, ""),
      loadPlayerLeaderboard(sb),
    ]);
    setGraph({ following: g.following, followers: g.followers });
    setRecipes(recs);
    setActivity(acts);
    setPeople(everyone);
    setRecords(Object.fromEntries(board.map((r) => [r.userId, r])));
    setLoading(false);
  }, [sb, userId, isConnect, side]);

  useEffect(() => { void load(); }, [load]);

  // Following with nobody followed is an empty room — show everyone instead, and say so.
  const nobodyFollowed = graph.following.size === 0;
  const effective = scope === "following" && nobodyFollowed ? "everyone" : scope;

  const items = useMemo<Item[]>(() => {
    const keep = (actor: string) => effective === "everyone" || actor === userId || graph.following.has(actor);
    const list: Item[] = [
      ...recipes.filter((r) => keep(r.author_id)).map((r) => ({
        type: "recipe" as const, at: r.created_at, key: `r:${r.id}`, recipe: r,
      })),
      ...activity.filter((a) => keep(a.actor_id)).map((a) => ({
        type: "activity" as const, at: a.created_at, key: `a:${a.id}`, entry: a,
      })),
    ];
    return list.sort((a, b) => b.at.localeCompare(a.at));
  }, [recipes, activity, effective, graph.following, userId]);

  useEffect(() => { setCount(PAGE); }, [effective, side]);

  // Endless scroll: the next page loads as the bottom comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setCount((n) => n + PAGE);
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [items.length, loading]);

  const suggestions = useMemo(() => people
    .filter((p) => p.id !== userId && !graph.following.has(p.id))
    .sort((a, b) => {
      const on = (onlineIds.has(b.id) ? 1 : 0) - (onlineIds.has(a.id) ? 1 : 0);
      if (on) return on;
      const fb = (graph.followers.has(b.id) ? 1 : 0) - (graph.followers.has(a.id) ? 1 : 0);
      if (fb) return fb;
      const ab = isConnect ? (records[b.id]?.played ?? 0) - (records[a.id]?.played ?? 0)
        : recipes.filter((r) => r.author_id === b.id).length - recipes.filter((r) => r.author_id === a.id).length;
      return ab;
    })
    .slice(0, 6), [people, userId, graph, onlineIds, isConnect, records, recipes]);

  /** The strip at the top: who you follow, online first — tap to open them. */
  const circle = useMemo(() => people
    .filter((p) => graph.following.has(p.id))
    .sort((a, b) => (onlineIds.has(b.id) ? 1 : 0) - (onlineIds.has(a.id) ? 1 : 0))
    .slice(0, 16), [people, graph.following, onlineIds]);

  const follow = async (p: Profile) => {
    if (!userId) return;
    setBusy(p.id);
    await toggleFollow(sb, userId, p.id, false);
    setGraph((g) => ({ ...g, following: new Set([...g.following, p.id]) }));
    setBusy(null);
    notify(`Following ${p.display_name} — their posts are in your feed now.`);
  };

  const topRanked = useMemo(() => recipes
    .filter((r) => ranks[r.id])
    .sort((a, b) => (ranks[b.id] ?? 0) - (ranks[a.id] ?? 0))
    .slice(0, 5), [recipes, ranks]);

  return (
    <Columns
      rail={
        <>
          <Panel>
            <SectionHead title={isConnect ? "Players to follow" : "Cooks to follow"} />
            {suggestions.length === 0 ? (
              <p className="px-3 py-4 text-[12px] leading-relaxed text-[var(--cc-ink-muted)]">
                {people.length <= 1
                  ? "Nobody else has joined yet. Invite a friend — they show up here the moment they sign up."
                  : "You follow everyone here. Nice."}
              </p>
            ) : (
              <ul>
                {suggestions.map((p, i) => (
                  <li key={p.id} className={cx("flex items-center gap-2.5 px-3 py-2", i > 0 && "border-t border-[var(--cc-line-soft)]")}>
                    <button type="button" onClick={() => navigate({ page: "profile", userId: p.id })} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                      <Avatar id={p.id} name={p.display_name} url={p.avatar_url} size={32} online={onlineIds.has(p.id)} />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold">{p.display_name}</span>
                        <span className="block truncate text-[11px] text-[var(--cc-ink-faint)]">
                          {graph.followers.has(p.id) ? "Follows you"
                            : isConnect
                              ? records[p.id] ? `${records[p.id].wins}–${records[p.id].losses} · ${formatWinRate(records[p.id].winRate)}` : `@${p.handle}`
                              : p.city ?? `@${p.handle}`}
                        </span>
                      </span>
                    </button>
                    <Button variant="primary" disabled={busy === p.id} onClick={() => void follow(p)}>
                      {graph.followers.has(p.id) ? "Follow back" : "Follow"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {!isConnect && topRanked.length > 0 && (
            <Panel>
              <SectionHead title="Your top ranked" action={
                <Button variant="ghost" onClick={() => navigate({ page: "cookbooks" })}>All</Button>
              } />
              <ul>
                {topRanked.map((r, i) => (
                  <li key={r.id} className={cx(i > 0 && "border-t border-[var(--cc-line-soft)]")}>
                    <button
                      type="button"
                      onClick={() => navigate({ page: "recipe", id: r.id, cookbookId: r.cookbook_id })}
                      className="cc-row flex w-full items-center gap-2.5 px-3 py-2 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{r.title}</span>
                      <RankBadge rank={ranks[r.id]} />
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      }
    >
      <div className="mx-auto max-w-[640px]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h1 className="text-[22px] font-bold tracking-tight">{isConnect ? "Game feed" : "Your feed"}</h1>
          <TabStrip
            tabs={[
              { id: "following" as const, label: "Following", count: graph.following.size },
              { id: "everyone" as const, label: "Everyone" },
            ]}
            active={scope}
            onChange={setScope}
          />
        </div>

        {/* Your people, like stories: online first, a ring when they are here now. */}
        {circle.length > 0 && (
          <div className="cc-chip-rail mb-4 !gap-3 pb-1">
            {circle.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => navigate({ page: "profile", userId: p.id })}
                className="flex w-[64px] shrink-0 flex-col items-center gap-1"
              >
                <span className={cx(
                  "rounded-full p-[2px]",
                  onlineIds.has(p.id)
                    ? "bg-[conic-gradient(var(--cc-ember),var(--cc-live),var(--cc-ember))]"
                    : "bg-[var(--cc-line)]",
                )}>
                  <span className="block rounded-full bg-[var(--cc-canvas)] p-[2px]">
                    <Avatar id={p.id} name={p.display_name} url={p.avatar_url} size={50} />
                  </span>
                </span>
                <span className="w-full truncate text-center text-[11px] text-[var(--cc-ink-muted)]">
                  {p.display_name.split(" ")[0]}
                </span>
              </button>
            ))}
          </div>
        )}

        {scope === "following" && nobodyFollowed && !loading && (
          <p className="mb-3 rounded-lg border border-[var(--cc-line)] bg-[var(--cc-panel)] px-3 py-2 text-[12px] text-[var(--cc-ink-muted)]">
            You don&rsquo;t follow anyone yet, so this is everyone&rsquo;s {isConnect ? "games" : "cooking"}. Follow people on the right to make it yours.
          </p>
        )}

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="cc-skeleton h-[320px]" />)}
          </div>
        ) : items.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<FeedIcon size={26} />}
              title="Nothing here yet"
              body={isConnect
                ? "Finish a game or follow some players — wins and new follows show up here."
                : "Add a recipe or follow some cooks — their recipes show up here as posts."}
              action={isConnect
                ? <Button variant="primary" onClick={() => navigate({ page: "play" })}>Start a game</Button>
                : <Button variant="primary" onClick={() => navigate({ page: "explore" })}>Explore recipes</Button>}
            />
          </Panel>
        ) : (
          <ol className="space-y-4">
            {items.slice(0, count).map((item, i) => (
              <Reveal key={item.key} as="li" index={i}>
                {item.type === "recipe" ? (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 px-1 text-[12px] text-[var(--cc-ink-faint)]">
                      <span className="font-semibold text-[var(--cc-ink-muted)]">
                        {item.recipe.author_id === userId ? "You" : item.recipe.author?.display_name ?? "Someone"}
                      </span>
                      added a recipe · <time dateTime={item.at}>{relativeTime(item.at)}</time>
                    </p>
                    <RecipeCard
                      size="feed"
                      recipe={item.recipe}
                      rank={ranks[item.recipe.id] ?? null}
                      showRank={settings.showRanksOnCards}
                      onRank={(n) => setRank(item.recipe.id, n)}
                      onOpen={() => navigate({ page: "recipe", id: item.recipe.id, cookbookId: item.recipe.cookbook_id })}
                      onAuthor={() => navigate({ page: "profile", userId: item.recipe.author_id })}
                    />
                  </div>
                ) : (
                  <ActivityCard entry={item.entry} />
                )}
              </Reveal>
            ))}
          </ol>
        )}

        {!loading && count < items.length && <div ref={sentinel} className="h-10" />}
        {!loading && items.length > 0 && count >= items.length && (
          <p className="py-8 text-center text-[12px] text-[var(--cc-ink-faint)]">You&rsquo;re all caught up.</p>
        )}
      </div>
    </Columns>
  );
}

const ICON = {
  cookbook_published: BookIcon,
  cookbook_saved: BookmarkIcon,
  recipe_added: BookIcon,
  match_won: TrophyIcon,
  followed: PeopleIcon,
} as const;

function ActivityCard({ entry }: { entry: FeedEntry }) {
  const { navigate, onlineIds } = useCook();
  const Icon = ICON[entry.kind] ?? FeedIcon;
  const actor = entry.actor;
  const win = entry.kind === "match_won";
  return (
    <div className={cx(
      "flex items-center gap-3 rounded-2xl border px-3.5 py-3",
      win
        ? "border-[#3d3418] bg-[linear-gradient(120deg,rgba(232,194,106,0.12),transparent_60%)]"
        : "border-[var(--cc-line)] bg-[var(--cc-panel)]",
    )}>
      <button type="button" onClick={() => actor && navigate({ page: "profile", userId: actor.id })} className="shrink-0">
        <Avatar id={entry.actor_id} name={actor?.display_name ?? "Member"} url={actor?.avatar_url} size={36} online={actor ? onlineIds.has(actor.id) : undefined} />
      </button>
      <p className="min-w-0 flex-1 text-[13.5px] leading-snug">
        <button
          type="button"
          onClick={() => actor && navigate({ page: "profile", userId: actor.id })}
          className="font-semibold transition-colors hover:text-[var(--cc-ember)]"
        >
          {actor?.display_name ?? "Someone"}
        </button>{" "}
        <span className="text-[var(--cc-ink-muted)]">{feedSummary(entry)}</span>
        <span className="mt-0.5 block text-[11px] text-[var(--cc-ink-faint)]">{relativeTime(entry.created_at)}</span>
      </p>
      <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
        win ? "bg-[rgba(232,194,106,0.15)] text-[var(--cc-gold)]" : "bg-[var(--cc-ember-wash)] text-[var(--cc-ember)]")}>
        <Icon size={17} />
      </span>
      {win && (
        <Button variant="secondary" onClick={() => navigate({ page: "play" })}>
          <PlayIcon size={13} />
          Play
        </Button>
      )}
      {(entry.kind === "cookbook_published" || entry.kind === "cookbook_saved") && entry.subject_id && (
        <Button variant="ghost" onClick={() => navigate({ page: "cookbook", id: entry.subject_id! })}>Open</Button>
      )}
    </div>
  );
}
