"use client";

// Explore — where you find people. Who is online right now, a search over
// everyone, an invite to a table that actually reaches them, and a look at
// what they cook without having to leave the row.

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
import {
  Avatar, Button, EmptyState, Loading, Panel, SearchField, SectionHead, Tag, TabStrip, cx,
} from "../ui";
import { BookIcon, BookmarkIcon, PeopleIcon, PlayIcon, SearchIcon } from "../icons";

type Scope = "online" | "all" | "following" | "followers";

export function ExploreView() {
  const { sb, userId, profile, navigate, onlineIds, notify } = useCook();
  const [term, setTerm] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [people, setPeople] = useState<Profile[]>([]);
  const [records, setRecords] = useState<Record<string, PlayerRecord>>({});
  const [books, setBooks] = useState<Cookbook[]>([]);
  const [recipeCounts, setRecipeCounts] = useState<Record<string, number>>({});
  const [saveCounts, setSaveCounts] = useState<Record<string, number>>({});
  const [graph, setGraph] = useState({ following: new Set<string>(), followers: new Set<string>() });
  const [expanded, setExpanded] = useState<string | null>(null);
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
        || (scope === "following" && graph.following.has(p.id))
        || (scope === "followers" && graph.followers.has(p.id))
      ))
      .filter((p) => !needle || [p.display_name, p.handle, p.city ?? "", p.bio ?? ""]
        .some((f) => f.toLowerCase().includes(needle)))
      .sort((a, b) => {
        const aOn = onlineIds.has(a.id) ? 1 : 0;
        const bOn = onlineIds.has(b.id) ? 1 : 0;
        if (aOn !== bOn) return bOn - aOn;
        return a.display_name.localeCompare(b.display_name);
      });
  }, [people, term, scope, graph, userId, onlineIds]);

  const onlineCount = people.filter((p) => p.id !== userId && onlineIds.has(p.id)).length;

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
  const invite = async (target: Profile, game: "spades" | "chess") => {
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
        title="Explore"
        subtitle="Everyone on Cook Connect. Search by name, handle or city, see who is around right now, look through what they cook, and pull them into a game."
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--cc-line)] p-2">
          <div className="min-w-[200px] flex-1">
            <SearchField
              value={term}
              onChange={setTerm}
              placeholder="Name, handle, city or what they cook"
              icon={<SearchIcon size={14} />}
            />
          </div>
          <TabStrip
            tabs={[
              { id: "all" as const, label: "Everyone", count: people.length - 1 },
              { id: "online" as const, label: "Online", count: onlineCount },
              { id: "following" as const, label: "Following", count: graph.following.size },
              { id: "followers" as const, label: "Followers", count: graph.followers.size },
            ]}
            active={scope}
            onChange={setScope}
          />
        </div>

        <SectionHead title={scope === "all" ? "Members" : scope} count={shown.length} />

        {loading ? (
          <Loading label="Looking around" />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<PeopleIcon size={26} />}
            title={
              term ? `Nobody matches "${term}"`
                : scope === "online" ? "Nobody else is online"
                  : scope === "following" ? "You are not following anyone yet"
                    : scope === "followers" ? "Nobody follows you yet"
                      : "You are the first one here"
            }
            body={
              term ? "Try a first name, a handle, or the city someone cooks in."
                : scope === "online" ? "Open a table anyway — the computer fills the empty seats until someone turns up."
                  : scope === "following" ? "Switch to Everyone and follow a few cooks to shape your feed."
                    : scope === "followers" ? "Publishing a cookbook is the fastest way to change that."
                      : "When other people sign up they appear here, with what they cook and how they play."
            }
            action={
              scope === "all" || scope === "online" ? (
                <Button variant="primary" onClick={() => navigate({ page: "play" })}>Open a table</Button>
              ) : (
                <Button onClick={() => setScope("all")}>Show everyone</Button>
              )
            }
          />
        ) : (
          <>
            <div className="hidden items-center gap-3 border-b border-[var(--cc-line-soft)] px-3 py-1.5
                            text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--cc-ink-faint)] lg:flex">
              <span className="flex-1">Member</span>
              <span className="w-[120px]">City</span>
              <span className="w-[62px] text-right">Books</span>
              <span className="w-[70px] text-right">Record</span>
              <span className="w-[48px] text-right">Win %</span>
              <span className="w-[232px]" />
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
                            {p.bio && <span className="text-[var(--cc-ink-muted)]"> · {p.bio}</span>}
                          </span>
                        </span>
                      </button>

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

                      <span className="cc-num hidden w-[70px] text-right text-[12px] lg:block">
                        {record ? `${record.wins}–${record.losses}` : "—"}
                      </span>
                      <span className="cc-num hidden w-[48px] text-right text-[12px] text-[var(--cc-ink-muted)] lg:block">
                        {record ? formatWinRate(record.winRate) : "—"}
                      </span>

                      <span className="flex shrink-0 items-center gap-1.5 lg:w-[232px] lg:justify-end">
                        <Button
                          variant={isFollowing ? "secondary" : "primary"}
                          disabled={busy === p.id}
                          onClick={() => void follow(p)}
                        >
                          {isFollowing ? "Following" : "Follow"}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busy === p.id}
                          onClick={() => void invite(p, "spades")}
                          title={`Invite ${p.display_name} to spades`}
                        >
                          <PlayIcon size={13} />
                          Spades
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy === p.id}
                          onClick={() => void invite(p, "chess")}
                          title={`Invite ${p.display_name} to chess`}
                        >
                          Chess
                        </Button>
                      </span>
                    </div>

                    {open && theirBooks.length > 0 && (
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

      {!loading && people.length <= 1 && (
        <p className="mt-3 text-[12px] leading-relaxed text-[var(--cc-ink-faint)]">
          <Tag>Quiet</Tag>{" "}
          Cook Connect starts empty on purpose — nothing is here until you or someone else puts it
          here. Everything still works alone: the computer will play you at either game.
        </p>
      )}
    </Columns>
  );
}
