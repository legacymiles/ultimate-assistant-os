"use client";

// Explore — where you find people. It is on both halves of the app and shows
// that half's side of everyone (owner's rule):
//   Cookbook: cooks — their city, their cookbooks (opened in place), their saves,
//             and the cooking groups.
//   Connect:  players — who is online, their record and win rate, and an
//             invite to any game that actually reaches them.
// Following is the same on both sides: one account, one set of followers.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns, PageHead } from "../Columns";
import {
  countRecipes, loadCookbooks, loadFollowGraph, loadPlayerLeaderboard, loadSaves,
  searchPeople, toggleFollow,
} from "@/lib/cook-connect/social";
import { formatWinRate, type PlayerRecord } from "@/lib/cook-connect/stats";
import { createMatch } from "@/lib/cook-connect/matches";
import { rooms, type Cookbook, type Profile } from "@/lib/cook-connect/types";
import { GAMES, type GameId } from "@/lib/cook-connect/sides";
import {
  Avatar, Button, EmptyState, Loading, Panel, SearchField, SectionHead, Tag, TabStrip, cx,
} from "../ui";
import { BookIcon, BookmarkIcon, PeopleIcon, PlayIcon, SearchIcon } from "../icons";
import { GroupsPanel } from "../social/GroupsPanel";
import { RecipeBrowser } from "../social/RecipeBrowser";

type Scope = "online" | "all" | "friends" | "following" | "followers";

export function ExploreView() {
  const { sb, userId, profile, navigate, onlineIds, notify, side } = useCook();
  const isConnect = side === "connect";
  const [term, setTerm] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [people, setPeople] = useState<Profile[]>([]);
  const [records, setRecords] = useState<Record<string, PlayerRecord>>({});
  const [books, setBooks] = useState<Cookbook[]>([]);
  const [recipeCounts, setRecipeCounts] = useState<Record<string, number>>({});
  const [saveCounts, setSaveCounts] = useState<Record<string, number>>({});
  const [graph, setGraph] = useState({ following: new Set<string>(), followers: new Set<string>() });
  const [expanded, setExpanded] = useState<string | null>(null);
  // Cookbook Explore: recipes (the default — what people come to find), cooks, and groups.
  const [halfPick, setHalf] = useState<"recipes" | "people" | "groups">("recipes");
  // Recipes and groups are cooking things, so Connect's Explore is people only.
  const half = isConnect ? "people" : halfPick;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [rows, board, followGraph, allBooks, counts, saves] = await Promise.all([
      searchPeople(sb, ""),
      loadPlayerLeaderboard(sb),
      loadFollowGraph(sb, userId),
      loadCookbooks(sb, { publicOnly: true }),
      countRecipes(sb),
      loadSaves(sb),
    ]);
    setPeople(rows);
    setRecords(Object.fromEntries(board.map((r) => [r.userId, r])));
    setGraph({ following: followGraph.following, followers: followGraph.followers });
    setBooks(allBooks);
    setRecipeCounts(counts);
    setSaveCounts(saves.byCookbook);
    setLoading(false);
  }, [sb, userId]);

  useEffect(() => { void load(); }, [load]);

  const savesBy = useCallback(
    (ownerId: string) => books
      .filter((b) => b.owner_id === ownerId)
      .reduce((sum, b) => sum + (saveCounts[b.id] ?? 0), 0),
    [books, saveCounts],
  );

  const booksBy = useCallback(
    (ownerId: string) => books.filter((b) => b.owner_id === ownerId),
    [books],
  );

  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return people
      .filter((p) => p.id !== userId)
      .filter((p) => (
        scope === "all"
        || (scope === "online" && onlineIds.has(p.id))
        || (scope === "friends" && graph.following.has(p.id) && graph.followers.has(p.id))
        || (scope === "following" && graph.following.has(p.id))
        || (scope === "followers" && graph.followers.has(p.id))
      ))
      .filter((p) => !needle || [p.display_name, p.handle, p.city ?? "", p.bio ?? ""]
        .some((f) => f.toLowerCase().includes(needle)))
      .sort((a, b) => {
        const aOn = onlineIds.has(a.id) ? 1 : 0;
        const bOn = onlineIds.has(b.id) ? 1 : 0;
        if (aOn !== bOn) return bOn - aOn;
        // Then the busiest on this side: most games played, or most cookbooks.
        const aN = isConnect ? (records[a.id]?.played ?? 0) : books.filter((x) => x.owner_id === a.id).length;
        const bN = isConnect ? (records[b.id]?.played ?? 0) : books.filter((x) => x.owner_id === b.id).length;
        if (aN !== bN) return bN - aN;
        return a.display_name.localeCompare(b.display_name);
      });
  }, [people, term, scope, graph, userId, onlineIds, isConnect, records, books]);

  const onlineCount = people.filter((p) => p.id !== userId && onlineIds.has(p.id)).length;
  /** Friends = you follow each other. */
  const friendCount = [...graph.following].filter((id) => graph.followers.has(id)).length;

  const follow = async (target: Profile) => {
    if (!userId) return;
    const already = graph.following.has(target.id);
    setBusy(target.id);
    await toggleFollow(sb, userId, target.id, already);
    setGraph((prev) => {
      const following = new Set(prev.following);
      if (already) following.delete(target.id);
      else following.add(target.id);
      return { ...prev, following };
    });
    setBusy(null);
    notify(already ? `You no longer follow ${target.display_name}.` : `Following ${target.display_name}.`);
  };

  /**
   * An invite is a table plus a message. Opening a table and hoping somebody
   * notices it in the lobby is not an invitation, so this puts a line in their
   * direct messages naming the game.
   */
  const invite = async (target: Profile, game: GameId) => {
    if (!userId) return;
    setBusy(target.id);
    const matchId = await createMatch(sb, { game, userId, isPublic: true });
    await sb.from("messages").insert({
      room: rooms.dm(userId, target.id),
      user_id: userId,
      content: `${profile?.display_name ?? "Someone"} opened a ${game} table and wants you in it. `
        + `It's in Play — look for the open table.`,
    });
    setBusy(null);
    notify(`Invited ${target.display_name} to ${game}. They'll see it in their messages.`);
    navigate({ page: game === "spades" ? "spades" : "chess", matchId });
  };

  return (
    <Columns>
      <PageHead
        title={isConnect ? "Explore players" : half === "recipes" ? "Explore recipes" : "Explore cooks"}
        subtitle={
          isConnect
            ? "Everyone who plays. See who is around right now, how they play, and pull them into a game. Follow someone here and they're followed on the Cookbook side too — it's one account."
            : half === "recipes"
              ? "Every recipe people have shared. Search by dish or main ingredient, pick a meal, and rank what you love from 1 to 10."
            : half === "people"
              ? "Everyone who cooks. Search by name, handle or city and look through their cookbooks without leaving the row. Following is shared with Connect."
              : "Groups are rooms with a subject — people who cook the same way, and one conversation between them. Joining opens its chat and its video room."
        }
        action={isConnect ? undefined : (
          <TabStrip
            tabs={[
              { id: "recipes" as const, label: "Recipes" },
              { id: "people" as const, label: "Cooks" },
              { id: "groups" as const, label: "Groups" },
            ]}
            active={half}
            onChange={setHalf}
          />
        )}
      />

      {half === "recipes" ? <RecipeBrowser /> : half === "groups" ? <GroupsPanel /> : (
      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--cc-line)] p-2">
          <div className="min-w-[200px] flex-1">
            <SearchField
              value={term}
              onChange={setTerm}
              placeholder={isConnect ? "Name or handle" : "Name, handle, city or what they cook"}
              icon={<SearchIcon size={14} />}
            />
          </div>
          <TabStrip
            tabs={[
              { id: "all" as const, label: "Everyone", count: people.length - 1 },
              { id: "online" as const, label: "Online", count: onlineCount },
              { id: "friends" as const, label: "Friends", count: friendCount },
              { id: "following" as const, label: "Following", count: graph.following.size },
              { id: "followers" as const, label: "Followers", count: graph.followers.size },
            ]}
            active={scope}
            onChange={setScope}
          />
        </div>

        <SectionHead title={scope === "all" ? (isConnect ? "Players" : "Cooks") : scope} count={shown.length} />

        {loading ? (
          <Loading label="Looking around" />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<PeopleIcon size={26} />}
            title={
              term ? `Nobody matches "${term}"`
                : scope === "online" ? "Nobody else is online"
                  : scope === "friends" ? "No friends yet"
                  : scope === "following" ? "You are not following anyone yet"
                    : scope === "followers" ? "Nobody follows you yet"
                      : "You are the first one here"
            }
            body={
              term ? (isConnect ? "Try a first name or a handle." : "Try a first name, a handle, or the city someone cooks in.")
                : scope === "online"
                  ? (isConnect
                    ? "Open a table anyway — the computer fills the empty seats until someone turns up."
                    : "Nobody else is cooking right now. Their cookbooks are still here under Everyone.")
                  : scope === "friends" ? "Friends are people you follow who follow you back. Follow a few and they show up here."
                  : scope === "following" ? `Switch to Everyone and follow a few ${isConnect ? "players" : "cooks"} to shape your feed.`
                    : scope === "followers"
                      ? (isConnect ? "Win a few games — people follow who they keep losing to." : "Publishing a cookbook is the fastest way to change that.")
                      : isConnect
                        ? "When other people sign up they appear here, with how they play."
                        : "When other people sign up they appear here, with what they cook."
            }
            action={
              scope === "all" || scope === "online" ? (
                isConnect
                  ? <Button variant="primary" onClick={() => navigate({ page: "play" })}>Open a table</Button>
                  : <Button variant="primary" onClick={() => navigate({ page: "new-cookbook" })}>Start a cookbook</Button>
              ) : (
                <Button onClick={() => setScope("all")}>Show everyone</Button>
              )
            }
          />
        ) : (
          <>
            <div className="hidden items-center gap-3 border-b border-[var(--cc-line-soft)] px-3 py-1.5
                            text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--cc-ink-faint)] lg:flex">
              <span className="flex-1">{isConnect ? "Player" : "Cook"}</span>
              {isConnect ? (
                <>
                  <span className="w-[70px] text-right">Record</span>
                  <span className="w-[48px] text-right">Win %</span>
                  <span className="w-[86px] text-right">Plays most</span>
                </>
              ) : (
                <>
                  <span className="w-[120px]">City</span>
                  <span className="w-[62px] text-right">Books</span>
                  <span className="w-[54px] text-right">Saves</span>
                </>
              )}
              <span className={isConnect ? "w-[256px]" : "w-[96px]"} />
            </div>

            <ul>
              {shown.map((p, i) => {
                const record = records[p.id];
                const isFollowing = graph.following.has(p.id);
                const theirBooks = booksBy(p.id);
                const open = expanded === p.id;
                return (
                  <li
                    key={p.id}
                    className={cx(i > 0 && "border-t border-[var(--cc-line-soft)]")}
                  >
                    <div className="cc-row flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => navigate({ page: "profile", userId: p.id })}
                        className="flex min-w-[180px] flex-1 items-center gap-2.5 text-left"
                      >
                        <Avatar
                          id={p.id}
                          name={p.display_name}
                          url={p.avatar_url}
                          size={32}
                          online={onlineIds.has(p.id)}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold transition-colors hover:text-[var(--cc-ember)]">
                            {p.display_name}
                          </span>
                          <span className="block truncate text-[11px] text-[var(--cc-ink-faint)]">
                            @{p.handle}
                            {/* On a phone the columns are hidden, so the key number rides along here. */}
                            {isConnect && record && (
                              <span className="cc-num text-[var(--cc-ink-muted)] lg:hidden">
                                {" · "}{record.wins}–{record.losses}
                              </span>
                            )}
                            {!isConnect && theirBooks.length > 0 && (
                              <span className="cc-num text-[var(--cc-ink-muted)] lg:hidden">
                                {" · "}{theirBooks.length} book{theirBooks.length === 1 ? "" : "s"}
                              </span>
                            )}
                            {p.bio && <span className="text-[var(--cc-ink-muted)]"> · {p.bio}</span>}
                          </span>
                        </span>
                      </button>

                      {!isConnect && (<>
                      <span className="hidden w-[120px] truncate text-[12px] text-[var(--cc-ink-muted)] lg:block">
                        {p.city ?? "—"}
                      </span>

                      {/* Their cookbooks open in place rather than sending you away. */}
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : p.id)}
                        disabled={theirBooks.length === 0}
                        aria-expanded={open}
                        className={cx(
                          "hidden w-[62px] items-center justify-end gap-1 text-[12px] transition-colors lg:flex",
                          theirBooks.length === 0
                            ? "cursor-default text-[var(--cc-ink-faint)]"
                            : open
                              ? "text-[var(--cc-ember)]"
                              : "text-[var(--cc-ink-muted)] hover:text-[var(--cc-ember)]",
                        )}
                        title={theirBooks.length ? "Show their cookbooks" : "No public cookbooks"}
                      >
                        <BookIcon size={13} />
                        <span className="cc-num">{theirBooks.length}</span>
                      </button>
                      <span className="cc-num hidden w-[54px] text-right text-[12px] font-semibold text-[var(--cc-ember)] lg:block">
                        {savesBy(p.id)}
                      </span>
                      </>)}

                      {isConnect && (<>
                      <span className="cc-num hidden w-[70px] text-right text-[12px] lg:block">
                        {record ? `${record.wins}–${record.losses}` : "—"}
                      </span>
                      <span className="cc-num hidden w-[48px] text-right text-[12px] text-[var(--cc-ink-muted)] lg:block">
                        {record ? formatWinRate(record.winRate) : "—"}
                      </span>
                      <span className="hidden w-[86px] text-right text-[12px] text-[var(--cc-ink-muted)] lg:block">
                        {favouriteGame(record) ?? "—"}
                      </span>
                      </>)}

                      <span className={cx(
                        "flex shrink-0 items-center gap-1.5 lg:justify-end",
                        isConnect ? "lg:w-[256px]" : "lg:w-[96px]",
                      )}>
                        <Button
                          variant={isFollowing ? "secondary" : "primary"}
                          disabled={busy === p.id}
                          onClick={() => void follow(p)}
                        >
                          {isFollowing ? "Following" : "Follow"}
                        </Button>
                        {isConnect && GAMES.map((g, gi) => (
                          <Button
                            key={g.id}
                            variant={gi === 0 ? "secondary" : "ghost"}
                            disabled={busy === p.id}
                            onClick={() => void invite(p, g.id)}
                            title={`Invite ${p.display_name} to ${g.label.toLowerCase()}`}
                          >
                            {gi === 0 && <PlayIcon size={13} />}
                            {g.label}
                          </Button>
                        ))}
                      </span>
                    </div>

                    {!isConnect && open && theirBooks.length > 0 && (
                      <ul className="border-t border-[var(--cc-line-soft)] bg-[var(--cc-panel-2)] px-3 py-1.5">
                        {theirBooks.map((b) => (
                          <li key={b.id} className="flex items-center gap-3 py-1.5">
                            <button
                              type="button"
                              onClick={() => navigate({ page: "cookbook", id: b.id })}
                              className="min-w-0 flex-1 text-left"
                            >
                              <span className="block truncate text-[12px] font-semibold transition-colors hover:text-[var(--cc-ember)]">
                                {b.title}
                              </span>
                              {b.description && (
                                <span className="block truncate text-[11px] text-[var(--cc-ink-muted)]">
                                  {b.description}
                                </span>
                              )}
                            </button>
                            <span className="cc-num shrink-0 text-[11px] text-[var(--cc-ink-faint)]">
                              {recipeCounts[b.id] ?? 0} recipes
                            </span>
                            <span className="flex w-[52px] shrink-0 items-center justify-end gap-1 text-[11px] text-[var(--cc-ember)]">
                              <BookmarkIcon size={12} filled={(saveCounts[b.id] ?? 0) > 0} />
                              <span className="cc-num">{saveCounts[b.id] ?? 0}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel>
      )}

      {half === "people" && !loading && people.length <= 1 && (
        <p className="mt-3 text-[12px] leading-relaxed text-[var(--cc-ink-faint)]">
          <Tag>Quiet</Tag>{" "}
          Cook Connect starts empty on purpose — nothing is here until you or someone else puts it
          here. {isConnect ? "Everything still works alone: the computer will play you at any game." : "Your cookbooks and journal work fine on your own."}
        </p>
      )}
    </Columns>
  );
}

/** The game someone has played most, for the Connect row. */
function favouriteGame(record: PlayerRecord | undefined): string | null {
  if (!record || record.played === 0) return null;
  const best = [...GAMES].sort((a, b) => record.byGame[b.id].played - record.byGame[a.id].played)[0];
  return best.label;
}
