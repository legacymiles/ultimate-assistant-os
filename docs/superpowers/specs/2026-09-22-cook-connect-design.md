# Cook Connect — design

**Date:** 2026-09-22
**Status:** approved, implementing

Merge of **Cookbook Genie** (`/apps/cookbook-genie`) and **Pod Play Connect**
(`/pod-play-connect`) into one social app: **Cook Connect** at `/apps/cook-connect`.

Neither source app is modified or deleted. They keep their routes, their code and their
data. Cook Connect is additive until the owner says otherwise.

## Decisions

| Question | Decision |
|---|---|
| Build approach | Port the games into the hub as a native Next.js app |
| Starting data | Own `cook` schema, starts empty (no import from either app) |
| Player ranking | Wins and win rate, with a minimum-games qualifier |
| Carried from Pod Play | Text chat, WebRTC video, computer opponents. **Not** groups/pods |

## Architecture

Native hub app following the Cookbook Genie pattern: one client entry component that owns
auth, a context and internal state-based routing (no react-router).

```
src/app/apps/cook-connect/page.tsx      route
src/components/cook-connect/            UI
src/lib/cook-connect/                   logic, types, tests
src/app/api/cook-connect/               AI recipe routes
supabase/migrations/*_cook_connect.sql  cook schema
```

### Supabase `cook` schema

Separate schema, like `pod`. Must be listed under Settings → Data API → Exposed schemas
or PostgREST returns PGRST106.

| Table | Purpose |
|---|---|
| `profiles` | id → auth.users, handle, display_name, avatar_url, bio, city |
| `follows` | follower_id, following_id |
| `cookbooks` | id, owner_id, title, description, cover_url, privacy(public/private) |
| `recipes` | id, cookbook_id, author_id, title, ingredients, steps, tags, image_url, servings |
| `cookbook_saves` | cookbook_id, user_id — currency of the cookbook leaderboard |
| `matches` | id, game(spades/chess), status(pending/live/done), created_by, winner_id, finished_at |
| `match_players` | match_id, user_id, seat, team, is_bot, result(win/loss/draw) |
| `player_stats` | **view** over match_players: played, wins, losses, win_rate, streak |
| `messages` | id, room, author_id, body. Rooms: `lounge`, `dm:<a>:<b>`, `match:<id>` |
| `spades_games` | live spades state (hands, bids, trick, scores) |
| `chess_games` | live chess state (fen, pgn, seats, turn) |
| `activity` | feed events: cookbook_published, cookbook_saved, recipe_added, match_won |

`player_stats` is a view so the leaderboard can never drift from the match record.

### Ported from `C:\Users\honey\OneDrive\Desktop\pod-play-connect`

Rewritten onto hub design tokens and the `cook` schema; shadcn imports replaced with the
hub's own primitives.

- `src/lib/spades.ts`, `spadesBot.ts`, `chessAi.ts`, `chessAi.worker.ts`, `sounds.ts`
- `src/hooks/useSpades.ts`, `useChess.ts`, `useMessages.ts`, `useVideoCall.ts`
- `src/components/spades/*`, `chess/*`, `chat/*`, `video/*`

New dependencies: `chess.js`, `react-chessboard` (pin v4; **renders nothing without an
explicit `boardWidth`** — measure the container).

### Offline / no-keys mode

Hub rule: an app must work with no env keys. A `localClient.ts` in-browser
Supabase-compatible client over localStorage, as Cookbook Genie has. Bots make both games
fully playable solo offline. Real Supabase mode starts empty as specified; **demo mode
seeds a few demo members** so the feed and leaderboards render rather than showing three
blank pages.

## Screens

Six tabs. UI driven by the `impeccable` skill — dense and database-like, not a card grid.

1. **Feed** — social home. Activity from people you follow plus global highlights; side
   rail of who is online and which tables are open.
2. **People** — searchable member directory; follow/unfollow; a profile shows someone's
   cookbooks and their game record together.
3. **Cookbooks** — yours plus Discover. Saving a cookbook is the leaderboard currency.
   AI recipe generation and auto-tagging carry over from Cookbook Genie.
4. **Play** — lobby (challenge a friend, join an open table, play the computer) and the
   Spades and chess rooms, each with chat dock and video panel beside the board.
5. **Leaderboards** — Players (wins, win %, streak, minimum-games qualifier) and
   Cookbooks (most saved).
6. **Profile** — own cookbooks, record, followers.

## Testing

- `src/lib/cook-connect/stats.test.ts` — ranking, win rate, streak, minimum-games gate.
- `src/lib/cook-connect/spades.test.ts` — dealing, follow-suit legality, trick winner,
  bid scoring including bags and nil.
- Browser verification of every tab against the offline path.

## Out of scope

Groups/pods; importing data from either source app; deleting either source app.
