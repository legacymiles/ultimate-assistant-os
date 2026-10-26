"use client";

// Data access for everything social: people, follows, saves, the feed, and the
// two leaderboards. These are plain functions over a backend handle so the
// views stay about layout and the queries stay testable in one place.

import type {
  Activity, Cookbook, Match, MatchPlayer, Profile, Recipe,
} from "./types";
import { leaderboard, rankCookbooks, type MatchResult, type PlayerRecord, type CookbookStanding } from "./stats";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Backend = any;

/** Index a profile list by id so views can look names up without another query. */
export type ProfileMap = Record<string, Profile>;

export async function loadProfiles(sb: Backend, ids?: string[]): Promise<ProfileMap> {
  let query = sb.from("profiles").select("*");
  if (ids && ids.length) query = query.in("id", [...new Set(ids)]);
  const { data } = await query;
  const map: ProfileMap = {};
  for (const p of (data ?? []) as Profile[]) map[p.id] = p;
  return map;
}

export async function searchPeople(sb: Backend, term: string): Promise<Profile[]> {
  const trimmed = term.trim();
  const { data } = await sb.from("profiles").select("*").order("display_name");
  const all = (data ?? []) as Profile[];
  if (!trimmed) return all;
  const needle = trimmed.toLowerCase();
  return all.filter((p) =>
    p.display_name.toLowerCase().includes(needle)
    || p.handle.toLowerCase().includes(needle)
    || (p.city ?? "").toLowerCase().includes(needle)
    || (p.bio ?? "").toLowerCase().includes(needle),
  );
}

export interface FollowGraph {
  /** Ids this user follows. */
  following: Set<string>;
  /** Ids following this user. */
  followers: Set<string>;
  /** How many people follow each id. */
  followerCount: Record<string, number>;
}

export async function loadFollowGraph(sb: Backend, userId: string | null): Promise<FollowGraph> {
  const { data } = await sb.from("follows").select("*");
  const rows = (data ?? []) as { follower_id: string; following_id: string }[];
  const followerCount: Record<string, number> = {};
  const following = new Set<string>();
  const followers = new Set<string>();
  for (const r of rows) {
    followerCount[r.following_id] = (followerCount[r.following_id] ?? 0) + 1;
    if (userId && r.follower_id === userId) following.add(r.following_id);
    if (userId && r.following_id === userId) followers.add(r.follower_id);
  }
  return { following, followers, followerCount };
}

export async function toggleFollow(sb: Backend, userId: string, targetId: string, isFollowing: boolean) {
  if (isFollowing) {
    await sb.from("follows").delete().eq("follower_id", userId).eq("following_id", targetId);
    return;
  }
  await sb.from("follows").insert({ follower_id: userId, following_id: targetId });
  await recordActivity(sb, {
    kind: "followed", actor_id: userId, subject_id: targetId, summary: "followed someone new",
  });
}

export async function loadSaves(sb: Backend): Promise<{ byCookbook: Record<string, number>; mine: Set<string> }> {
  const { data } = await sb.from("cookbook_saves").select("*");
  const rows = (data ?? []) as { cookbook_id: string; user_id: string }[];
  const byCookbook: Record<string, number> = {};
  for (const r of rows) byCookbook[r.cookbook_id] = (byCookbook[r.cookbook_id] ?? 0) + 1;
  return { byCookbook, mine: new Set(rows.map((r) => r.cookbook_id)) };
}

export async function mySaves(sb: Backend, userId: string): Promise<Set<string>> {
  const { data } = await sb.from("cookbook_saves").select("*").eq("user_id", userId);
  return new Set(((data ?? []) as { cookbook_id: string }[]).map((r) => r.cookbook_id));
}

export async function toggleSave(
  sb: Backend, userId: string, cookbook: Cookbook, isSaved: boolean,
) {
  if (isSaved) {
    await sb.from("cookbook_saves").delete().eq("user_id", userId).eq("cookbook_id", cookbook.id);
    return;
  }
  await sb.from("cookbook_saves").insert({ user_id: userId, cookbook_id: cookbook.id });
  await recordActivity(sb, {
    kind: "cookbook_saved", actor_id: userId, subject_id: cookbook.id,
    summary: `saved ${cookbook.title}`,
  });
}

export async function recordActivity(
  sb: Backend,
  entry: { kind: Activity["kind"]; actor_id: string; subject_id: string | null; summary: string },
) {
  await sb.from("activity").insert({ ...entry, created_at: new Date().toISOString() });
}

export interface FeedEntry extends Activity {
  actor: Profile | null;
  /** How many identical entries this row stands for. 1 unless collapsed. */
  count: number;
}

/**
 * A good run at the table writes one activity row per win, which then fills
 * the feed with the same sentence over and over. Collapse a consecutive run
 * from one person into a single row that says how many.
 */
function collapseRuns(rows: Activity[]): (Activity & { count: number })[] {
  const out: (Activity & { count: number })[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    const mergeable = row.kind === "match_won" || row.kind === "followed";
    if (last && mergeable && last.kind === row.kind && last.actor_id === row.actor_id) {
      last.count += 1;
      continue;
    }
    out.push({ ...row, count: 1 });
  }
  return out;
}

/** "won a game of spades" → "won 4 games of spades". */
export function feedSummary(entry: FeedEntry): string {
  if (entry.count < 2) return entry.summary;
  if (entry.kind === "match_won") {
    const game = entry.summary.split("of ").pop() ?? "cards";
    return `won ${entry.count} games of ${game}`;
  }
  if (entry.kind === "followed") return `followed ${entry.count} new people`;
  return entry.summary;
}

/**
 * The feed. `following` narrows it to people this user follows plus their own
 * activity; without it the feed is everything, which is what a new account
 * needs to see.
 */
export async function loadFeed(
  sb: Backend,
  opts: { userId: string | null; following?: Set<string>; limit?: number; kinds?: string[] },
): Promise<FeedEntry[]> {
  const { data } = await sb.from("activity").select("*").order("created_at", { ascending: false }).limit(400);
  let rows = (data ?? []) as Activity[];
  // Each half of the app has its own feed: cooking on Cookbook, games on Connect.
  if (opts.kinds) {
    const kinds = new Set(opts.kinds);
    rows = rows.filter((r) => kinds.has(r.kind));
  }
  if (opts.following && opts.following.size > 0) {
    rows = rows.filter((r) => opts.following!.has(r.actor_id) || r.actor_id === opts.userId);
  }
  const collapsed = collapseRuns(rows).slice(0, opts.limit ?? 60);
  const profiles = await loadProfiles(sb, collapsed.map((r) => r.actor_id));
  return collapsed.map((r) => ({ ...r, actor: profiles[r.actor_id] ?? null }));
}

/* ── Leaderboards ──────────────────────────────────────────────── */

export async function loadPlayerLeaderboard(sb: Backend): Promise<PlayerRecord[]> {
  return leaderboard(await loadMatchResults(sb));
}

/** Every finished, human result, oldest-agnostic (ranking sorts them itself). */
export async function loadMatchResults(sb: Backend): Promise<MatchResult[]> {
  const [{ data: matchRows }, { data: playerRows }] = await Promise.all([
    sb.from("matches").select("*").eq("status", "done"),
    sb.from("match_players").select("*"),
  ]);
  const matches = new Map(((matchRows ?? []) as Match[]).map((m) => [m.id, m]));
  const results: MatchResult[] = [];
  for (const p of (playerRows ?? []) as MatchPlayer[]) {
    const match = matches.get(p.match_id);
    if (!match || p.is_bot || !p.result) continue;
    results.push({
      userId: p.user_id,
      result: p.result,
      game: match.game,
      finishedAt: match.finished_at ?? match.updated_at,
      matchId: match.id,
    });
  }
  return results;
}

export async function loadCookbookLeaderboard(sb: Backend): Promise<CookbookStanding[]> {
  const [{ data: books }, { data: saves }, { data: recipes }] = await Promise.all([
    sb.from("cookbooks").select("*").eq("privacy", "public"),
    sb.from("cookbook_saves").select("*"),
    sb.from("recipes").select("*"),
  ]);
  const saveCount: Record<string, number> = {};
  for (const s of (saves ?? []) as { cookbook_id: string }[]) {
    saveCount[s.cookbook_id] = (saveCount[s.cookbook_id] ?? 0) + 1;
  }
  const recipeCount: Record<string, number> = {};
  for (const r of (recipes ?? []) as Recipe[]) {
    recipeCount[r.cookbook_id] = (recipeCount[r.cookbook_id] ?? 0) + 1;
  }
  return rankCookbooks(((books ?? []) as Cookbook[]).map((c) => ({
    cookbookId: c.id,
    title: c.title,
    ownerId: c.owner_id,
    saves: saveCount[c.id] ?? 0,
    recipes: recipeCount[c.id] ?? 0,
  })));
}

/* ── Cookbooks ─────────────────────────────────────────────────── */

export async function loadCookbooks(sb: Backend, opts: { ownerId?: string; publicOnly?: boolean } = {}) {
  let query = sb.from("cookbooks").select("*").order("updated_at", { ascending: false });
  if (opts.ownerId) query = query.eq("owner_id", opts.ownerId);
  if (opts.publicOnly) query = query.eq("privacy", "public");
  const { data } = await query;
  return (data ?? []) as Cookbook[];
}

export async function loadRecipes(sb: Backend, cookbookId: string): Promise<Recipe[]> {
  const { data } = await sb.from("recipes").select("*").eq("cookbook_id", cookbookId).order("position");
  return (data ?? []) as Recipe[];
}

export async function countRecipes(sb: Backend): Promise<Record<string, number>> {
  const { data } = await sb.from("recipes").select("*");
  const counts: Record<string, number> = {};
  for (const r of (data ?? []) as Recipe[]) counts[r.cookbook_id] = (counts[r.cookbook_id] ?? 0) + 1;
  return counts;
}
