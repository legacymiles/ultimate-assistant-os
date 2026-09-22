"use client";

// Find and search friends. A directory row carries everything you would want
// before deciding: who they are, where they cook, how they play, and the two
// things you can do about it — follow them, or challenge them.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns, PageHead } from "../Columns";
import {
  loadFollowGraph, loadPlayerLeaderboard, searchPeople, toggleFollow, countRecipes, loadCookbooks,
} from "@/lib/cook-connect/social";
import { formatWinRate, type PlayerRecord } from "@/lib/cook-connect/stats";
import { createMatch } from "@/lib/cook-connect/matches";
import type { Profile } from "@/lib/cook-connect/types";
import {
  Avatar, Button, EmptyState, Loading, Panel, SearchField, SectionHead, TabStrip, cx,
} from "../ui";
import { PeopleIcon, PlayIcon, SearchIcon } from "../icons";

type Scope = "all" | "following" | "followers";

export function PeopleView() {
  const { sb, userId, navigate, onlineIds, notify } = useCook();
  const [term, setTerm] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [people, setPeople] = useState<Profile[]>([]);
  const [records, setRecords] = useState<Record<string, PlayerRecord>>({});
  const [cookbookCounts, setCookbookCounts] = useState<Record<string, number>>({});
  const [graph, setGraph] = useState({ following: new Set<string>(), followers: new Set<string>() });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [rows, board, followGraph, books, recipeCounts] = await Promise.all([
      searchPeople(sb, ""),
      loadPlayerLeaderboard(sb),
      loadFollowGraph(sb, userId),
      loadCookbooks(sb, { publicOnly: true }),
      countRecipes(sb),
    ]);
    setPeople(rows);
    setRecords(Object.fromEntries(board.map((r) => [r.userId, r])));
    setGraph({ following: followGraph.following, followers: followGraph.followers });
    const perOwner: Record<string, number> = {};
    for (const b of books) perOwner[b.owner_id] = (perOwner[b.owner_id] ?? 0) + 1;
    setCookbookCounts(perOwner);
    void recipeCounts;
    setLoading(false);
  }, [sb, userId]);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return people
      .filter((p) => p.id !== userId)
      .filter((p) => (
        scope === "all"
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

  const challenge = async (target: Profile, game: "spades" | "chess") => {
    if (!userId) return;
    setBusy(target.id);
    const matchId = await createMatch(sb, { game, userId, isPublic: true });
    setBusy(null);
    notify(`Table opened. ${target.display_name} can take a seat from the lobby.`);
    navigate({ page: game === "spades" ? "spades" : "chess", matchId });
  };

  return (
    <Columns>
      <PageHead
        title="People"
        subtitle="Search by name, handle or city. Follow a cook to pull their cookbooks into your feed, or open a table and call them over."
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--cc-line)] p-2">
          <div className="min-w-[200px] flex-1">
            <SearchField
              value={term}
              onChange={setTerm}
              placeholder="Name, handle or city"
              icon={<SearchIcon size={14} />}
            />
          </div>
          <TabStrip
            tabs={[
              { id: "all" as const, label: "Everyone" },
              { id: "following" as const, label: "Following", count: graph.following.size },
              { id: "followers" as const, label: "Followers", count: graph.followers.size },
            ]}
            active={scope}
            onChange={setScope}
          />
        </div>

        <SectionHead title={scope === "all" ? "Members" : scope} count={shown.length} />

        {loading ? (
          <Loading label="Finding people" />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<PeopleIcon size={26} />}
            title={term ? `Nobody matches "${term}"` : "No one here yet"}
            body={
              term
                ? "Try a first name, a handle, or the city someone cooks in."
                : scope === "following"
                  ? "You are not following anyone yet. Switch to Everyone and pick a few cooks."
                  : "Nobody has followed you yet. Publishing a cookbook is the fastest way to change that."
            }
          />
        ) : (
          <>
            {/* Column headings. Only worth showing where the row is a table. */}
            <div className="hidden items-center gap-3 border-b border-[var(--cc-line-soft)] px-3 py-1.5
                            text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--cc-ink-faint)] lg:flex">
              <span className="flex-1">Member</span>
              <span className="w-[120px]">City</span>
              <span className="w-[54px] text-right">Books</span>
              <span className="w-[70px] text-right">Record</span>
              <span className="w-[48px] text-right">Win %</span>
              <span className="w-[232px]" />
            </div>

            <ul>
              {shown.map((p, i) => {
                const record = records[p.id];
                const isFollowing = graph.following.has(p.id);
                return (
                  <li
                    key={p.id}
                    className={cx(
                      "cc-row flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5",
                      i > 0 && "border-t border-[var(--cc-line-soft)]",
                    )}
                  >
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
                    <span className="cc-num hidden w-[54px] text-right text-[12px] text-[var(--cc-ink-muted)] lg:block">
                      {cookbookCounts[p.id] ?? 0}
                    </span>
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
                        onClick={() => void challenge(p, "spades")}
                        title={`Open a spades table and invite ${p.display_name}`}
                      >
                        <PlayIcon size={13} />
                        Spades
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy === p.id}
                        onClick={() => void challenge(p, "chess")}
                        title={`Open a chess board and invite ${p.display_name}`}
                      >
                        Chess
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel>
    </Columns>
  );
}
