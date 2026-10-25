"use client";

// Leaderboards, with their own Cookbooks / Connect switch (owner's rule). It
// opens on the side of the app you are in, and either board is one tap away.
//
//   Cookbooks: most-saved cookbooks, top cooks (saves across all their books),
//              and restaurants by city from everyone's journals.
//   Connect:   one board per game — spades, chess, and any game added to
//              GAMES — plus all games together. Each game is ranked on that
//              game alone.
//
// Every board is a ledger: rank, name, and the numbers that produced the rank.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns, PageHead } from "../Columns";
import {
  loadCookbookLeaderboard, loadPlayerLeaderboard, loadProfiles, type ProfileMap,
} from "@/lib/cook-connect/social";
import {
  formatStreak, formatWinRate, QUALIFYING_GAMES,
  type CookbookStanding, type PlayerRecord,
} from "@/lib/cook-connect/stats";
import { GAMES, gameBoard, topCooks, type GameId, type Side } from "@/lib/cook-connect/sides";
import {
  Avatar, Button, EmptyState, Loading, Panel, SectionHead, Tag, cx,
} from "../ui";
import { BookmarkIcon, PlayIcon, TrophyIcon, UserIcon } from "../icons";
import { SideToggle } from "../SideToggle";
import { loadCityBoard } from "@/lib/cook-connect/journal";
import type { CityStanding } from "@/lib/cook-connect/types";

type GameFilter = GameId | "all";

export function LeaderboardsView() {
  const { sb, side } = useCook();
  const [board, setBoard] = useState<Side>(side);
  const [players, setPlayers] = useState<PlayerRecord[]>([]);
  const [cookbooks, setCookbooks] = useState<CookbookStanding[]>([]);
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [cityBoard, setCityBoard] = useState<CityStanding[]>([]);
  const [loading, setLoading] = useState(true);

  // Flipping the whole app also flips the board to match.
  useEffect(() => { setBoard(side); }, [side]);

  const load = useCallback(async () => {
    const [records, books, cityRows] = await Promise.all([
      loadPlayerLeaderboard(sb),
      loadCookbookLeaderboard(sb),
      loadCityBoard(sb),
    ]);
    setPlayers(records);
    setCookbooks(books);
    setCityBoard(cityRows);
    setProfiles(await loadProfiles(sb, [...records.map((r) => r.userId), ...books.map((b) => b.ownerId)]));
    setLoading(false);
  }, [sb]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Columns>
      <PageHead
        title="Leaderboards"
        subtitle={
          board === "connect"
            ? `Every game has its own board, ranked on that game alone: win rate first, wins break a tie. A record joins the ranked board at ${QUALIFYING_GAMES} games — until then it sits below as provisional, so a short hot streak can't top a long season.`
            : "Cookbooks rank on saves, cooks on every save their cookbooks have collected, and restaurants on everyone's journals."
        }
        action={
          <SideToggle
            side={board}
            onChange={setBoard}
            size="md"
            labels={{ cookbook: "Cookbooks", connect: "Connect" }}
          />
        }
      />

      {/* The board wears its own side's colour, whichever half of the app you're in. */}
      <div key={board} data-side={board} className="cc-side-enter">
        {loading ? (
          <Loading label="Counting" />
        ) : board === "connect" ? (
          <GameBoards players={players} profiles={profiles} />
        ) : (
          <CookbookBoards cookbooks={cookbooks} profiles={profiles} cityBoard={cityBoard} />
        )}
      </div>
    </Columns>
  );
}

/* ── Connect ───────────────────────────────────────────────────── */

function GameBoards({ players, profiles }: { players: PlayerRecord[]; profiles: ProfileMap }) {
  const { userId, navigate } = useCook();
  const [game, setGame] = useState<GameFilter>("spades");
  const rows = useMemo(() => gameBoard(players, game), [players, game]);
  const podium = rows.filter((r) => r.qualified).slice(0, 3);
  const label = game === "all" ? "All games" : GAMES.find((g) => g.id === game)?.label ?? game;

  /** How many people have played each game — shown on its chip. */
  const counts = useMemo(() => Object.fromEntries(
    [...GAMES.map((g) => g.id), "all" as const].map((id) => [id, gameBoard(players, id).length]),
  ), [players]);

  const chips: { id: GameFilter; label: string }[] = [
    ...GAMES.map((g) => ({ id: g.id as GameFilter, label: g.label })),
    { id: "all", label: "All games" },
  ];

  return (
    <>
      <div role="tablist" aria-label="Game" className="mb-3 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={game === c.id}
            onClick={() => setGame(c.id)}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold",
              "transition-colors duration-150",
              game === c.id
                ? "border-[var(--cc-ember)] bg-[var(--cc-ember-wash)] text-[var(--cc-ink)]"
                : "border-[var(--cc-line)] bg-[var(--cc-panel)] text-[var(--cc-ink-muted)] hover:text-[var(--cc-ink)]",
            )}
          >
            {c.label}
            <span className="cc-num text-[11px] opacity-60">{counts[c.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {podium.length > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          {podium.map((p, i) => {
            const person = profiles[p.userId];
            return (
              <button
                key={p.userId}
                type="button"
                onClick={() => navigate({ page: "profile", userId: p.userId })}
                className={cx(
                  "flex min-w-0 flex-col items-center gap-1 rounded-[var(--cc-radius)] border px-2 py-3 text-center",
                  "transition-colors duration-150 hover:border-[var(--cc-ember)]",
                  i === 0
                    ? "border-[#4a3f22] bg-[linear-gradient(180deg,rgba(232,194,106,0.14),transparent)]"
                    : "border-[var(--cc-line)] bg-[var(--cc-panel)]",
                )}
              >
                <span className={cx(
                  "cc-num text-[11px] font-bold uppercase tracking-[0.08em]",
                  i === 0 ? "text-[var(--cc-gold)]" : "text-[var(--cc-ink-faint)]",
                )}>
                  #{i + 1}
                </span>
                <Avatar id={p.userId} name={person?.display_name ?? "Member"} url={person?.avatar_url} size={i === 0 ? 40 : 32} />
                <span className="w-full truncate text-[13px] font-semibold">{person?.display_name ?? "Member"}</span>
                <span className="cc-num text-[12px] text-[var(--cc-ink-muted)]">
                  {formatWinRate(p.winRate)} · {p.wins}–{p.losses}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Panel>
        <SectionHead title={label} count={rows.length} />
        {rows.length === 0 ? (
          <EmptyState
            icon={<TrophyIcon size={26} />}
            title={game === "all" ? "No finished games yet" : `Nobody has finished a game of ${label.toLowerCase()} yet`}
            body="Finish one and the first name on this board will be yours."
            action={
              <Button variant="primary" onClick={() => navigate({ page: "play" })}>
                <PlayIcon size={14} />
                Open a table
              </Button>
            }
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
              <span className="hidden w-[42px] text-right sm:block">Run</span>
            </div>
            <ul>
              {rows.map((p, i) => {
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
                      <Avatar id={p.userId} name={person?.display_name ?? "Member"} url={person?.avatar_url} size={24} />
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold transition-colors hover:text-[var(--cc-ember)]">
                          {person?.display_name ?? "Member"}
                        </span>
                        {isMe && <Tag tone="ember">You</Tag>}
                        {!p.qualified && <Tag>Provisional</Tag>}
                      </span>
                    </button>
                    <span className="cc-num w-[42px] text-right text-[12px] text-[var(--cc-ink-muted)]">{p.played}</span>
                    <span className="cc-num w-[62px] text-right text-[12px]">{p.wins}–{p.losses}</span>
                    <span className="cc-num w-[46px] text-right text-[13px] font-semibold">{formatWinRate(p.winRate)}</span>
                    <span className={cx(
                      "cc-num hidden w-[42px] text-right text-[12px] sm:block",
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
    </>
  );
}

/* ── Cookbooks ─────────────────────────────────────────────────── */

function CookbookBoards({
  cookbooks, profiles, cityBoard,
}: { cookbooks: CookbookStanding[]; profiles: ProfileMap; cityBoard: CityStanding[] }) {
  const { userId, navigate } = useCook();
  const cooks = useMemo(() => topCooks(cookbooks), [cookbooks]);

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-2">
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
                      className={cx("cc-row flex items-center gap-3 px-3 py-2", i > 0 && "border-t border-[var(--cc-line-soft)]")}
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
                      <span className="cc-num w-[62px] text-right text-[12px] text-[var(--cc-ink-muted)]">{b.recipes}</span>
                      <span className="cc-num w-[54px] text-right text-[13px] font-semibold text-[var(--cc-ember)]">{b.saves}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Panel>

        <Panel>
          <SectionHead title="Top cooks" count={cooks.length} />
          {cooks.length === 0 ? (
            <EmptyState
              icon={<UserIcon size={26} />}
              title="No cooks ranked yet"
              body="A cook ranks on every save their public cookbooks collect."
            />
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-[var(--cc-line-soft)] px-3 py-1.5
                              text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--cc-ink-faint)]">
                <span className="w-[26px] text-right">#</span>
                <span className="flex-1">Cook</span>
                <span className="w-[50px] text-right">Books</span>
                <span className="w-[58px] text-right">Recipes</span>
                <span className="w-[54px] text-right">Saves</span>
              </div>
              <ul>
                {cooks.map((c, i) => {
                  const person = profiles[c.ownerId];
                  const isMe = c.ownerId === userId;
                  return (
                    <li
                      key={c.ownerId}
                      className={cx(
                        "cc-row flex items-center gap-3 px-3 py-2",
                        i > 0 && "border-t border-[var(--cc-line-soft)]",
                        isMe && "bg-[var(--cc-ember-wash)]",
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
                        onClick={() => navigate({ page: "profile", userId: c.ownerId })}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <Avatar id={c.ownerId} name={person?.display_name ?? "Member"} url={person?.avatar_url} size={24} />
                        <span className="truncate text-[13px] font-semibold transition-colors hover:text-[var(--cc-ember)]">
                          {person?.display_name ?? "Member"}
                        </span>
                        {isMe && <Tag tone="ember">You</Tag>}
                      </button>
                      <span className="cc-num w-[50px] text-right text-[12px] text-[var(--cc-ink-muted)]">{c.cookbooks}</span>
                      <span className="cc-num w-[58px] text-right text-[12px] text-[var(--cc-ink-muted)]">{c.recipes}</span>
                      <span className="cc-num w-[54px] text-right text-[13px] font-semibold text-[var(--cc-ember)]">{c.saves}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Panel>
      </div>

      <Panel className="mt-4">
        <SectionHead title="Restaurants, by city" count={cityBoard.length} />
        {cityBoard.length === 0 ? (
          <EmptyState
            icon={<TrophyIcon size={26} />}
            title="No cities logged yet"
            body="This board is built from everyone's journals. Write down a city and the places you liked, and they start counting here."
            action={<Button variant="primary" onClick={() => navigate({ page: "journal" })}>Open your journal</Button>}
          />
        ) : (
          <div className="divide-y divide-[var(--cc-line-soft)]">
            {cityBoard.map((city) => (
              <div key={city.city} className="px-3 py-2.5">
                <h3 className="mb-1.5 flex items-baseline gap-2 text-[13px] font-semibold">
                  {city.city}
                  <span className="cc-num text-[11px] font-normal text-[var(--cc-ink-faint)]">
                    {city.restaurants.length} place{city.restaurants.length === 1 ? "" : "s"}
                  </span>
                </h3>
                <ul>
                  {city.restaurants.slice(0, 5).map((r, i) => (
                    <li key={r.name} className="flex items-center gap-3 py-1">
                      <span className={cx(
                        "cc-num w-[20px] shrink-0 text-right text-[11px] font-semibold",
                        i === 0 ? "text-[var(--cc-gold)]" : "text-[var(--cc-ink-faint)]",
                      )}>
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold">{r.name}</span>
                        {r.cuisine && (
                          <span className="block truncate text-[11px] text-[var(--cc-ink-faint)]">{r.cuisine}</span>
                        )}
                      </span>
                      <span className="cc-num w-[52px] shrink-0 text-right text-[11px] text-[var(--cc-ink-muted)]">
                        {r.fans} fan{r.fans === 1 ? "" : "s"}
                      </span>
                      <span className="cc-num w-[46px] shrink-0 text-right text-[12px] font-semibold text-[var(--cc-gold)]">
                        {r.avgRating > 0 ? r.avgRating.toFixed(1) : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
