// Cook Connect is two apps in one account (owner's rule, Oct 2026):
//
//   Cookbook — cookbooks, recipes, the journal, groups of people who cook alike.
//   Connect  — the games: spades, chess, and whatever joins them.
//
// One profile, one follow graph, one set of followers across both. Explore and
// the leaderboards exist on both sides but show that side's things. This file
// is the pure part: which side a screen belongs to, the game catalogue, and the
// rankings each side's board needs.

import type { CookbookStanding, PlayerRecord } from "./stats";
import { QUALIFYING_GAMES } from "./stats";

export type Side = "cookbook" | "connect";

export const SIDES: { id: Side; label: string; blurb: string }[] = [
  { id: "cookbook", label: "Cookbook", blurb: "Cookbooks, recipes and the cooks behind them" },
  { id: "connect", label: "Connect", blurb: "Spades, chess and the people you play" },
];

/**
 * Which side a page lives on. `null` means it is shared — Explore, a profile,
 * the leaderboards — and shows whichever side you are on.
 */
export function sideOfPage(page: string): Side | null {
  switch (page) {
    case "cookbooks":
    case "cookbook":
    case "recipe":
    case "new-recipe":
    case "new-cookbook":
    case "shared":
    case "journal":
    case "group":
      return "cookbook";
    case "play":
    case "spades":
    case "chess":
      return "connect";
    default:
      return null;
  }
}

/** The side a route lands on: its own side if it has one, else where you are. */
export const landingSide = (page: string, current: Side): Side => sideOfPage(page) ?? current;

/** Each side's front door. */
export const HOME_PAGE: Record<Side, "cookbooks" | "play"> = {
  cookbook: "cookbooks",
  connect: "play",
};

/** The other side, for the toggle. */
export const otherSide = (side: Side): Side => (side === "cookbook" ? "connect" : "cookbook");

/** A remembered side from storage, or the default when it is missing or junk. */
export function parseSide(raw: unknown, fallback: Side = "cookbook"): Side {
  return raw === "cookbook" || raw === "connect" ? raw : fallback;
}

/* ── Games on the Connect side ─────────────────────────────────── */

export type GameId = keyof PlayerRecord["byGame"];

/**
 * Every game Connect offers. The leaderboard, Explore invites and the lobby
 * read this list, so adding a game here puts it everywhere a game is listed.
 */
export const GAMES: { id: GameId; label: string; seats: number; blurb: string }[] = [
  { id: "spades", label: "Spades", seats: 4, blurb: "Four seats, two partnerships, first to 500" },
  { id: "chess", label: "Chess", seats: 2, blurb: "Two players, standard rules" },
];

export interface GameStanding {
  userId: string;
  played: number;
  wins: number;
  losses: number;
  /** 0–1 */
  winRate: number;
  qualified: boolean;
  /** Overall streak — the record does not keep one per game. */
  streak: number;
}

/**
 * One game's board. Ranked on that game alone — a chess champion who has never
 * played spades is not on the spades board, and their chess rate does not lift
 * their spades rank. Same rules as the overall board: qualified first, then
 * win rate, then wins, then fewer games, then id so the order never wobbles.
 */
export function gameBoard(records: PlayerRecord[], game: GameId | "all"): GameStanding[] {
  const rows: GameStanding[] = records
    .map((r) => {
      if (game === "all") {
        return {
          userId: r.userId, played: r.played, wins: r.wins, losses: r.losses,
          winRate: r.winRate, qualified: r.qualified, streak: r.streak,
        };
      }
      const g = r.byGame[game];
      return {
        userId: r.userId,
        played: g.played,
        wins: g.wins,
        losses: g.played - g.wins,
        winRate: g.played === 0 ? 0 : g.wins / g.played,
        qualified: g.played >= QUALIFYING_GAMES,
        streak: r.streak,
      };
    })
    .filter((r) => r.played > 0);

  return rows.sort((a, b) => {
    if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.played !== b.played) return a.played - b.played;
    return a.userId.localeCompare(b.userId);
  });
}

/* ── Cooks on the Cookbook side ────────────────────────────────── */

export interface CookStanding {
  ownerId: string;
  saves: number;
  cookbooks: number;
  recipes: number;
}

/**
 * Top cooks: every save across a cook's public cookbooks, added up. Ties go to
 * the cook with more recipes, then more cookbooks, then id.
 */
export function topCooks(books: CookbookStanding[]): CookStanding[] {
  const byOwner = new Map<string, CookStanding>();
  for (const b of books) {
    const row = byOwner.get(b.ownerId) ?? { ownerId: b.ownerId, saves: 0, cookbooks: 0, recipes: 0 };
    row.saves += b.saves;
    row.cookbooks += 1;
    row.recipes += b.recipes;
    byOwner.set(b.ownerId, row);
  }
  return [...byOwner.values()].sort((a, b) => {
    if (b.saves !== a.saves) return b.saves - a.saves;
    if (b.recipes !== a.recipes) return b.recipes - a.recipes;
    if (b.cookbooks !== a.cookbooks) return b.cookbooks - a.cookbooks;
    return a.ownerId.localeCompare(b.ownerId);
  });
}

/* ── The feed, split by side ───────────────────────────────────── */

/** Activity kinds each side's feed shows. Follows are shared — one graph. */
export const FEED_KINDS: Record<Side, string[]> = {
  cookbook: ["cookbook_published", "cookbook_saved", "recipe_added", "followed"],
  connect: ["match_won", "followed"],
};
