# Cook Connect

Route: `/apps/cook-connect` · Category: Apps · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- cook-connect "what to change"`.

## What it does

A cookbook and a card table in one social app. Publish a cookbook, save the ones worth keeping, and search a directory of cooks by name, handle or city — then challenge any of them to spades or chess without leaving the page. A profile shows someone's cookbooks and their game record side by side, because here they are the same person. Two leaderboards keep score: players ranked on win rate, with a minimum-games qualifier so a 3–0 newcomer cannot top a 40–25 season, and cookbooks ranked by how many people have saved them. Every table carries text chat and in-app WebRTC video, and computer players fill any empty seat so a game never waits for a fourth. Recipes are drafted by AI from one sentence and then fully editable. Runs on its own Supabase schema, or entirely in the browser with no keys — where two tabs can genuinely play each other.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Cookbook Genie and Pod Play Connect, merged** — A new app at /apps/cook-connect where a person's cookbooks and their game record are the same profile. Publish and save cookbooks, search a directory of cooks, and challenge any of them to spades or …
- **Playing out of turn is no longer a renig** — A renig is now only acting like you are out of a suit when you still hold it (off-suit while holding the led suit, or an early spade lead while holding other suits). Out-of-turn play is still allowed…
- **Spades video shows all four cameras at once, one bigger than the rest** — Video area is now a gallery of every seat: the big camera plus the other three always visible - Tap any camera (or a player's seat) to make it the big one; ✕ makes all four the same size - Laptop: bi…
- **Video chat on every seat at the spades table, one enlarged at a time** — Each player on video shows live on their own seat in place of their avatar - Only one video is ever big: tap a seat to enlarge it (or swap), tap again to shrink - The big video has its own space — th…
- **Spades plays like a real table — dealer rotation, shuffle & deal, team bids, no bags** — Hand sized to the screen so no card is cut off; bigger ranks and suits; bigger trick cards - Real order: left of the dealer bids first and leads, dealer bids last, deal passes left each hand; dealer …
- **Social feed, recipe filters and personal 1–10 ranks, profiles and settings** — Feed on both sides: recipes as photo posts with saves/follows/wins between, scroll-reveal, endless scroll, people to follow - Explore › Recipes and Cookbooks › My recipes: search by dish or main ingr…
- **Spades gets a four-colour deck, bigger hand, Place Bid, two-step card play and Next screens** — Each suit has its own colour on the cards (spades black, hearts red, diamonds blue, clubs green), set by the theme and editable in Game Play Design Styling - Your hand is much bigger and overlapped s…
- **Two apps in one — Cookbook / Connect switch with its own tabs, Explore and leaderboards** — A big Cookbook | Connect switch (top of the rail, and the phone header) splits Cook Connect into two halves on one account. Cookbook: Cookbooks, Explore, Journal, Boards. Connect: Play, Explore, Boar…
- **One video can give several recipes, bulk links/videos, keep or skip each** — A video showing separate dishes now comes back as one recipe per dish (components of one dish stay one recipe). Pasting a list of links or dropping in several videos reads each on its own, two at a t…
- **Holo table redesign, every hand held as a curved fan** — The spades table is rebuilt (taste-skill + webgl-trail-reveal): a tilted oval of WebGL felt on a dark stage, where the pointer paints a fading trail that scans glowing circuitry in, with a thin chrom…
- **Spades matchmaking with bots, merged with the cinematic spades; renig follows the owner's spec** — Matchmaking: "Play bots now" (you + a computer partner vs two computers) or "Find real players" (join the fullest waiting table, or open one). While waiting everyone at the table can chat and video. …
- **Renege rule and cinematic spades — every trick is a fight** — Renege house rule (on by default, switchable while bidding): off-suit plays are allowed with a two-tap confirm, every renege is logged, anyone on the other team can call it once it is provable (they …
- **A photo of your nan's card and "make it for six" belong in the same box** — Add a recipe was two tabs that could not see each other, so a picture of a dish with an instruction beside it had nowhere to go. It is now one tray: a link, up to six photos, a video and your own wor…
- **A Facebook link never reached the downloader** — The recipe importer resolved a pasted link with resolveSocialPost(), which only ever reads the page. Facebook shows an anonymous page fetch no video and often nothing at all, so every Facebook link d…
- **A way back to Jarvis** — A link in the top bar, beside Start a game. It is an anchor rather than an internal route, because it leaves the app rather than moving inside it, and it follows the arrow-plus-destination shape the …

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/cook-connect` — owner's sign-in
- `src/app/api/cook-connect/`
- `src/components/cook-connect/`
- `src/lib/cook-connect/`

### Sign-in & who can use it

- Account sign-up — `src/components/cook-connect/views/AuthView.tsx`
- Email + password sign-in — `src/components/cook-connect/views/AuthView.tsx`, `src/lib/cook-connect/local/index.ts`
- Google sign-in (OAuth redirect) — `src/components/cook-connect/views/AuthView.tsx`
- Needs a signed-in user (requireUser / auth.getUser) — `src/app/api/cook-connect/account/route.ts`

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| DELETE | `/api/cook-connect/account` | owner's sign-in |
| POST | `/api/cook-connect/recipe` | owner's sign-in |

### Data & database rules

- Table `activity` (cook.activity) · RLS on — used in `src/lib/cook-connect/social.ts`
  - policy cook.activity · activity_read — for select using (true)
  - policy cook.activity · activity_write — for insert with check (actor_id = auth.uid())
- Table `chess_games` (cook.chess_games) · RLS on — used in `src/lib/cook-connect/hooks/useChess.ts`, `src/lib/cook-connect/matches.ts`
  - policy cook.chess_games · chess_read — for select using (true)
  - policy cook.chess_games · chess_update — for update using ( cook.is_seated(match_id) or white_id is null or black_id is null )
  - policy cook.chess_games · chess_write — for insert with check ( exists (select 1 from cook.matches m where m.id = match_id and m.created_by = auth.uid()) )
- Table `cookbook_saves` (cook.cookbook_saves) · RLS on — used in `src/lib/cook-connect/social.ts`
  - policy cook.cookbook_saves · saves_delete — for delete using (user_id = auth.uid())
  - policy cook.cookbook_saves · saves_read — for select using (true)
  - policy cook.cookbook_saves · saves_write — for insert with check (user_id = auth.uid())
- Table `cookbook_shares` (cook.cookbook_shares, public.cookbook_shares) · RLS on — used in `src/lib/cook-connect/shares.ts`
  - policy cook.cookbook_shares · shares_delete — for delete using (shared_by = auth.uid())
  - policy cook.cookbook_shares · shares_read — for select using (shared_by = auth.uid() or shared_with_user_id = auth.uid())
  - policy cook.cookbook_shares · shares_write — for insert with check ( shared_by = auth.uid() and exists (select 1 from cook.cookbooks c where c.id = cookbook_id and c.owner_id = auth.uid()) )
  - policy public.cookbook_shares · shares_delete — for delete using (shared_by = auth.uid())
  - policy public.cookbook_shares · shares_insert — for insert with check (auth.uid() = shared_by and public.is_cookbook_owner(cookbook_id, auth.uid()))
  - policy public.cookbook_shares · shares_select — for select using ( shared_by = auth.uid() or shared_with_user_id = auth.uid() or shared_with_email = (auth.jwt() ->> 'email') )
  - policy public.cookbook_shares · shares_update — for update using (shared_by = auth.uid()) with check (shared_by = auth.uid())
- Table `cookbooks` (cook.cookbooks, public.cookbooks) · RLS on — used in `src/components/cook-connect/views/CookbookView.tsx`, `src/components/cook-connect/views/NewCookbookView.tsx`, `src/components/cook-connect/views/RecipeEditorView.tsx` +2 more
  - policy cook.cookbooks · cookbooks_delete — for delete using (owner_id = auth.uid())
  - policy cook.cookbooks · cookbooks_read — for select using ( privacy = 'public' or owner_id = auth.uid() or exists ( select 1 from cook.cookbook_shares s where s.cookbook_id = cookbooks.id and s.shared_with_user_id = auth.uid() and (s.expires_at is null or s.expires_at > now()) ) )
  - policy cook.cookbooks · cookbooks_update — for update using (owner_id = auth.uid())
  - policy cook.cookbooks · cookbooks_write — for insert with check (owner_id = auth.uid())
  - policy public.cookbooks · cookbooks_delete — for delete using (auth.uid() = owner_id)
  - policy public.cookbooks · cookbooks_insert — for insert with check (auth.uid() = owner_id)
  - policy public.cookbooks · cookbooks_select — for select using ( owner_id = auth.uid() or privacy = 'public' or public.can_view_cookbook(id, auth.uid()) )
  - policy public.cookbooks · cookbooks_update — for update using (auth.uid() = owner_id)
- Table `favorite_cities` (cook.favorite_cities, public.favorite_cities) · RLS on — used in `src/lib/cook-connect/journal.ts`
  - policy cook.favorite_cities · cities_delete — for delete using (user_id = auth.uid())
  - policy cook.favorite_cities · cities_read — for select using (true)
  - policy cook.favorite_cities · cities_update — for update using (user_id = auth.uid())
  - policy cook.favorite_cities · cities_write — for insert with check (user_id = auth.uid())
  - policy public.favorite_cities · favorite_cities_select — for select using (true)
- Table `favorite_dishes` (cook.favorite_dishes, public.favorite_dishes) · RLS on — used in `src/lib/cook-connect/journal.ts`
  - policy cook.favorite_dishes · dishes_own — for all using (user_id = auth.uid()) with check (user_id = auth.uid())
  - policy public.favorite_dishes · favorite_dishes_select — for select using (auth.uid() = user_id)
- Table `favorite_restaurants` (cook.favorite_restaurants, public.favorite_restaurants) · RLS on — used in `src/lib/cook-connect/journal.ts`
  - policy cook.favorite_restaurants · restaurants_delete — for delete using (user_id = auth.uid())
  - policy cook.favorite_restaurants · restaurants_read — for select using (true)
  - policy cook.favorite_restaurants · restaurants_update — for update using (user_id = auth.uid())
  - policy cook.favorite_restaurants · restaurants_write — for insert with check (user_id = auth.uid())
  - policy public.favorite_restaurants · favorite_restaurants_select — for select using (true)
- Table `follows` (cook.follows, public.follows) · RLS on — used in `src/lib/cook-connect/account.ts`, `src/lib/cook-connect/social.ts`
  - policy cook.follows · follows_delete — for delete using (follower_id = auth.uid())
  - policy cook.follows · follows_read — for select using (true)
  - policy cook.follows · follows_write — for insert with check (follower_id = auth.uid())
  - policy public.follows · follows_delete — for delete using (auth.uid() = follower_id)
  - policy public.follows · follows_insert — for insert with check (auth.uid() = follower_id)
  - policy public.follows · follows_select — for select using (true)
- Table `group_members` (cook.group_members) · RLS on — used in `src/lib/cook-connect/groups.ts`
  - policy cook.group_members · group_members_join — for insert with check (user_id = auth.uid())
  - policy cook.group_members · group_members_leave — for delete using (user_id = auth.uid())
  - policy cook.group_members · group_members_read — for select using (true)
- Table `groups` (cook.groups) · RLS on — used in `src/lib/cook-connect/groups.ts`
  - policy cook.groups · groups_delete — for delete using (created_by = auth.uid())
  - policy cook.groups · groups_read — for select using (is_active)
  - policy cook.groups · groups_update — for update using (created_by = auth.uid())
  - policy cook.groups · groups_write — for insert with check (created_by = auth.uid())
- Table `match_players` (cook.match_players) · RLS on — used in `src/lib/cook-connect/hooks/useChess.ts`, `src/lib/cook-connect/hooks/useSpades.ts`, `src/lib/cook-connect/matches.ts` +1 more
  - policy cook.match_players · match_players_delete — for delete using (user_id = auth.uid()::text)
  - policy cook.match_players · match_players_read — for select using (true)
  - policy cook.match_players · match_players_update — for update using (cook.is_seated(match_id))
  - policy cook.match_players · match_players_write — for insert with check ( user_id = auth.uid()::text or (is_bot and cook.is_seated(match_id)) )
- Table `matches` (cook.matches) · RLS on — used in `src/lib/cook-connect/hooks/useChess.ts`, `src/lib/cook-connect/hooks/useSpades.ts`, `src/lib/cook-connect/matches.ts` +1 more
  - policy cook.matches · matches_read — for select using (true)
  - policy cook.matches · matches_update — for update using (created_by = auth.uid() or cook.is_seated(id))
  - policy cook.matches · matches_write — for insert with check (created_by = auth.uid())
- Table `messages` (cook.messages) · RLS on — used in `src/components/cook-connect/views/ExploreView.tsx`, `src/lib/cook-connect/hooks/useMessages.ts`
  - policy cook.messages · messages_delete — for delete using (user_id = auth.uid())
  - policy cook.messages · messages_read — for select using ( (room not like 'dm:%' or room like '%' || auth.uid()::text || '%') and cook.is_group_member(room) )
  - policy cook.messages · messages_write — for insert with check ( user_id = auth.uid() and (room not like 'dm:%' or room like '%' || auth.uid()::text || '%') and cook.is_group_member(room) )
- Table `profiles` (cook.profiles, public.profiles) · RLS on — used in `src/app/api/cook-connect/account/route.ts`, `src/components/cook-connect/CookConnect.tsx`, `src/components/cook-connect/social/OnlineRail.tsx` +6 more
  - policy cook.profiles · profiles_read — for select using (true)
  - policy cook.profiles · profiles_update_own — for update using (id = auth.uid())
  - policy cook.profiles · profiles_write_own — for insert with check (id = auth.uid())
  - policy public.profiles · profiles_select — for select using (true)
  - policy public.profiles · profiles_update — for update using (auth.uid() = user_id)
  - policy public.profiles · profiles_upsert — for insert with check (auth.uid() = user_id)
- Table `recipes` (cook.recipes, public.recipes) · RLS on — used in `src/components/cook-connect/views/RecipeEditorView.tsx`, `src/components/cook-connect/views/RecipeView.tsx`, `src/lib/cook-connect/social.ts`
  - policy cook.recipes · recipes_delete — for delete using ( exists (select 1 from cook.cookbooks c where c.id = recipes.cookbook_id and c.owner_id = auth.uid()) )
  - policy cook.recipes · recipes_read — for select using ( exists ( select 1 from cook.cookbooks c where c.id = recipes.cookbook_id and ( c.privacy = 'public' or c.owner_id = auth.uid() or exists ( select 1 from cook.cookbook_shares s where s.cookbook_id = c.id and s.shared_with_user_id = auth.uid() and (s.expires_at is null or s.expires_at > now()) ) ) ) )
  - policy cook.recipes · recipes_update — for update using ( exists (select 1 from cook.cookbooks c where c.id = recipes.cookbook_id and c.owner_id = auth.uid()) )
  - policy cook.recipes · recipes_write — for insert with check ( author_id = auth.uid() and exists (select 1 from cook.cookbooks c where c.id = cookbook_id and c.owner_id = auth.uid()) )
  - policy public.recipes · recipes_delete — for delete using (public.is_cookbook_owner(cookbook_id, auth.uid()))
  - policy public.recipes · recipes_insert — for insert with check (public.is_cookbook_owner(cookbook_id, auth.uid()))
  - policy public.recipes · recipes_select — for select using (public.can_view_cookbook(cookbook_id, auth.uid()))
  - policy public.recipes · recipes_update — for update using (public.is_cookbook_owner(cookbook_id, auth.uid()))
- Table `spades_games` (cook.spades_games) · RLS on — used in `src/lib/cook-connect/hooks/useSpades.ts`, `src/lib/cook-connect/matches.ts`
  - policy cook.spades_games · spades_read — for select using (true)
  - policy cook.spades_games · spades_update — for update using (cook.is_seated(match_id))
  - policy cook.spades_games · spades_write — for insert with check ( exists (select 1 from cook.matches m where m.id = match_id and m.created_by = auth.uid()) )
- Database function `redeem_cookbook_share` — `src/lib/cook-connect/shares.ts`
- Saved data `cook-connect:fx-level:v1` — `src/lib/cook-connect/hooks/useGameStyle.ts`
- Saved data `cook-connect:personal:v1` — `src/lib/cook-connect/personal.ts`
- Saved data `game-play-design-styling:v1` — `src/lib/cook-connect/hooks/useGameStyle.ts`

### Keys & outside services

- `AI_MODEL` — `src/app/api/cook-connect/recipe/route.ts`
- `NEXT_PUBLIC_SUPABASE_URL` — `src/app/api/cook-connect/account/route.ts`
- `NEXT_PUBLIC_TURN_CREDENTIAL` — `src/lib/cook-connect/hooks/useVideoCall.ts`
- `NEXT_PUBLIC_TURN_URL` — `src/lib/cook-connect/hooks/useVideoCall.ts`
- `NEXT_PUBLIC_TURN_USERNAME` — `src/lib/cook-connect/hooks/useVideoCall.ts`
- `SUPABASE_SERVICE_ROLE_KEY` — `src/app/api/cook-connect/account/route.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/app/api/cook-connect/recipe/route.ts`

### Tests

- `src/lib/cook-connect/categories.test.ts`
- `src/lib/cook-connect/compose.test.ts`
- `src/lib/cook-connect/found.test.ts`
- `src/lib/cook-connect/gameStyle.test.ts`
- `src/lib/cook-connect/groups.test.ts`
- `src/lib/cook-connect/handLayout.test.ts`
- `src/lib/cook-connect/journal.test.ts`
- `src/lib/cook-connect/lobby.test.ts`
- `src/lib/cook-connect/rankShift.test.ts`
- `src/lib/cook-connect/renege.test.ts`
- `src/lib/cook-connect/sides.test.ts`
- `src/lib/cook-connect/spades.test.ts`
- `src/lib/cook-connect/stats.test.ts`
- `src/lib/cook-connect/tableTalk.test.ts`
- `src/lib/cook-connect/videoSeats.test.ts`
<!-- code:end -->
