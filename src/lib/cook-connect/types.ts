// Row shapes for the `cook` schema. These mirror supabase/migrations/*_cook_connect.sql
// and are the same shapes the local demo backend stores, so every view reads
// one set of types whichever backend is behind it.

export type GameKind = "spades" | "chess";
export type MatchStatus = "pending" | "live" | "done" | "abandoned";
export type SeatResult = "win" | "loss" | "draw";

export interface Profile {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  city: string | null;
  created_at: string;
}

export interface Follow {
  id: string;
  follower_id: string;
  following_id: string;
  created_at: string;
}

export interface Cookbook {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  privacy: "public" | "private";
  created_at: string;
  updated_at: string;
}

export interface Ingredient {
  name: string;
  amount: string;
  unit: string;
}

export interface Step {
  step: number;
  text: string;
}

export interface Recipe {
  id: string;
  cookbook_id: string;
  author_id: string;
  title: string;
  description: string | null;
  ingredients: Ingredient[];
  instructions: Step[];
  tags: string[];
  image_url: string | null;
  prep_time: number | null;
  cook_time: number | null;
  servings: number;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface CookbookSave {
  id: string;
  cookbook_id: string;
  user_id: string;
  created_at: string;
}

export interface Match {
  id: string;
  game: GameKind;
  status: MatchStatus;
  created_by: string;
  /** Null while a table is still filling, or on a draw. */
  winner_id: string | null;
  /** Spades only: 1 or 2. */
  winning_team: number | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface MatchPlayer {
  id: string;
  match_id: string;
  /** For a computer seat this is `bot:<seat>` rather than a real user id. */
  user_id: string;
  seat: number;
  team: number | null;
  is_bot: boolean;
  result: SeatResult | null;
}

export interface SpadesGame {
  id: string;
  match_id: string;
  state: unknown;
  team1_score: number;
  team2_score: number;
  team1_bags: number;
  team2_bags: number;
  current_round: number;
  updated_at: string;
}

export interface ChessGame {
  id: string;
  match_id: string;
  white_id: string | null;
  black_id: string | null;
  fen: string;
  pgn: string;
  last_move: { from: string; to: string; san: string } | null;
  draw_offer: string | null;
  /** Set when the opponent is the computer, so we know to move for it. */
  bot_level: "easy" | "medium" | "hard" | null;
  result: string | null;
  end_reason: string | null;
  updated_at: string;
}

export interface Message {
  id: string;
  room: string;
  user_id: string;
  content: string;
  created_at: string;
}

export type ActivityKind =
  | "cookbook_published"
  | "cookbook_saved"
  | "recipe_added"
  | "match_won"
  | "followed";

export interface Activity {
  id: string;
  kind: ActivityKind;
  actor_id: string;
  /** The person or thing acted on: a cookbook id, a user id, a match id. */
  subject_id: string | null;
  /** Denormalised so the feed renders in one query. */
  summary: string;
  created_at: string;
}

/** A message decorated with its author for display. */
export interface ChatMessage extends Message {
  display_name: string;
  avatar_url: string | null;
}

/** Chat room keys. Kept in one place so both ends agree. */
export const rooms = {
  lounge: () => "lounge",
  match: (matchId: string) => `match:${matchId}`,
  /** Sorted so both people derive the same key. */
  dm: (a: string, b: string) => `dm:${[a, b].sort().join(":")}`,
};

export const isDmRoom = (room: string): boolean => room.startsWith("dm:");

export function dmPartner(room: string, me: string): string | null {
  if (!isDmRoom(room)) return null;
  const [a, b] = room.slice(3).split(":");
  return a === me ? b : a;
}

/* ── The food journal ──────────────────────────────────────────── */

export interface FavoriteCity {
  id: string;
  user_id: string;
  name: string;
  country: string | null;
  notes: string | null;
  created_at: string;
}

export interface FavoriteRestaurant {
  id: string;
  user_id: string;
  city_id: string;
  name: string;
  cuisine_type: string | null;
  rating: number | null;
  notes: string | null;
  created_at: string;
}

export interface FavoriteDish {
  id: string;
  user_id: string;
  restaurant_id: string | null;
  name: string;
  rating: number | null;
  notes: string | null;
  created_at: string;
}

/** One row of the per-city restaurant board, aggregated across everyone. */
export interface CityStanding {
  city: string;
  restaurants: RestaurantStanding[];
  fans: number;
}

export interface RestaurantStanding {
  name: string;
  city: string;
  cuisine: string | null;
  /** How many different people have it in their journal. */
  fans: number;
  avgRating: number;
}

/* ── Sharing ───────────────────────────────────────────────────── */

export interface CookbookShare {
  id: string;
  cookbook_id: string;
  shared_by: string;
  shared_with_user_id: string | null;
  shared_with_email: string | null;
  share_link_token: string;
  access_level: "view" | "copy";
  expires_at: string | null;
  created_at: string;
}
