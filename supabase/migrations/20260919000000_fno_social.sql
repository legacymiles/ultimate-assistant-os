-- ============================================================================
-- Friends Night Out v2 — shared city catalogues + social layer.
--
-- Public sign-up: every table here is RLS-on. Catalogue tables (areas, places,
-- events) are world-readable and written ONLY by the server with the service
-- role. User tables are written only by their owner, through their own session.
-- Leaderboard and rating aggregates are exposed through a security-definer
-- view/function so individual ratings stay private.
-- Additive and idempotent: safe to run twice.
-- ============================================================================

create table if not exists public.fno_areas (
  id              uuid primary key default gen_random_uuid(),
  label           text not null,
  lat             double precision not null,
  lon             double precision not null,
  built_radius_mi numeric not null check (built_radius_mi between 1 and 50),
  status          text not null default 'building' check (status in ('building','ready','failed')),
  last_built_at   timestamptz,
  last_active_at  timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create table if not exists public.fno_profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references auth.users (id) on delete cascade,
  handle        text not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name  text not null check (char_length(display_name) between 1 and 60),
  home_area_id  uuid references public.fno_areas (id) on delete set null,
  radius_mi     numeric not null default 15 check (radius_mi between 5 and 50),
  is_public     boolean not null default true,
  is_ai_guide   boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint fno_profiles_kind check (
    (is_ai_guide and user_id is null) or (not is_ai_guide and user_id is not null)
  )
);

create table if not exists public.fno_places (
  id                 uuid primary key default gen_random_uuid(),
  area_id            uuid not null references public.fno_areas (id) on delete cascade,
  name               text not null,
  address            text,
  lat                double precision not null,
  lon                double precision not null,
  section            text not null check (section in ('parks','fun','gems','kids','food')),
  ai_stars           smallint check (ai_stars between 1 and 5),
  ai_reason          text,
  stars_estimated    boolean not null default false,
  hook               text,
  price_tier         text check (price_tier in ('free','$','$$','$$$')),
  photo_url          text,
  sources            jsonb not null default '[]'::jsonb,
  osm_id             text,
  original_finder_id uuid references public.fno_profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (area_id, osm_id)
);
create index if not exists fno_places_area_idx on public.fno_places (area_id);

create table if not exists public.fno_events (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.fno_areas (id) on delete cascade,
  title       text not null,
  description text,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  frequency   text not null default 'once' check (frequency in ('once','weekly','monthly','yearly','other')),
  event_type  text,
  venue_name  text,
  address     text,
  lat         double precision,
  lon         double precision,
  url         text,
  price_tier  text check (price_tier in ('free','$','$$','$$$')),
  sources     jsonb not null default '[]'::jsonb,
  dedupe_key  text not null,
  created_at  timestamptz not null default now(),
  unique (area_id, dedupe_key)
);
create index if not exists fno_events_area_starts_idx on public.fno_events (area_id, starts_at);

create table if not exists public.fno_list_items (
  profile_id     uuid not null references public.fno_profiles (id) on delete cascade,
  place_id       uuid not null references public.fno_places (id) on delete cascade,
  copied_from_id uuid references public.fno_profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  primary key (profile_id, place_id),
  constraint fno_list_items_no_self_copy check (copied_from_id is distinct from profile_id)
);
create index if not exists fno_list_items_from_idx on public.fno_list_items (copied_from_id);
create index if not exists fno_list_items_place_idx on public.fno_list_items (place_id);

create table if not exists public.fno_notes (
  profile_id uuid not null references public.fno_profiles (id) on delete cascade,
  place_id   uuid not null references public.fno_places (id) on delete cascade,
  body       text not null check (char_length(body) <= 2000),
  is_public  boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (profile_id, place_id)
);

create table if not exists public.fno_ratings (
  profile_id uuid not null references public.fno_profiles (id) on delete cascade,
  place_id   uuid not null references public.fno_places (id) on delete cascade,
  stars      smallint not null check (stars between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (profile_id, place_id)
);

create table if not exists public.fno_follows (
  follower_id uuid not null references public.fno_profiles (id) on delete cascade,
  followee_id uuid not null references public.fno_profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint fno_follows_not_self check (follower_id <> followee_id)
);
create index if not exists fno_follows_followee_idx on public.fno_follows (followee_id);

create table if not exists public.fno_saved_events (
  profile_id uuid not null references public.fno_profiles (id) on delete cascade,
  event_id   uuid not null references public.fno_events (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, event_id)
);

-- ----- helper: the caller's profile id ------------------------------------
create or replace function public.fno_my_profile_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.fno_profiles where user_id = auth.uid()
$$;
revoke all on function public.fno_my_profile_id() from public;
grant execute on function public.fno_my_profile_id() to anon, authenticated;

-- ----- a copy must come from a list that actually has the place -----------
create or replace function public.fno_list_items_check_source()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.copied_from_id is not null and not exists (
    select 1 from public.fno_list_items
    where profile_id = new.copied_from_id and place_id = new.place_id
  ) then
    raise exception 'copied_from profile does not have this place' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists fno_list_items_check_source on public.fno_list_items;
create trigger fno_list_items_check_source
  before insert on public.fno_list_items
  for each row execute function public.fno_list_items_check_source();

-- ----- RLS -----------------------------------------------------------------
alter table public.fno_areas        enable row level security;
alter table public.fno_profiles     enable row level security;
alter table public.fno_places       enable row level security;
alter table public.fno_events       enable row level security;
alter table public.fno_list_items   enable row level security;
alter table public.fno_notes        enable row level security;
alter table public.fno_ratings      enable row level security;
alter table public.fno_follows      enable row level security;
alter table public.fno_saved_events enable row level security;

-- Catalogue: world-readable; no write policy = service role only.
drop policy if exists fno_areas_read on public.fno_areas;
create policy fno_areas_read on public.fno_areas for select using (true);
drop policy if exists fno_places_read on public.fno_places;
create policy fno_places_read on public.fno_places for select using (true);
drop policy if exists fno_events_read on public.fno_events;
create policy fno_events_read on public.fno_events for select using (true);

-- Profiles: public ones readable by all; your own always. Users can never
-- create or become an AI guide.
drop policy if exists fno_profiles_read on public.fno_profiles;
create policy fno_profiles_read on public.fno_profiles for select
  using (is_public or user_id = auth.uid());
drop policy if exists fno_profiles_insert on public.fno_profiles;
create policy fno_profiles_insert on public.fno_profiles for insert
  with check (user_id = auth.uid() and not is_ai_guide);
drop policy if exists fno_profiles_update on public.fno_profiles;
create policy fno_profiles_update on public.fno_profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and not is_ai_guide);
drop policy if exists fno_profiles_delete on public.fno_profiles;
create policy fno_profiles_delete on public.fno_profiles for delete
  using (user_id = auth.uid());

-- List items: readable if yours or the owner's profile is public.
drop policy if exists fno_list_items_read on public.fno_list_items;
create policy fno_list_items_read on public.fno_list_items for select using (
  profile_id = public.fno_my_profile_id()
  or exists (select 1 from public.fno_profiles p where p.id = profile_id and p.is_public)
);
drop policy if exists fno_list_items_insert on public.fno_list_items;
create policy fno_list_items_insert on public.fno_list_items for insert
  with check (profile_id = public.fno_my_profile_id());
drop policy if exists fno_list_items_delete on public.fno_list_items;
create policy fno_list_items_delete on public.fno_list_items for delete
  using (profile_id = public.fno_my_profile_id());

-- Notes: public notes readable by all (only on public profiles); private only yours.
drop policy if exists fno_notes_read on public.fno_notes;
create policy fno_notes_read on public.fno_notes for select using (
  profile_id = public.fno_my_profile_id()
  or (is_public and exists (select 1 from public.fno_profiles p where p.id = profile_id and p.is_public))
);
drop policy if exists fno_notes_write on public.fno_notes;
create policy fno_notes_write on public.fno_notes for all
  using (profile_id = public.fno_my_profile_id())
  with check (profile_id = public.fno_my_profile_id());

-- Ratings: only your own rows; aggregates via fno_place_stats.
drop policy if exists fno_ratings_own on public.fno_ratings;
create policy fno_ratings_own on public.fno_ratings for all
  using (profile_id = public.fno_my_profile_id())
  with check (profile_id = public.fno_my_profile_id());

-- Follows: the graph is public; you can only follow/unfollow as yourself.
drop policy if exists fno_follows_read on public.fno_follows;
create policy fno_follows_read on public.fno_follows for select using (true);
drop policy if exists fno_follows_insert on public.fno_follows;
create policy fno_follows_insert on public.fno_follows for insert
  with check (follower_id = public.fno_my_profile_id());
drop policy if exists fno_follows_delete on public.fno_follows;
create policy fno_follows_delete on public.fno_follows for delete
  using (follower_id = public.fno_my_profile_id());

-- Saved events: yours only.
drop policy if exists fno_saved_events_own on public.fno_saved_events;
create policy fno_saved_events_own on public.fno_saved_events for all
  using (profile_id = public.fno_my_profile_id())
  with check (profile_id = public.fno_my_profile_id());

-- ----- aggregates ----------------------------------------------------------
-- Runs as the view owner, so it can count private rows; it exposes only counts.
create or replace view public.fno_place_stats as
select
  p.id                       as place_id,
  coalesce(r.n, 0)::int      as rating_count,
  coalesce(r.s, 0)::int      as rating_sum,
  coalesce(l.n, 0)::int      as list_count
from public.fno_places p
left join (select place_id, count(*) n, sum(stars) s from public.fno_ratings group by place_id) r
  on r.place_id = p.id
left join (select place_id, count(*) n from public.fno_list_items group by place_id) l
  on l.place_id = p.id;
grant select on public.fno_place_stats to anon, authenticated;

-- Leaderboard (spec §3): +1 per copy from your list, +0.5 per add of a place
-- you originally found (by anyone but you), +3 per follower. Only actions by
-- verified-email accounts count. p_since = null → all time.
create or replace function public.fno_leaderboard(
  p_area uuid, p_since timestamptz default null, p_limit int default 50
)
returns table (
  profile_id uuid, handle text, display_name text, is_ai_guide boolean,
  copies bigint, finder_adds bigint, followers bigint, score numeric
)
language sql stable security definer set search_path = public as $$
  with verified as (
    select pr.id from public.fno_profiles pr
    join auth.users u on u.id = pr.user_id
    where u.email_confirmed_at is not null
  ),
  c as (
    select li.copied_from_id as pid, count(*) as n
    from public.fno_list_items li join verified v on v.id = li.profile_id
    where li.copied_from_id is not null and (p_since is null or li.created_at >= p_since)
    group by 1
  ),
  f as (
    select pl.original_finder_id as pid, count(*) as n
    from public.fno_list_items li
    join verified v on v.id = li.profile_id
    join public.fno_places pl on pl.id = li.place_id
    where pl.original_finder_id is not null
      and li.profile_id <> pl.original_finder_id
      and (p_since is null or li.created_at >= p_since)
    group by 1
  ),
  fo as (
    select fw.followee_id as pid, count(*) as n
    from public.fno_follows fw join verified v on v.id = fw.follower_id
    where (p_since is null or fw.created_at >= p_since)
    group by 1
  )
  select pr.id, pr.handle, pr.display_name, pr.is_ai_guide,
         coalesce(c.n, 0), coalesce(f.n, 0), coalesce(fo.n, 0),
         coalesce(c.n, 0) + 0.5 * coalesce(f.n, 0) + 3 * coalesce(fo.n, 0)
  from public.fno_profiles pr
  left join c  on c.pid  = pr.id
  left join f  on f.pid  = pr.id
  left join fo on fo.pid = pr.id
  where pr.home_area_id = p_area and pr.is_public
  order by 8 desc, pr.created_at asc
  limit least(greatest(p_limit, 1), 100)
$$;
revoke all on function public.fno_leaderboard(uuid, timestamptz, int) from public;
grant execute on function public.fno_leaderboard(uuid, timestamptz, int) to anon, authenticated;
