"use client";

// A member: their cookbooks and their game record on one page, because in
// Cook Connect those are the same person.

import { useCallback, useEffect, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns } from "../Columns";
import {
  countRecipes, loadCookbooks, loadFollowGraph, loadFollowLists, loadPlayerLeaderboard, loadSaves, loadVisibleRecipes,
  toggleFollow, type RecipeWithContext,
} from "@/lib/cook-connect/social";
import { usePersonal } from "@/lib/cook-connect/personal";
import { formatStreak, formatWinRate, QUALIFYING_GAMES, type PlayerRecord } from "@/lib/cook-connect/stats";
import { createMatch } from "@/lib/cook-connect/matches";
import { rooms } from "@/lib/cook-connect/types";
import type { Cookbook, Profile } from "@/lib/cook-connect/types";
import {
  Avatar, Button, EmptyState, Loading, Panel, SectionHead, Tag, TabStrip, avatarHue, cx,
} from "../ui";
import { BookIcon, BookmarkIcon, EditIcon, GearIcon, PlayIcon } from "../icons";
import { ChatPanel } from "../play/ChatPanel";
import { PeopleSheet, type PeopleTab } from "../social/PeopleSheet";
import { RecipeCard } from "../social/RecipeCard";
import { Reveal } from "../social/Reveal";

export function ProfileView({ userId: targetId }: { userId: string }) {
  const { sb, userId, navigate, onlineIds, notify, profile: mine } = useCook();
  const [person, setPerson] = useState<Profile | null>(null);
  const [books, setBooks] = useState<Cookbook[]>([]);
  const [recipeCounts, setRecipeCounts] = useState<Record<string, number>>({});
  const [saveCounts, setSaveCounts] = useState<Record<string, number>>({});
  const [record, setRecord] = useState<PlayerRecord | null>(null);
  const [followers, setFollowers] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followsMe, setFollowsMe] = useState(false);
  const [lists, setLists] = useState<{ followers: Profile[]; following: Profile[] }>({ followers: [], following: [] });
  const [sheet, setSheet] = useState<PeopleTab | null>(null);
  const [recipes, setRecipes] = useState<RecipeWithContext[]>([]);
  const [tab, setTab] = useState<"recipes" | "cookbooks">("recipes");
  const { ranks, settings, setRank } = usePersonal(userId);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const isMe = targetId === userId;

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data }, allBooks, counts, saves, board, graph, people, visible] = await Promise.all([
      sb.from("profiles").select("*").eq("id", targetId).maybeSingle(),
      loadCookbooks(sb, { ownerId: targetId }),
      countRecipes(sb),
      loadSaves(sb),
      loadPlayerLeaderboard(sb),
      loadFollowGraph(sb, userId),
      loadFollowLists(sb, targetId),
      loadVisibleRecipes(sb, userId),
    ]);
    setLists(people);
    setRecipes(visible.filter((r) => r.author_id === targetId));
    setFollowsMe(graph.followers.has(targetId));
    setPerson((data as Profile) ?? null);
    setBooks(allBooks.filter((b) => b.privacy === "public" || b.owner_id === userId));
    setRecipeCounts(counts);
    setSaveCounts(saves.byCookbook);
    setRecord(board.find((r) => r.userId === targetId) ?? null);
    setFollowers(graph.followerCount[targetId] ?? 0);
    setIsFollowing(graph.following.has(targetId));
    setFollowingCount(people.following.length);
    setLoading(false);
  }, [sb, targetId, userId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Columns><Loading label="Opening profile" /></Columns>;
  if (!person) {
    return (
      <Columns>
        <Panel>
          <EmptyState
            title="No such member"
            body="That profile has been removed, or the link was wrong."
            action={<Button onClick={() => navigate({ page: "explore" })}>Back to people</Button>}
          />
        </Panel>
      </Columns>
    );
  }

  const follow = async () => {
    if (!userId) return;
    setBusy(true);
    await toggleFollow(sb, userId, targetId, isFollowing);
    setIsFollowing(!isFollowing);
    setFollowers((n) => n + (isFollowing ? -1 : 1));
    if (mine) {
      setLists((l) => ({
        ...l,
        followers: isFollowing ? l.followers.filter((p) => p.id !== mine.id) : [...l.followers, mine],
      }));
    }
    setBusy(false);
  };

  const challenge = async (game: "spades" | "chess") => {
    if (!userId) return;
    setBusy(true);
    const matchId = await createMatch(sb, { game, userId, isPublic: true });
    setBusy(false);
    notify(`Table open. Tell ${person.display_name} to take a seat.`);
    navigate({ page: game === "spades" ? "spades" : "chess", matchId });
  };

  const dmRoom = userId && !isMe ? rooms.dm(userId, targetId) : null;

  return (
    <Columns
      rail={
        <>
          <RecordPanel record={record} />
          {dmRoom && (
            <ChatPanel
              room={dmRoom}
              title={`Message ${person.display_name.split(" ")[0]}`}
              height="h-[260px]"
              placeholder="Just between you two…"
            />
          )}
        </>
      }
    >
      <Panel className="mb-4 overflow-hidden">
        <div className="cc-cover" style={{ ["--cc-hue" as string]: avatarHue(person.id) }} />
        <div className="flex flex-wrap items-start gap-4 px-4 pb-4">
          <span className="-mt-11 rounded-full border-4 border-[var(--cc-panel)] md:-mt-14">
            <Avatar
              id={person.id}
              name={person.display_name}
              url={person.avatar_url}
              size={96}
              online={onlineIds.has(person.id)}
            />
          </span>
          <div className="min-w-[220px] flex-1 pt-3">
            <h1 className="flex flex-wrap items-center gap-2 text-[22px] font-bold leading-tight tracking-tight">
              {person.display_name}
              {!isMe && followsMe && <Tag tone={isFollowing ? "live" : "neutral"}>{isFollowing ? "Friends" : "Follows you"}</Tag>}
            </h1>
            <p className="mt-0.5 text-[12px] text-[var(--cc-ink-faint)]">
              @{person.handle}
              {person.city && <> · {person.city}</>}
              {onlineIds.has(person.id) && <span className="text-[var(--cc-live)]"> · online now</span>}
            </p>
            {person.bio && (
              <p className="mt-2 max-w-[56ch] text-[13px] leading-relaxed text-[var(--cc-ink-muted)]">
                {person.bio}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
              <Stat label="Recipes" value={recipes.length} />
              <Stat label="Cookbooks" value={books.length} />
              <Stat label="Followers" value={followers} onClick={() => setSheet("followers")} />
              <Stat label="Following" value={followingCount} onClick={() => setSheet("following")} />
              <Stat label="Games" value={record?.played ?? 0} />
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5 pt-3">
            {isMe ? (
              <>
                <Button variant="primary" onClick={() => navigate({ page: "settings" })}>
                  <EditIcon size={14} />
                  Edit profile
                </Button>
                <Button onClick={() => navigate({ page: "settings" })} aria-label="Settings">
                  <GearIcon size={14} />
                  <span className="hidden sm:inline">Settings</span>
                </Button>
              </>
            ) : (
              <>
                <Button variant={isFollowing ? "secondary" : "primary"} disabled={busy} onClick={() => void follow()}>
                  {isFollowing ? "Following" : followsMe ? "Follow back" : "Follow"}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => void challenge("spades")}>
                  <PlayIcon size={13} />
                  Spades
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => void challenge("chess")}>
                  Chess
                </Button>
              </>
            )}
          </div>
        </div>
      </Panel>

      <div className="mb-3">
        <TabStrip
          tabs={[
            { id: "recipes" as const, label: "Recipes", count: recipes.length },
            { id: "cookbooks" as const, label: "Cookbooks", count: books.length },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === "recipes" && (
        recipes.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<BookIcon size={26} />}
              title={isMe ? "No recipes yet" : `${person.display_name} hasn't shared a recipe yet`}
              body={isMe ? "Add one from a link, a photo or your own words — it shows up here and in your followers' feeds." : "When they add one to a public cookbook it shows up here."}
              action={isMe ? <Button variant="primary" onClick={() => navigate({ page: "cookbooks" })}>Go to my cookbooks</Button> : undefined}
            />
          </Panel>
        ) : (
          <ul className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {recipes.map((r, i) => (
              <Reveal key={r.id} as="li" index={i}>
                <RecipeCard
                  recipe={r}
                  rank={ranks[r.id] ?? null}
                  showRank={settings.showRanksOnCards}
                  onRank={(n) => setRank(r.id, n)}
                  onOpen={() => navigate({ page: "recipe", id: r.id, cookbookId: r.cookbook_id })}
                />
              </Reveal>
            ))}
          </ul>
        )
      )}

      {tab === "cookbooks" && (
      <Panel>
        <SectionHead title={isMe ? "Your cookbooks" : "Cookbooks"} count={books.length} />
        {books.length === 0 ? (
          <EmptyState
            icon={<BookIcon size={26} />}
            title={isMe ? "You have not written one yet" : `${person.display_name} has no public cookbooks`}
            body={
              isMe
                ? "A cookbook is a folder with a point of view. Name it, add a recipe, and it appears in everyone's feed."
                : "When they publish one it will show up here, and in your feed if you follow them."
            }
            action={isMe ? (
              <Button variant="primary" onClick={() => navigate({ page: "new-cookbook" })}>
                Start a cookbook
              </Button>
            ) : undefined}
          />
        ) : (
          <ul>
            {books.map((b, i) => (
              <li
                key={b.id}
                className={cx("cc-row px-3 py-2.5", i > 0 && "border-t border-[var(--cc-line-soft)]")}
              >
                <button
                  type="button"
                  onClick={() => navigate({ page: "cookbook", id: b.id })}
                  className="flex w-full items-center gap-3 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold">{b.title}</span>
                      {b.privacy === "private" && <Tag>Private</Tag>}
                    </span>
                    {b.description && (
                      <span className="mt-0.5 block truncate text-[12px] text-[var(--cc-ink-muted)]">
                        {b.description}
                      </span>
                    )}
                  </span>
                  <span className="cc-num shrink-0 text-[12px] text-[var(--cc-ink-muted)]">
                    {recipeCounts[b.id] ?? 0} recipe{(recipeCounts[b.id] ?? 0) === 1 ? "" : "s"}
                  </span>
                  <span className="flex w-[64px] shrink-0 items-center justify-end gap-1 text-[12px] text-[var(--cc-ember)]">
                    <BookmarkIcon size={13} filled={(saveCounts[b.id] ?? 0) > 0} />
                    <span className="cc-num">{saveCounts[b.id] ?? 0}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      )}

      {sheet && (
        <PeopleSheet
          name={isMe ? "you" : person.display_name.split(" ")[0]}
          followers={lists.followers}
          following={lists.following}
          initial={sheet}
          onClose={() => setSheet(null)}
        />
      )}

      {isMe && mine && (
        <p className="mt-3 text-[12px] text-[var(--cc-ink-faint)]">
          This is how everyone else sees you.
        </p>
      )}
    </Columns>
  );
}

function Stat({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  const inner = (
    <>
      <span className="cc-num font-bold text-[var(--cc-ink)]">{value}</span>
      <span className="text-[var(--cc-ink-faint)] transition-colors">{label}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex items-baseline gap-1.5 rounded transition-colors [&>span]:hover:text-[var(--cc-ember)]">
      {inner}
    </button>
  ) : (
    <div className="flex items-baseline gap-1.5">{inner}</div>
  );
}

function RecordPanel({ record }: { record: PlayerRecord | null }) {
  return (
    <Panel>
      <SectionHead title="Game record" />
      {!record ? (
        <p className="px-3 py-4 text-[12px] leading-relaxed text-[var(--cc-ink-muted)]">
          No finished games yet. Wins and losses land here the moment a table closes.
        </p>
      ) : (
        <div className="p-3">
          <div className="flex items-baseline gap-2">
            <span className="cc-num text-[26px] font-bold leading-none">{formatWinRate(record.winRate)}</span>
            <span className="text-[12px] text-[var(--cc-ink-muted)]">win rate</span>
            {!record.qualified && <Tag>Provisional</Tag>}
          </div>
          <dl className="mt-3 space-y-1.5 text-[12px]">
            <Line label="Played" value={record.played} />
            <Line label="Won" value={record.wins} tone="live" />
            <Line label="Lost" value={record.losses} tone="loss" />
            {record.draws > 0 && <Line label="Drawn" value={record.draws} />}
            <Line label="Streak" value={formatStreak(record.streak)} tone={record.streak > 0 ? "live" : undefined} />
          </dl>
          <div className="mt-3 border-t border-[var(--cc-line-soft)] pt-2.5 text-[12px]">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--cc-ink-faint)]">
              By game
            </p>
            <Line label="Spades" value={`${record.byGame.spades.wins}–${record.byGame.spades.played - record.byGame.spades.wins}`} />
            <Line label="Chess" value={`${record.byGame.chess.wins}–${record.byGame.chess.played - record.byGame.chess.wins}`} />
          </div>
          {!record.qualified && (
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--cc-ink-faint)]">
              {QUALIFYING_GAMES - record.played} more game
              {QUALIFYING_GAMES - record.played === 1 ? "" : "s"} and this record joins the ranked board.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

function Line({ label, value, tone }: { label: string; value: number | string; tone?: "live" | "loss" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--cc-ink-muted)]">{label}</dt>
      <dd
        className={cx(
          "cc-num font-semibold",
          tone === "live" && "text-[var(--cc-live)]",
          tone === "loss" && "text-[var(--cc-loss)]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
