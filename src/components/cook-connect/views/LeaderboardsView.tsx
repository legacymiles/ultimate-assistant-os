"use client";

// Two standings, side by side: who wins games, and whose cookbooks people
// keep. Both are ledgers — rank, name, the numbers that produced the rank.

import { useCallback, useEffect, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns, PageHead } from "../Columns";
import {
  loadCookbookLeaderboard, loadPlayerLeaderboard, loadProfiles, type ProfileMap,
} from "@/lib/cook-connect/social";
import {
  formatStreak, formatWinRate, QUALIFYING_GAMES,
  type CookbookStanding, type PlayerRecord,
} from "@/lib/cook-connect/stats";
import {
  Avatar, Button, EmptyState, Loading, Panel, SectionHead, Tag, TabStrip, cx,
} from "../ui";
import { BookmarkIcon, TrophyIcon } from "../icons";

type GameFilter = "all" | "spades" | "chess";

export function LeaderboardsView() {
  const { sb, userId, navigate } = useCook();
  const [players, setPlayers] = useState<PlayerRecord[]>([]);
  const [cookbooks, setCookbooks] = useState<CookbookStanding[]>([]);
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [filter, setFilter] = useState<GameFilter>("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [board, books] = await Promise.all([
      loadPlayerLeaderboard(sb),
      loadCookbookLeaderboard(sb),
    ]);
    setPlayers(board);
    setCookbooks(books);
    setProfiles(await loadProfiles(sb, [...board.map((r) => r.userId), ...books.map((b) => b.ownerId)]));
    setLoading(false);
  }, [sb]);

  useEffect(() => { void load(); }, [load]);

  const shownPlayers = filter === "all"
    ? players
    : players.filter((p) => p.byGame[filter].played > 0);

  return (
    <Columns>
      <PageHead
        title="Leaderboards"
        subtitle={`Players are ranked on win rate, with wins breaking a tie. A record joins the ranked board at ${QUALIFYING_GAMES} games — until then it sits below, marked provisional, so a short hot streak cannot top a long season.`}
      />

      {loading ? (
        <Loading label="Counting" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel>
            <SectionHead
              title="Players"
              count={shownPlayers.length}
              action={
                <TabStrip
                  tabs={[
                    { id: "all" as const, label: "Both" },
                    { id: "spades" as const, label: "Spades" },
                    { id: "chess" as const, label: "Chess" },
                  ]}
                  active={filter}
                  onChange={setFilter}
                />
              }
            />

            {shownPlayers.length === 0 ? (
              <EmptyState
                icon={<TrophyIcon size={26} />}
                title="No finished games yet"
                body="Play a hand of spades or a game of chess and the first name on this board will be yours."
                action={<Button variant="primary" onClick={() => navigate({ page: "play" })}>Open a table</Button>}
              />
            ) : (
              <>
                <div className="flex items-center gap-3 border-b border-[var(--cc-line-soft)] px-3 py-1.5
                                text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--cc-ink-faint)]">
                  <span className="w-[26px] text-right">#</span>
                  <span className="flex-1">Player</span>
                  <span className="w-[42px] text-right">GP</span>
                  <span className="w-[62px] text-right">W–L</span>
                  <span className="w-[46px] text-right">Win %</span>
                  <span className="w-[42px] text-right">Run</span>
                </div>
                <ul>
                  {shownPlayers.map((p, i) => {
                    const person = profiles[p.userId];
                    const isMe = p.userId === userId;
                    const rank = p.qualified ? i + 1 : null;
                    return (
                      <li
                        key={p.userId}
                        className={cx(
                          "cc-row flex items-center gap-3 px-3 py-2",
                          i > 0 && "border-t border-[var(--cc-line-soft)]",
                          isMe && "bg-[var(--cc-ember-wash)]",
                        )}
                      >
                        <span className={cx(
                          "cc-num w-[26px] text-right text-[12px] font-semibold",
                          rank === 1 ? "text-[var(--cc-gold)]" : "text-[var(--cc-ink-faint)]",
                        )}>
                          {rank ?? "—"}
                        </span>
                        <button
                          type="button"
                          onClick={() => navigate({ page: "profile", userId: p.userId })}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <Avatar
                            id={p.userId}
                            name={person?.display_name ?? "Member"}
                            url={person?.avatar_url}
                            size={24}
                          />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-[13px] font-semibold transition-colors hover:text-[var(--cc-ember)]">
                                {person?.display_name ?? "Member"}
                              </span>
                              {isMe && <Tag tone="ember">You</Tag>}
                              {!p.qualified && <Tag>Provisional</Tag>}
                            </span>
                          </span>
                        </button>
                        <span className="cc-num w-[42px] text-right text-[12px] text-[var(--cc-ink-muted)]">
                          {filter === "all" ? p.played : p.byGame[filter].played}
                        </span>
                        <span className="cc-num w-[62px] text-right text-[12px]">
                          {filter === "all"
                            ? `${p.wins}–${p.losses}`
                            : `${p.byGame[filter].wins}–${p.byGame[filter].played - p.byGame[filter].wins}`}
                        </span>
                        <span className="cc-num w-[46px] text-right text-[13px] font-semibold">
                          {formatWinRate(
                            filter === "all"
                              ? p.winRate
                              : p.byGame[filter].played === 0
                                ? 0
                                : p.byGame[filter].wins / p.byGame[filter].played,
                          )}
                        </span>
                        <span className={cx(
                          "cc-num w-[42px] text-right text-[12px]",
                          p.streak > 0 && "text-[var(--cc-live)]",
                          p.streak < 0 && "text-[var(--cc-loss)]",
                          p.streak === 0 && "text-[var(--cc-ink-faint)]",
                        )}>
                          {formatStreak(p.streak)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Panel>

          <Panel>
            <SectionHead title="Most saved cookbooks" count={cookbooks.length} />
            {cookbooks.length === 0 ? (
              <EmptyState
                icon={<BookmarkIcon size={26} />}
                title="No cookbooks yet"
                body="Publish one and every save it collects moves it up this board."
                action={<Button variant="primary" onClick={() => navigate({ page: "new-cookbook" })}>Start a cookbook</Button>}
              />
            ) : (
              <>
                <div className="flex items-center gap-3 border-b border-[var(--cc-line-soft)] px-3 py-1.5
                                text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--cc-ink-faint)]">
                  <span className="w-[26px] text-right">#</span>
                  <span className="flex-1">Cookbook</span>
                  <span className="w-[62px] text-right">Recipes</span>
                  <span className="w-[54px] text-right">Saves</span>
                </div>
                <ul>
                  {cookbooks.map((b, i) => {
                    const owner = profiles[b.ownerId];
                    return (
                      <li
                        key={b.cookbookId}
                        className={cx(
                          "cc-row flex items-center gap-3 px-3 py-2",
                          i > 0 && "border-t border-[var(--cc-line-soft)]",
                        )}
                      >
                        <span className={cx(
                          "cc-num w-[26px] text-right text-[12px] font-semibold",
                          i === 0 ? "text-[var(--cc-gold)]" : "text-[var(--cc-ink-faint)]",
                        )}>
                          {i + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => navigate({ page: "cookbook", id: b.cookbookId })}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="block truncate text-[13px] font-semibold transition-colors hover:text-[var(--cc-ember)]">
                            {b.title}
                          </span>
                          <span className="block truncate text-[11px] text-[var(--cc-ink-faint)]">
                            {owner?.display_name ?? "Member"}
                          </span>
                        </button>
                        <span className="cc-num w-[62px] text-right text-[12px] text-[var(--cc-ink-muted)]">
                          {b.recipes}
                        </span>
                        <span className="cc-num w-[54px] text-right text-[13px] font-semibold text-[var(--cc-ember)]">
                          {b.saves}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Panel>
        </div>
      )}
    </Columns>
  );
}
