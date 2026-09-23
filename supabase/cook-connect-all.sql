-- ===========================================================================
--  COOK CONNECT — the whole thing, in one paste.
--
--  Everything Cook Connect needs: the core schema, the food journal and
--  cookbook sharing, and groups with their chat. Plus the step that is
--  usually a dashboard click — exposing the `cook` schema to the API — done
--  here at the end so this file is all you have to run.
--
--  Safe to run more than once. Every table is `if not exists` and every
--  policy is dropped before it is created, so re-running changes nothing.
--
--  Paste the whole file into the Supabase SQL editor and hit Run.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 20260922000000_cook_connect.sql
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 20260922120000_cook_connect_journal_and_shares.sql
-- ---------------------------------------------------------------------------

-- Cook Connect, second pass: the food journal and cookbook sharing.
--
-- These are the halves of Cookbook Genie the merge did not carry over the
-- first time. The journal feeds a per-city restaurant leaderboard built from
-- everybody's favourites, so cities and restaurants are world-readable while
-- the dishes someone logs stay private to them.
--
-- Run after 20260922000000_cook_connect.sql.

-- ── The food journal ──────────────────────────────────────────────

create table if not exists cook.favorite_cities (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references cook.profiles(id) on delete cascade,
  name       text not null,
  country    text,
  notes      text,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists cook.favorite_restaurants (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references cook.profiles(id) on delete cascade,
  city_id      uuid not null references cook.favorite_cities(id) on delete cascade,
  name         text not null,
  cuisine_type text,
  rating       integer check (rating between 1 and 5),
  notes        text,
  created_at   timestamptz not null default now()
);

create index if not exists restaurants_city_idx on cook.favorite_restaurants(city_id);

-- A dish is a private note about one plate. It is never aggregated.
create table if not exists cook.favorite_dishes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references cook.profiles(id) on delete cascade,
  restaurant_id uuid references cook.favorite_restaurants(id) on delete cascade,
  name          text not null,
  rating        integer check (rating between 1 and 5),
  notes         text,
  created_at    timestamptz not null default now()
);

-- ── Sharing a cookbook ────────────────────────────────────────────
--
-- Saving a cookbook is public and drives the leaderboard. Sharing is the
-- other thing: handing one person a link to a cookbook that is not public.

create table if not exists cook.cookbook_shares (
  id                  uuid primary key default gen_random_uuid(),
  cookbook_id         uuid not null references cook.cookbooks(id) on delete cascade,
  shared_by           uuid not null references cook.profiles(id) on delete cascade,
  /** Null until somebody redeems the link; then it belongs to them. */
  shared_with_user_id uuid references cook.profiles(id) on delete cascade,
  shared_with_email   text,
  share_link_token    text not null unique,
  access_level        text not null default 'view' check (access_level in ('view','copy')),
  expires_at          timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists shares_cookbook_idx on cook.cookbook_shares(cookbook_id);
create index if not exists shares_recipient_idx on cook.cookbook_shares(shared_with_user_id);

-- ── Row level security ────────────────────────────────────────────

alter table cook.favorite_cities      enable row level security;
alter table cook.favorite_restaurants enable row level security;
alter table cook.favorite_dishes      enable row level security;
alter table cook.cookbook_shares      enable row level security;

-- Cities and restaurants are readable by everyone because the city board is
-- an aggregate of them. They carry a place name and a rating, nothing private.
drop policy if exists cities_read on cook.favorite_cities;
create policy cities_read on cook.favorite_cities for select using (true);
drop policy if exists cities_write on cook.favorite_cities;
create policy cities_write on cook.favorite_cities for insert with check (user_id = auth.uid());
drop policy if exists cities_update on cook.favorite_cities;
create policy cities_update on cook.favorite_cities for update using (user_id = auth.uid());
drop policy if exists cities_delete on cook.favorite_cities;
create policy cities_delete on cook.favorite_cities for delete using (user_id = auth.uid());

drop policy if exists restaurants_read on cook.favorite_restaurants;
create policy restaurants_read on cook.favorite_restaurants for select using (true);
drop policy if exists restaurants_write on cook.favorite_restaurants;
create policy restaurants_write on cook.favorite_restaurants for insert with check (user_id = auth.uid());
drop policy if exists restaurants_update on cook.favorite_restaurants;
create policy restaurants_update on cook.favorite_restaurants for update using (user_id = auth.uid());
drop policy if exists restaurants_delete on cook.favorite_restaurants;
create policy restaurants_delete on cook.favorite_restaurants for delete using (user_id = auth.uid());

-- Dishes are the one part of the journal nobody else sees.
drop policy if exists dishes_own on cook.favorite_dishes;
create policy dishes_own on cook.favorite_dishes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A share is visible to the person who made it and the person it went to.
-- The link itself is redeemed through a function, not by reading the table,
-- so holding a token does not let anyone enumerate everybody else's shares.
drop policy if exists shares_read on cook.cookbook_shares;
create policy shares_read on cook.cookbook_shares for select
  using (shared_by = auth.uid() or shared_with_user_id = auth.uid());
drop policy if exists shares_write on cook.cookbook_shares;
create policy shares_write on cook.cookbook_shares for insert with check (
  shared_by = auth.uid()
  and exists (select 1 from cook.cookbooks c where c.id = cookbook_id and c.owner_id = auth.uid())
);
drop policy if exists shares_delete on cook.cookbook_shares;
create policy shares_delete on cook.cookbook_shares for delete using (shared_by = auth.uid());

-- A shared cookbook has to be readable by its recipient even though it is
-- private, so the cookbook and recipe read policies gain a share clause.
drop policy if exists cookbooks_read on cook.cookbooks;
create policy cookbooks_read on cook.cookbooks for select using (
  privacy = 'public'
  or owner_id = auth.uid()
  or exists (
    select 1 from cook.cookbook_shares s
    where s.cookbook_id = cookbooks.id
      and s.shared_with_user_id = auth.uid()
      and (s.expires_at is null or s.expires_at > now())
  )
);

drop policy if exists recipes_read on cook.recipes;
create policy recipes_read on cook.recipes for select using (
  exists (
    select 1 from cook.cookbooks c
    where c.id = recipes.cookbook_id
      and (
        c.privacy = 'public'
        or c.owner_id = auth.uid()
        or exists (
          select 1 from cook.cookbook_shares s
          where s.cookbook_id = c.id
            and s.shared_with_user_id = auth.uid()
            and (s.expires_at is null or s.expires_at > now())
        )
      )
  )
);

-- ── Claiming a share link ─────────────────────────────────────────
--
-- Security definer so redeeming does not need an unrestricted update policy.
-- A link belongs to whoever claims it first, and returns nothing to anyone
-- else — the same contract Cookbook Genie settled on.

create or replace function cook.redeem_cookbook_share(_token text)
returns uuid
language plpgsql
security definer
set search_path = cook, public
as $$
declare
  share cook.cookbook_shares%rowtype;
begin
  if auth.uid() is null or _token is null then return null; end if;

  select * into share from cook.cookbook_shares where share_link_token = _token;
  if not found then return null; end if;
  if share.expires_at is not null and share.expires_at <= now() then return null; end if;

  if share.shared_with_user_id is null then
    update cook.cookbook_shares
       set shared_with_user_id = auth.uid()
     where id = share.id;
    return share.cookbook_id;
  end if;

  -- Already claimed: only the claimant gets it back.
  if share.shared_with_user_id = auth.uid() then return share.cookbook_id; end if;
  return null;
end;
$$;

grant execute on function cook.redeem_cookbook_share(text) to authenticated;

-- Counting shares must not mean reading everyone's share rows.
create or replace function cook.cookbook_share_counts()
returns table (cookbook_id uuid, share_count bigint)
language sql
stable
security definer
set search_path = cook, public
as $$
  select s.cookbook_id, count(*) from cook.cookbook_shares s group by s.cookbook_id;
$$;

grant execute on function cook.cookbook_share_counts() to anon, authenticated;

grant select, insert, update, delete on all tables in schema cook to authenticated;
grant select on all tables in schema cook to anon;

-- ---------------------------------------------------------------------------
-- 20260922180000_cook_connect_groups.sql
-- ---------------------------------------------------------------------------

-- Cook Connect, third pass: groups and group chat.
--
-- Pod Play Connect had interest groups — curated communities you join, each
-- with its own conversation. They were left out of the first merge on purpose
-- and are wanted after all, so they come across here with the cooking slant
-- the rest of the app has.
--
-- Member counts are NOT stored on the group. Pod Play kept a member_count
-- column and incremented it from the client, which drifts the moment a join
-- fails halfway. Here the count is read from the membership table.
--
-- Run after 20260922120000_cook_connect_journal_and_shares.sql.

create table if not exists cook.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 2 and 60),
  description text,
  /** 0-359. Gives each group a consistent colour without storing a gradient. */
  hue         integer not null default 24 check (hue between 0 and 359),
  created_by  uuid not null references cook.profiles(id) on delete cascade,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists cook.group_members (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid not null references cook.groups(id) on delete cascade,
  user_id   uuid not null references cook.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create index if not exists group_members_group_idx on cook.group_members(group_id);
create index if not exists group_members_user_idx on cook.group_members(user_id);

-- ── Row level security ────────────────────────────────────────────

alter table cook.groups        enable row level security;
alter table cook.group_members enable row level security;

drop policy if exists groups_read on cook.groups;
create policy groups_read on cook.groups for select using (is_active);
drop policy if exists groups_write on cook.groups;
create policy groups_write on cook.groups for insert with check (created_by = auth.uid());
drop policy if exists groups_update on cook.groups;
create policy groups_update on cook.groups for update using (created_by = auth.uid());
drop policy if exists groups_delete on cook.groups;
create policy groups_delete on cook.groups for delete using (created_by = auth.uid());

-- Memberships are public: a group shows who is in it.
drop policy if exists group_members_read on cook.group_members;
create policy group_members_read on cook.group_members for select using (true);
drop policy if exists group_members_join on cook.group_members;
create policy group_members_join on cook.group_members for insert with check (user_id = auth.uid());
drop policy if exists group_members_leave on cook.group_members;
create policy group_members_leave on cook.group_members for delete using (user_id = auth.uid());

-- ── Group chat ────────────────────────────────────────────────────
--
-- Group rooms are 'group:<id>'. Only members may read or post, so a group
-- conversation is not readable by walking the messages table.

create or replace function cook.is_group_member(room_key text)
returns boolean
language sql
stable
security definer
set search_path = cook, public
as $$
  select case
    when room_key not like 'group:%' then true
    else exists (
      select 1 from cook.group_members m
      where m.user_id = auth.uid()
        and m.group_id::text = substring(room_key from 7)
    )
  end;
$$;

grant execute on function cook.is_group_member(text) to authenticated;

drop policy if exists messages_read on cook.messages;
create policy messages_read on cook.messages for select using (
  (room not like 'dm:%' or room like '%' || auth.uid()::text || '%')
  and cook.is_group_member(room)
);

drop policy if exists messages_write on cook.messages;
create policy messages_write on cook.messages for insert with check (
  user_id = auth.uid()
  and (room not like 'dm:%' or room like '%' || auth.uid()::text || '%')
  and cook.is_group_member(room)
);

grant select, insert, update, delete on all tables in schema cook to authenticated;
grant select on all tables in schema cook to anon;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table cook.group_members;
  end if;
exception
  when duplicate_object then null;
end $$;


-- ===========================================================================
--  Expose the schema to the API
--
--  Without this, PostgREST rejects every request with PGRST106 before it even
--  looks at the tables — the app cannot tell a missing schema from an empty
--  one. This is the same thing Settings -> Data API -> Exposed schemas does,
--  written as SQL so one paste finishes the job.
--
--  The existing list is read first and `cook` appended, so nothing already
--  exposed (public, graphql_public, pod) is lost.
-- ===========================================================================

do $$
declare
  current_list text;
  next_list    text;
begin
  select coalesce(
    (select setting from pg_settings where name = 'pgrst.db_schemas'),
    'public, graphql_public'
  ) into current_list;

  if current_list like '%cook%' then
    next_list := current_list;
    raise notice 'cook is already exposed: %', next_list;
  else
    next_list := current_list || ', cook';
    raise notice 'exposing: %', next_list;
  end if;

  execute format('alter role authenticator set pgrst.db_schemas = %L', next_list);
end $$;

-- Tell PostgREST to pick the change up now rather than on its next restart.
notify pgrst, 'reload config';
notify pgrst, 'reload schema';

-- ===========================================================================
--  Check it worked. This should list the cook tables; if it errors or comes
--  back empty, the schema did not get created.
-- ===========================================================================

select table_name
from information_schema.tables
where table_schema = 'cook'
order by table_name;
