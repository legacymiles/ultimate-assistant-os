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
