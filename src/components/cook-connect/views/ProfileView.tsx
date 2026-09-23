"use client";

// A member: their cookbooks and their game record on one page, because in
// Cook Connect those are the same person.

import { useCallback, useEffect, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns } from "../Columns";
import {
  countRecipes, loadCookbooks, loadFollowGraph, loadPlayerLeaderboard, loadSaves, toggleFollow,
} from "@/lib/cook-connect/social";
import { formatStreak, formatWinRate, QUALIFYING_GAMES, type PlayerRecord } from "@/lib/cook-connect/stats";
import { createMatch } from "@/lib/cook-connect/matches";
import { rooms } from "@/lib/cook-connect/types";
import type { Cookbook, Profile } from "@/lib/cook-connect/types";
import {
  Avatar, Button, EmptyState, Loading, Panel, SectionHead, Tag, cx,
} from "../ui";
import { BookIcon, BookmarkIcon, PlayIcon } from "../icons";
import { ChatPanel } from "../play/ChatPanel";

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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const isMe = targetId === userId;

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data }, allBooks, counts, saves, board, graph] = await Promise.all([
      sb.from("profiles").select("*").eq("id", targetId).maybeSingle(),
      loadCookbooks(sb, { ownerId: targetId }),
      countRecipes(sb),
      loadSaves(sb),
      loadPlayerLeaderboard(sb),
      loadFollowGraph(sb, userId),
    ]);
    setPerson((data as Profile) ?? null);
    setBooks(allBooks.filter((b) => b.privacy === "public" || b.owner_id === userId));
    setRecipeCounts(counts);
    setSaveCounts(saves.byCookbook);
    setRecord(board.find((r) => r.userId === targetId) ?? null);
    setFollowers(graph.followerCount[targetId] ?? 0);
    setIsFollowing(graph.following.has(targetId));
    const { data: theirFollows } = await sb.from("follows").select("*").eq("follower_id", targetId);
    setFollowingCount(((theirFollows ?? []) as unknown[]).length);
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
      <Panel className="mb-4 p-4">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar
            id={person.id}
            name={person.display_name}
            url={person.avatar_url}
            size={64}
            online={onlineIds.has(person.id)}
          />
          <div className="min-w-[220px] flex-1">
            <h1 className="text-[20px] font-bold leading-tight tracking-tight">{person.display_name}</h1>
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
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
              <Stat label="Cookbooks" value={books.length} />
              <Stat label="Followers" value={followers} />
              <Stat label="Following" value={followingCount} />
              <Stat label="Games" value={record?.played ?? 0} />
            </dl>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {isMe ? (
              <Button variant="primary" onClick={() => navigate({ page: "new-cookbook" })}>
                <BookIcon size={14} />
                New cookbook
              </Button>
            ) : (
              <>
                <Button variant={isFollowing ? "secondary" : "primary"} disabled={busy} onClick={() => void follow()}>
                  {isFollowing ? "Following" : "Follow"}
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

      {isMe && mine && (
        <p className="mt-3 text-[12px] text-[var(--cc-ink-faint)]">
          This is how everyone else sees you.
        </p>
      )}
    </Columns>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[var(--cc-ink-faint)]">{label}</dt>
      <dd className="cc-num font-semibold">{value}</dd>
    </div>
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
