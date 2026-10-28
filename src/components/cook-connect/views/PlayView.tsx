"use client";

// The lobby. Three ways in: rejoin something you are already in, take a free
// seat at someone's table, or open a new one. The computer fills any seat
// nobody takes, so a game never waits on a fourth.

import { useCallback, useEffect, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns, PageHead } from "../Columns";
import {
  createMatch, findSpadesTable, loadLiveMatches, loadOpenTables, joinMatch, type OpenTable,
} from "@/lib/cook-connect/matches";
import { loadProfiles, type ProfileMap } from "@/lib/cook-connect/social";
import { LEVEL_LABELS, type Level } from "@/lib/cook-connect/chessAi";
import {
  Avatar, Button, EmptyState, Loading, Panel, SectionHead, Select, Tag, cx, relativeTime,
} from "../ui";
import { BotIcon, PlayIcon } from "../icons";
import { LoungeDock } from "../play/LoungeDock";
import { ActivityFeed } from "../social/ActivityFeed";
import { OnlineRail } from "../social/OnlineRail";

export function PlayView() {
  const { sb, userId, navigate, notify } = useCook();
  const [open, setOpen] = useState<OpenTable[]>([]);
  const [mine, setMine] = useState<OpenTable[]>([]);
  const [names, setNames] = useState<ProfileMap>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState<Level>("medium");

  const load = useCallback(async () => {
    if (!userId) return;
    const [tables, live] = await Promise.all([loadOpenTables(sb), loadLiveMatches(sb, userId)]);
    const liveIds = new Set(live.map((t) => t.match.id));
    setMine(live);
    setOpen(tables.filter((t) => !liveIds.has(t.match.id)));
    setNames(await loadProfiles(
      sb,
      [...tables, ...live].flatMap((t) => t.players.filter((p) => !p.is_bot).map((p) => p.user_id)),
    ));
    setLoading(false);
  }, [sb, userId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  // Live: a table opening, filling or starting shows up without a refresh.
  // Changes are batched for a moment so a burst of seat writes is one reload.
  useEffect(() => {
    if (!userId) return;
    let pendingReload: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (pendingReload) clearTimeout(pendingReload);
      pendingReload = setTimeout(() => void load(), 400);
    };
    const channel = sb
      .channel(`lobby:${userId}`)
      .on("postgres_changes", { event: "*", schema: "cook", table: "matches" }, soon)
      .on("postgres_changes", { event: "*", schema: "cook", table: "match_players" }, soon)
      .subscribe();
    return () => {
      if (pendingReload) clearTimeout(pendingReload);
      sb.removeChannel(channel);
    };
  }, [sb, userId, load]);

  const goTo = (table: OpenTable) =>
    navigate({ page: table.match.game === "spades" ? "spades" : "chess", matchId: table.match.id });

  const start = async (game: "spades" | "chess", withBots: boolean) => {
    if (!userId) return;
    setBusy(true);
    const matchId = await createMatch(sb, {
      game, userId, isPublic: true, withBots,
      botLevel: game === "chess" ? level : undefined,
    });
    setBusy(false);
    navigate({ page: game === "spades" ? "spades" : "chess", matchId });
  };

  /** "Find real players": sit with whoever is already waiting, or start waiting. */
  const findPlayers = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      const { matchId, joined } = await findSpadesTable(sb, userId);
      notify(joined ? "Found a table. Say hello while you decide." : "You're first. We'll seat the next person who searches with you.");
      navigate({ page: "spades", matchId });
    } catch {
      notify("Couldn't look for players just now. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const take = async (table: OpenTable) => {
    if (!userId) return;
    setBusy(true);
    const ok = await joinMatch(sb, table.match.id, userId);
    setBusy(false);
    if (!ok) { notify("Someone took that seat first."); void load(); return; }
    goTo(table);
  };

  return (
    <Columns rail={<><OnlineRail /><LoungeDock /></>}>
      <PageHead
        title="Play"
        subtitle="Spades is four seats in two partnerships. Chess is two. Play the computer right away, or find real people and decide together whether to wait or bring in bots."
      />

      {mine.length > 0 && (
        <Panel className="mb-4">
          <SectionHead title="Your games" count={mine.length} />
          <ul>
            {mine.map((t, i) => (
              <li
                key={t.match.id}
                className={cx(
                  "cc-row flex items-center gap-3 px-3 py-2.5",
                  i > 0 && "border-t border-[var(--cc-line-soft)]",
                )}
              >
                <Seats table={t} names={names} />
                <button type="button" onClick={() => goTo(t)} className="min-w-0 flex-1 text-left">
                  <span className="block text-[13px] font-semibold capitalize transition-colors hover:text-[var(--cc-ember)]">
                    {t.match.game}
                  </span>
                  <span className="block text-[11px] text-[var(--cc-ink-faint)]">
                    started {relativeTime(t.match.created_at)}
                  </span>
                </button>
                <Tag tone={t.match.status === "live" ? "live" : "neutral"}>
                  {t.match.status === "live" ? "In play" : `${t.seatsFree} seat${t.seatsFree === 1 ? "" : "s"} free`}
                </Tag>
                <Button variant="primary" onClick={() => goTo(t)}>Resume</Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <Panel>
          <SectionHead title="Spades" />
          <div className="p-3">
            <p className="text-[13px] leading-relaxed text-[var(--cc-ink-muted)]">
              Bid what you can take, then take it. Partners sit across from each other and share one bid —
              ten a trick when your team makes it, no bags. First to 500 wins.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button variant="primary" disabled={busy} onClick={() => void findPlayers()}>
                <PlayIcon size={14} />
                Find real players
              </Button>
              <Button disabled={busy} onClick={() => void start("spades", true)}>
                <BotIcon size={14} />
                Play bots now
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--cc-ink-faint)]">
              Bots now: you and a computer partner against two computers. Find players: you can chat and
              video with whoever turns up, then wait for four or all agree to fill the rest with bots.
            </p>
          </div>
        </Panel>

        <Panel>
          <SectionHead title="Chess" />
          <div className="p-3">
            <p className="text-[13px] leading-relaxed text-[var(--cc-ink-muted)]">
              Standard rules, with draws by repetition, stalemate and the fifty-move rule all detected.
              Colours are drawn at random.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Button variant="primary" disabled={busy} onClick={() => void start("chess", false)}>
                <PlayIcon size={14} />
                Open a board
              </Button>
              <Button disabled={busy} onClick={() => void start("chess", true)}>
                <BotIcon size={14} />
                Play the computer
              </Button>
              <Select
                value={level}
                onChange={(e) => setLevel(e.target.value as Level)}
                aria-label="Computer strength"
                className="w-[110px]"
              >
                {(Object.keys(LEVEL_LABELS) as Level[]).map((l) => (
                  <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
                ))}
              </Select>
            </div>
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionHead title="Open tables" count={open.length} />
        {loading ? (
          <Loading label="Looking for games" />
        ) : open.length === 0 ? (
          <EmptyState
            icon={<PlayIcon size={26} />}
            title="Nobody is waiting"
            body="Search for players and your table appears here for everyone. Whoever joins can chat with you while you decide to wait or play with bots."
            action={
              <Button variant="primary" disabled={busy} onClick={() => void findPlayers()}>
                Find spades players
              </Button>
            }
          />
        ) : (
          <ul>
            {open.map((t, i) => (
              <li
                key={t.match.id}
                className={cx(
                  "cc-row flex items-center gap-3 px-3 py-2.5",
                  i > 0 && "border-t border-[var(--cc-line-soft)]",
                )}
              >
                <Seats table={t} names={names} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold capitalize">{t.match.game}</span>
                  <span className="block truncate text-[11px] text-[var(--cc-ink-faint)]">
                    {t.players
                      .filter((p) => !p.is_bot)
                      .map((p) => names[p.user_id]?.display_name ?? "Member")
                      .join(", ") || "Nobody seated"}
                    {" · opened "}{relativeTime(t.match.created_at)}
                  </span>
                </span>
                <Tag tone="live">{t.seatsFree} free</Tag>
                <Button variant="primary" disabled={busy} onClick={() => void take(t)}>
                  Take a seat
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="mt-4">
        <ActivityFeed />
      </div>
    </Columns>
  );
}

function Seats({ table, names }: { table: OpenTable; names: ProfileMap }) {
  const capacity = table.match.game === "spades" ? 4 : 2;
  return (
    <span className="flex shrink-0 -space-x-1.5">
      {Array.from({ length: capacity }, (_, seat) => {
        const player = table.players.find((p) => p.seat === seat);
        if (!player) {
          return (
            <span
              key={seat}
              title="Open seat"
              className="h-[26px] w-[26px] rounded-full border-2 border-dashed border-[var(--cc-line)]
                         bg-[var(--cc-panel)]"
            />
          );
        }
        if (player.is_bot) {
          return (
            <span
              key={seat}
              title="Computer player"
              className="flex h-[26px] w-[26px] items-center justify-center rounded-full border-2
                         border-[var(--cc-panel)] bg-[var(--cc-elevated)] text-[var(--cc-ink-faint)]"
            >
              <BotIcon size={13} />
            </span>
          );
        }
        return (
          <span key={seat} className="rounded-full border-2 border-[var(--cc-panel)]">
            <Avatar
              id={player.user_id}
              name={names[player.user_id]?.display_name ?? "Member"}
              url={names[player.user_id]?.avatar_url}
              size={22}
            />
          </span>
        );
      })}
    </span>
  );
}
