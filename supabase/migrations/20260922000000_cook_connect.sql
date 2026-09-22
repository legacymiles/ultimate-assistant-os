-- Cook Connect — the merged cooking + games social app.
--
-- Everything lives in its own `cook` schema. The hub already owns `public`
-- (Cookbook Genie's tables are there) and Pod Play Connect owns `pod`, so this
-- app can be installed, used and removed without either of those noticing.
--
-- After running this, add "cook" to Settings → Data API → Exposed schemas,
-- or PostgREST answers every request with PGRST106.

create schema if not exists cook;
grant usage on schema cook to anon, authenticated;

-- ── People ────────────────────────────────────────────────────────

create table if not exists cook.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  handle       text not null unique check (handle ~ '^[a-z0-9_]{2,24}$'),
  display_name text not null default 'Member',
  avatar_url   text,
  bio          text,
  city         text,
  created_at   timestamptz not null default now()
);

create table if not exists cook.follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid not null references cook.profiles(id) on delete cascade,
  following_id uuid not null references cook.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (follower_id, following_id),
  check (follower_id <> following_id)
);

create index if not exists follows_following_idx on cook.follows(following_id);

-- ── Cookbooks ─────────────────────────────────────────────────────

create table if not exists cook.cookbooks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references cook.profiles(id) on delete cascade,
  title       text not null,
  description text,
  cover_url   text,
  privacy     text not null default 'public' check (privacy in ('public','private')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists cookbooks_owner_idx on cook.cookbooks(owner_id);

create table if not exists cook.recipes (
  id           uuid primary key default gen_random_uuid(),
  cookbook_id  uuid not null references cook.cookbooks(id) on delete cascade,
  author_id    uuid not null references cook.profiles(id) on delete cascade,
  title        text not null,
  description  text,
  ingredients  jsonb not null default '[]'::jsonb,
  instructions jsonb not null default '[]'::jsonb,
  tags         text[] not null default '{}',
  image_url    text,
  prep_time    integer,
  cook_time    integer,
  servings     integer not null default 4,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists recipes_cookbook_idx on cook.recipes(cookbook_id, position);

-- Saving a cookbook is the currency of the cookbook leaderboard.
create table if not exists cook.cookbook_saves (
  id          uuid primary key default gen_random_uuid(),
  cookbook_id uuid not null references cook.cookbooks(id) on delete cascade,
  user_id     uuid not null references cook.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (cookbook_id, user_id)
);

create index if not exists saves_cookbook_idx on cook.cookbook_saves(cookbook_id);

-- ── Games ─────────────────────────────────────────────────────────

create table if not exists cook.matches (
  id           uuid primary key default gen_random_uuid(),
  game         text not null check (game in ('spades','chess')),
  status       text not null default 'pending'
               check (status in ('pending','live','done','abandoned')),
  created_by   uuid not null references cook.profiles(id) on delete cascade,
  winner_id    uuid references cook.profiles(id) on delete set null,
  winning_team integer,
  is_public    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create index if not exists matches_status_idx on cook.matches(status, created_at desc);

-- A seat. `user_id` is text rather than a uuid reference because a computer
-- seat is stored as 'bot:<seat>' and has no profile behind it.
create table if not exists cook.match_players (
  id       uuid primary key default gen_random_uuid(),
  match_id uuid not null references cook.matches(id) on delete cascade,
  user_id  text not null,
  seat     integer not null,
  team     integer,
  is_bot   boolean not null default false,
  result   text check (result in ('win','loss','draw')),
  unique (match_id, seat),
  unique (match_id, user_id)
);

create index if not exists match_players_user_idx on cook.match_players(user_id);

create table if not exists cook.spades_games (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null unique references cook.matches(id) on delete cascade,
  state        jsonb not null default '{}'::jsonb,
  team1_score  integer not null default 0,
  team2_score  integer not null default 0,
  team1_bags   integer not null default 0,
  team2_bags   integer not null default 0,
  current_round integer not null default 1,
  updated_at   timestamptz not null default now()
);

create table if not exists cook.chess_games (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null unique references cook.matches(id) on delete cascade,
  white_id   text,
  black_id   text,
  fen        text not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  pgn        text not null default '',
  last_move  jsonb,
  draw_offer text,
  bot_level  text check (bot_level in ('easy','medium','hard')),
  result     text,
  end_reason text,
  updated_at timestamptz not null default now()
);

-- ── Chat and the feed ─────────────────────────────────────────────

-- Room keys: 'lounge', 'match:<id>', 'dm:<id>:<id>' (the two ids sorted).
create table if not exists cook.messages (
  id         uuid primary key default gen_random_uuid(),
  room       text not null,
  user_id    uuid not null references cook.profiles(id) on delete cascade,
  content    text not null check (length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists messages_room_idx on cook.messages(room, created_at desc);

create table if not exists cook.activity (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in
             ('cookbook_published','cookbook_saved','recipe_added','match_won','followed')),
  actor_id   uuid not null references cook.profiles(id) on delete cascade,
  subject_id uuid,
  summary    text not null,
  created_at timestamptz not null default now()
);

create index if not exists activity_created_idx on cook.activity(created_at desc);

-- ── The players leaderboard ───────────────────────────────────────
--
-- A view, not a table, so a standing can never drift from the match record it
-- is supposed to summarise. The app ranks these rows itself (see stats.ts);
-- this is the raw tally.

create or replace view cook.player_stats as
select
  mp.user_id::uuid                                            as user_id,
  count(*)                                                    as played,
  count(*) filter (where mp.result = 'win')                   as wins,
  count(*) filter (where mp.result = 'loss')                  as losses,
  count(*) filter (where mp.result = 'draw')                  as draws,
  (count(*) filter (where mp.result = 'win')
    + 0.5 * count(*) filter (where mp.result = 'draw'))
    / nullif(count(*), 0)                                     as win_rate
from cook.match_players mp
join cook.matches m on m.id = mp.match_id
where m.status = 'done' and mp.is_bot = false and mp.result is not null
group by mp.user_id;

-- ── Row level security ────────────────────────────────────────────
--
-- This is a public social app: profiles, public cookbooks, the leaderboards
-- and the match record are world-readable, and writes are restricted to the
-- person or the people sitting at the table.

alter table cook.profiles       enable row level security;
alter table cook.follows        enable row level security;
alter table cook.cookbooks      enable row level security;
alter table cook.recipes        enable row level security;
alter table cook.cookbook_saves enable row level security;
alter table cook.matches        enable row level security;
alter table cook.match_players  enable row level security;
alter table cook.spades_games   enable row level security;
alter table cook.chess_games    enable row level security;
alter table cook.messages       enable row level security;
alter table cook.activity       enable row level security;

-- Is this user sitting at this table? Used by the game-write policies.
create or replace function cook.is_seated(match uuid)
returns boolean
language sql
stable
security definer
set search_path = cook, public
as $$
  select exists (
    select 1 from cook.match_players mp
    where mp.match_id = match and mp.user_id = auth.uid()::text
  );
$$;

drop policy if exists profiles_read on cook.profiles;
create policy profiles_read on cook.profiles for select using (true);
drop policy if exists profiles_write_own on cook.profiles;
create policy profiles_write_own on cook.profiles for insert with check (id = auth.uid());
drop policy if exists profiles_update_own on cook.profiles;
create policy profiles_update_own on cook.profiles for update using (id = auth.uid());

drop policy if exists follows_read on cook.follows;
create policy follows_read on cook.follows for select using (true);
drop policy if exists follows_write on cook.follows;
create policy follows_write on cook.follows for insert with check (follower_id = auth.uid());
drop policy if exists follows_delete on cook.follows;
create policy follows_delete on cook.follows for delete using (follower_id = auth.uid());

drop policy if exists cookbooks_read on cook.cookbooks;
create policy cookbooks_read on cook.cookbooks for select
  using (privacy = 'public' or owner_id = auth.uid());
drop policy if exists cookbooks_write on cook.cookbooks;
create policy cookbooks_write on cook.cookbooks for insert with check (owner_id = auth.uid());
drop policy if exists cookbooks_update on cook.cookbooks;
create policy cookbooks_update on cook.cookbooks for update using (owner_id = auth.uid());
drop policy if exists cookbooks_delete on cook.cookbooks;
create policy cookbooks_delete on cook.cookbooks for delete using (owner_id = auth.uid());

-- Recipes are visible exactly when their cookbook is. The subquery reads the
-- cookbook's own columns rather than calling a policy-checked helper, so an
-- INSERT ... RETURNING can see the row it just wrote.
drop policy if exists recipes_read on cook.recipes;
create policy recipes_read on cook.recipes for select using (
  exists (
    select 1 from cook.cookbooks c
    where c.id = recipes.cookbook_id
      and (c.privacy = 'public' or c.owner_id = auth.uid())
  )
);
drop policy if exists recipes_write on cook.recipes;
create policy recipes_write on cook.recipes for insert with check (
  author_id = auth.uid()
  and exists (select 1 from cook.cookbooks c where c.id = cookbook_id and c.owner_id = auth.uid())
);
drop policy if exists recipes_update on cook.recipes;
create policy recipes_update on cook.recipes for update using (
  exists (select 1 from cook.cookbooks c where c.id = recipes.cookbook_id and c.owner_id = auth.uid())
);
drop policy if exists recipes_delete on cook.recipes;
create policy recipes_delete on cook.recipes for delete using (
  exists (select 1 from cook.cookbooks c where c.id = recipes.cookbook_id and c.owner_id = auth.uid())
);

drop policy if exists saves_read on cook.cookbook_saves;
create policy saves_read on cook.cookbook_saves for select using (true);
drop policy if exists saves_write on cook.cookbook_saves;
create policy saves_write on cook.cookbook_saves for insert with check (user_id = auth.uid());
drop policy if exists saves_delete on cook.cookbook_saves;
create policy saves_delete on cook.cookbook_saves for delete using (user_id = auth.uid());

drop policy if exists matches_read on cook.matches;
create policy matches_read on cook.matches for select using (true);
drop policy if exists matches_write on cook.matches;
create policy matches_write on cook.matches for insert with check (created_by = auth.uid());
-- Anyone at the table may move the match on, because the last move can come
-- from any seat; the creator can always close their own table.
drop policy if exists matches_update on cook.matches;
create policy matches_update on cook.matches for update
  using (created_by = auth.uid() or cook.is_seated(id));

drop policy if exists match_players_read on cook.match_players;
create policy match_players_read on cook.match_players for select using (true);
drop policy if exists match_players_write on cook.match_players;
create policy match_players_write on cook.match_players for insert with check (
  user_id = auth.uid()::text
  or (is_bot and cook.is_seated(match_id))
);
drop policy if exists match_players_update on cook.match_players;
create policy match_players_update on cook.match_players for update using (cook.is_seated(match_id));
drop policy if exists match_players_delete on cook.match_players;
create policy match_players_delete on cook.match_players for delete using (user_id = auth.uid()::text);

drop policy if exists spades_read on cook.spades_games;
create policy spades_read on cook.spades_games for select using (true);
drop policy if exists spades_write on cook.spades_games;
create policy spades_write on cook.spades_games for insert with check (
  exists (select 1 from cook.matches m where m.id = match_id and m.created_by = auth.uid())
);
drop policy if exists spades_update on cook.spades_games;
create policy spades_update on cook.spades_games for update using (cook.is_seated(match_id));

drop policy if exists chess_read on cook.chess_games;
create policy chess_read on cook.chess_games for select using (true);
drop policy if exists chess_write on cook.chess_games;
create policy chess_write on cook.chess_games for insert with check (
  exists (select 1 from cook.matches m where m.id = match_id and m.created_by = auth.uid())
);
-- A joining player writes their own id into the empty colour, so the update
-- policy has to admit someone who is not seated yet but is taking a free seat.
drop policy if exists chess_update on cook.chess_games;
create policy chess_update on cook.chess_games for update using (
  cook.is_seated(match_id) or white_id is null or black_id is null
);

-- Direct messages are readable only by the two people in the room key.
drop policy if exists messages_read on cook.messages;
create policy messages_read on cook.messages for select using (
  room not like 'dm:%' or room like '%' || auth.uid()::text || '%'
);
drop policy if exists messages_write on cook.messages;
create policy messages_write on cook.messages for insert with check (
  user_id = auth.uid()
  and (room not like 'dm:%' or room like '%' || auth.uid()::text || '%')
);
drop policy if exists messages_delete on cook.messages;
create policy messages_delete on cook.messages for delete using (user_id = auth.uid());

drop policy if exists activity_read on cook.activity;
create policy activity_read on cook.activity for select using (true);
drop policy if exists activity_write on cook.activity;
create policy activity_write on cook.activity for insert with check (actor_id = auth.uid());

grant select on cook.player_stats to anon, authenticated;
grant select, insert, update, delete on all tables in schema cook to authenticated;
grant select on all tables in schema cook to anon;
alter default privileges in schema cook
  grant select, insert, update, delete on tables to authenticated;

-- ── Realtime ──────────────────────────────────────────────────────
-- The tables a second browser has to hear about the moment they change.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table cook.spades_games;
    alter publication supabase_realtime add table cook.chess_games;
    alter publication supabase_realtime add table cook.matches;
    alter publication supabase_realtime add table cook.match_players;
    alter publication supabase_realtime add table cook.messages;
  end if;
exception
  when duplicate_object then null; -- already published, nothing to do
end $$;
