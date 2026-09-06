-- ============================================================================
-- GENERATED FILE — do not edit by hand.
--
-- Every migration in ./migrations concatenated in order, for the one case the
-- Supabase CLI cannot cover: applying the schema by pasting into the dashboard
-- SQL Editor when no database credential is available locally.
--
-- The migrations themselves are the source of truth. Regenerate with:
--   scripts/build-all-schemas.sh
--
-- Every statement is idempotent (create ... if not exists / drop policy if
-- exists / duplicate_object guards), so running this more than once is safe.
-- ============================================================================



-- ####################################################################
-- MIGRATION: 20260831000000_projects_timeline.sql
-- ####################################################################

-- ============================================================================
-- Projects Timeline — Supabase schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- Provides: tables, relationships, Row Level Security (per-user isolation),
-- an updated_at trigger, and a private storage bucket for version files.
-- ============================================================================

-- ----- Enums ---------------------------------------------------------------
do $$ begin
  create type feature_group as enum ('core', 'supporting');
exception when duplicate_object then null; end $$;

do $$ begin
  create type knowledge_kind as enum (
    'note', 'idea', 'feature_request', 'ai_conversation',
    'claude_conversation', 'chatgpt_conversation', 'dev_update',
    'documentation', 'bug_report', 'brain_dump'
  );
exception when duplicate_object then null; end $$;

-- ----- Tables --------------------------------------------------------------
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  one_liner   text not null default '',
  overview    text not null default '',      -- short "basic overview"
  detailed    text not null default '',      -- long-form "detailed explanation"
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- If upgrading an existing database, add the column:
alter table public.projects add column if not exists detailed text not null default '';

create table if not exists public.features (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  title       text not null,
  description text not null default '',
  "group"     feature_group not null default 'supporting',
  created_at  timestamptz not null default now()
);

create table if not exists public.versions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  number      text not null,
  summary     text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.files (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.versions (id) on delete cascade,
  name        text not null,
  type        text not null default '',
  size        bigint not null default 0,
  url         text,                       -- storage path within the bucket
  created_at  timestamptz not null default now()
);

create table if not exists public.knowledge_entries (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  kind        knowledge_kind not null default 'note',
  title       text not null default '',
  content     text not null,
  attachment  jsonb,                      -- { name, type, size, url } of a summarised source file
  created_at  timestamptz not null default now()
);

-- If upgrading an existing database, add the column:
alter table public.knowledge_entries add column if not exists attachment jsonb;

-- ----- Indexes -------------------------------------------------------------
create index if not exists idx_projects_user        on public.projects (user_id, updated_at desc);
create index if not exists idx_features_project      on public.features (project_id);
create index if not exists idx_versions_project      on public.versions (project_id, created_at);
create index if not exists idx_files_version         on public.files (version_id);
create index if not exists idx_knowledge_project     on public.knowledge_entries (project_id, created_at);

-- ----- updated_at trigger --------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Row Level Security — every row is owned by a user (directly or via project).
-- ============================================================================
alter table public.projects          enable row level security;
alter table public.features          enable row level security;
alter table public.versions          enable row level security;
alter table public.files             enable row level security;
alter table public.knowledge_entries enable row level security;

-- Helper: does the current user own this project?
create or replace function public.owns_project(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid and p.user_id = auth.uid()
  );
$$;

-- projects: full access to your own rows
drop policy if exists projects_owner on public.projects;
create policy projects_owner on public.projects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- features
drop policy if exists features_owner on public.features;
create policy features_owner on public.features
  for all using (public.owns_project(project_id))
  with check (public.owns_project(project_id));

-- versions
drop policy if exists versions_owner on public.versions;
create policy versions_owner on public.versions
  for all using (public.owns_project(project_id))
  with check (public.owns_project(project_id));

-- knowledge entries
drop policy if exists knowledge_owner on public.knowledge_entries;
create policy knowledge_owner on public.knowledge_entries
  for all using (public.owns_project(project_id))
  with check (public.owns_project(project_id));

-- files: owned via version -> project
create or replace function public.owns_version(vid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.versions v
    join public.projects p on p.id = v.project_id
    where v.id = vid and p.user_id = auth.uid()
  );
$$;

drop policy if exists files_owner on public.files;
create policy files_owner on public.files
  for all using (public.owns_version(version_id))
  with check (public.owns_version(version_id));

-- ============================================================================
-- Storage bucket for version files (private; access via signed URLs).
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do nothing;

-- Authenticated users can manage objects in the bucket. Tighten further by
-- encoding ownership in the object path if you need per-user object isolation.
drop policy if exists project_files_rw on storage.objects;
create policy project_files_rw on storage.objects
  for all to authenticated
  using (bucket_id = 'project-files')
  with check (bucket_id = 'project-files');


-- ####################################################################
-- MIGRATION: 20260831000100_cookbook_genie.sql
-- ####################################################################

-- ============================================================================
-- Cookbook Genie — Supabase schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- Provides: tables, enums, Row Level Security (per-user isolation + sharing),
-- an updated_at trigger, a profiles auto-insert trigger, and a public storage
-- bucket for recipe images.
-- ============================================================================

-- ----- Enums ---------------------------------------------------------------
do $$ begin
  create type cookbook_privacy as enum ('private', 'shared', 'public');
exception when duplicate_object then null; end $$;
-- If upgrading an existing database, add the new value:
do $$ begin
  alter type cookbook_privacy add value if not exists 'public';
exception when others then null; end $$;

do $$ begin
  create type share_access_level as enum ('view_only', 'copy');
exception when duplicate_object then null; end $$;

-- ----- Tables --------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references auth.users (id) on delete cascade,
  display_name text,
  username     text,
  avatar_url   text,
  bio          text,
  preferences  jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- If upgrading an existing database, add the column:
alter table public.profiles add column if not exists bio text;

create table if not exists public.cookbooks (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users (id) on delete cascade,
  name            text not null,
  description     text,
  color_theme     text,
  cover_image_url text,
  privacy         cookbook_privacy not null default 'public',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Social: stars (likes) on cookbooks, and follows between users.
create table if not exists public.cookbook_stars (
  id          uuid primary key default gen_random_uuid(),
  cookbook_id uuid not null references public.cookbooks (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (cookbook_id, user_id)
);

create table if not exists public.follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid not null references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (follower_id, following_id),
  check (follower_id <> following_id)
);

create table if not exists public.recipes (
  id             uuid primary key default gen_random_uuid(),
  cookbook_id    uuid not null references public.cookbooks (id) on delete cascade,
  title          text not null,
  description    text,
  ingredients    jsonb,
  instructions   jsonb,
  prep_time      integer,
  cook_time      integer,
  servings       integer,
  calories       integer,
  dietary_tags   text[],
  protein_tags   text[],
  meal_type_tags text[],
  cuisine_tags   text[],
  image_url      text,
  plating_style  text,
  lighting_style text,
  notes          text,
  position       integer,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.recipe_versions (
  id             uuid primary key default gen_random_uuid(),
  recipe_id      uuid not null references public.recipes (id) on delete cascade,
  version_number integer not null default 1,
  recipe_data    jsonb not null,
  created_at     timestamptz not null default now()
);

create table if not exists public.cookbook_shares (
  id                  uuid primary key default gen_random_uuid(),
  cookbook_id         uuid not null references public.cookbooks (id) on delete cascade,
  shared_by           uuid not null references auth.users (id) on delete cascade,
  shared_with_email   text,
  shared_with_user_id uuid references auth.users (id) on delete cascade,
  share_link_token    text unique,
  access_level        share_access_level not null default 'copy',
  expires_at          timestamptz,
  created_at          timestamptz not null default now()
);

create table if not exists public.favorite_cities (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  country    text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.favorite_restaurants (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  city_id      uuid not null references public.favorite_cities (id) on delete cascade,
  name         text not null,
  cuisine_type text,
  rating       integer,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.favorite_dishes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  restaurant_id uuid not null references public.favorite_restaurants (id) on delete cascade,
  name          text not null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ----- updated_at trigger --------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','cookbooks','recipes','favorite_cities','favorite_restaurants','favorite_dishes']
  loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s', t);
    execute format('create trigger trg_touch_%1$s before update on public.%1$s for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ----- Auto-create profile on signup --------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    split_part(new.email, '@', 1)
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----- Helper: can this user view this cookbook? ---------------------------
create or replace function public.can_view_cookbook(_cookbook_id uuid, _user_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.cookbooks c
    where c.id = _cookbook_id and (c.owner_id = _user_id or c.privacy = 'public')
  ) or exists (
    select 1 from public.cookbook_shares s
    where s.cookbook_id = _cookbook_id
      and (s.shared_with_user_id = _user_id
           or s.shared_with_email = (select email from auth.users where id = _user_id)
           or s.share_link_token is not null)
  );
$$;

create or replace function public.is_cookbook_owner(_cookbook_id uuid, _user_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.cookbooks c where c.id = _cookbook_id and c.owner_id = _user_id);
$$;

-- ----- Row Level Security --------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.cookbooks            enable row level security;
alter table public.cookbook_stars       enable row level security;
alter table public.follows              enable row level security;
alter table public.recipes              enable row level security;
alter table public.recipe_versions      enable row level security;
alter table public.cookbook_shares      enable row level security;
alter table public.favorite_cities      enable row level security;
alter table public.favorite_restaurants enable row level security;
alter table public.favorite_dishes      enable row level security;

-- cookbook_stars: everyone can read (for counts & leaderboards); star/unstar your own.
drop policy if exists stars_select on public.cookbook_stars;
create policy stars_select on public.cookbook_stars for select using (true);
drop policy if exists stars_insert on public.cookbook_stars;
create policy stars_insert on public.cookbook_stars for insert with check (auth.uid() = user_id);
drop policy if exists stars_delete on public.cookbook_stars;
create policy stars_delete on public.cookbook_stars for delete using (auth.uid() = user_id);

-- follows: everyone can read (for counts); follow/unfollow as yourself.
drop policy if exists follows_select on public.follows;
create policy follows_select on public.follows for select using (true);
drop policy if exists follows_insert on public.follows;
create policy follows_insert on public.follows for insert with check (auth.uid() = follower_id);
drop policy if exists follows_delete on public.follows;
create policy follows_delete on public.follows for delete using (auth.uid() = follower_id);

-- profiles: readable by all authenticated users, writable by owner
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (true);
drop policy if exists profiles_upsert on public.profiles;
create policy profiles_upsert on public.profiles for insert with check (auth.uid() = user_id);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (auth.uid() = user_id);

-- cookbooks: owner full access; shared users can view
drop policy if exists cookbooks_select on public.cookbooks;
create policy cookbooks_select on public.cookbooks for select
  using (public.can_view_cookbook(id, auth.uid()));
drop policy if exists cookbooks_insert on public.cookbooks;
create policy cookbooks_insert on public.cookbooks for insert with check (auth.uid() = owner_id);
drop policy if exists cookbooks_update on public.cookbooks;
create policy cookbooks_update on public.cookbooks for update using (auth.uid() = owner_id);
drop policy if exists cookbooks_delete on public.cookbooks;
create policy cookbooks_delete on public.cookbooks for delete using (auth.uid() = owner_id);

-- recipes: viewable if you can view the cookbook; writable by cookbook owner
drop policy if exists recipes_select on public.recipes;
create policy recipes_select on public.recipes for select
  using (public.can_view_cookbook(cookbook_id, auth.uid()));
drop policy if exists recipes_insert on public.recipes;
create policy recipes_insert on public.recipes for insert
  with check (public.is_cookbook_owner(cookbook_id, auth.uid()));
drop policy if exists recipes_update on public.recipes;
create policy recipes_update on public.recipes for update
  using (public.is_cookbook_owner(cookbook_id, auth.uid()));
drop policy if exists recipes_delete on public.recipes;
create policy recipes_delete on public.recipes for delete
  using (public.is_cookbook_owner(cookbook_id, auth.uid()));

-- recipe_versions: follow the recipe's cookbook
drop policy if exists recipe_versions_all on public.recipe_versions;
create policy recipe_versions_all on public.recipe_versions for all
  using (exists (select 1 from public.recipes r where r.id = recipe_id and public.can_view_cookbook(r.cookbook_id, auth.uid())))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and public.is_cookbook_owner(r.cookbook_id, auth.uid())));

-- cookbook_shares: sharer manages; recipients can read their own shares
drop policy if exists shares_select on public.cookbook_shares;
create policy shares_select on public.cookbook_shares for select
  using (
    shared_by = auth.uid()
    or shared_with_user_id = auth.uid()
    or shared_with_email = (auth.jwt() ->> 'email')
    or share_link_token is not null
  );
drop policy if exists shares_insert on public.cookbook_shares;
create policy shares_insert on public.cookbook_shares for insert
  with check (auth.uid() = shared_by and public.is_cookbook_owner(cookbook_id, auth.uid()));
drop policy if exists shares_update on public.cookbook_shares;
create policy shares_update on public.cookbook_shares for update
  using (shared_by = auth.uid() or shared_with_user_id is null);
drop policy if exists shares_delete on public.cookbook_shares;
create policy shares_delete on public.cookbook_shares for delete using (shared_by = auth.uid());

-- favorites: writes are per-user. Cities and restaurants are world-readable so
-- the per-city restaurant leaderboard can aggregate across all members; dishes
-- stay private to their owner.
do $$
declare t text;
begin
  foreach t in array array['favorite_cities','favorite_restaurants','favorite_dishes']
  loop
    execute format('drop policy if exists %1$s_all on public.%1$s', t);
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert with check (auth.uid() = user_id)', t);
    execute format('create policy %1$s_update on public.%1$s for update using (auth.uid() = user_id)', t);
    execute format('create policy %1$s_delete on public.%1$s for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;

-- Read policies: cities & restaurants public (leaderboard), dishes private.
drop policy if exists favorite_cities_select on public.favorite_cities;
create policy favorite_cities_select on public.favorite_cities for select using (true);
drop policy if exists favorite_restaurants_select on public.favorite_restaurants;
create policy favorite_restaurants_select on public.favorite_restaurants for select using (true);
drop policy if exists favorite_dishes_select on public.favorite_dishes;
create policy favorite_dishes_select on public.favorite_dishes for select using (auth.uid() = user_id);

-- ----- Storage bucket for recipe images ------------------------------------
insert into storage.buckets (id, name, public)
values ('recipe-images', 'recipe-images', true)
on conflict (id) do nothing;

drop policy if exists recipe_images_read on storage.objects;
create policy recipe_images_read on storage.objects for select
  using (bucket_id = 'recipe-images');

drop policy if exists recipe_images_write on storage.objects;
create policy recipe_images_write on storage.objects for insert to authenticated
  with check (bucket_id = 'recipe-images');

drop policy if exists recipe_images_update on storage.objects;
create policy recipe_images_update on storage.objects for update to authenticated
  using (bucket_id = 'recipe-images');


-- ####################################################################
-- MIGRATION: 20260831000200_skills_library.sql
-- ####################################################################

-- ============================================================================
-- Skills Library — Supabase schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- Provides: a single `skills` table, Row Level Security (per-user isolation),
-- and an updated_at trigger. Single-owner private vault: each signed-in user
-- only ever sees and edits their own rows.
-- ============================================================================

-- ----- Table ---------------------------------------------------------------
create table if not exists public.skills (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null,
  overview   text not null default '',
  body       text not null default '',
  -- Sync metadata. `source` = 'manual' | 'claude-code'; `slug` is a stable key
  -- for synced skills (folder name or "plugin:name"), null for hand-added ones;
  -- `origin` is a human label like "Personal", "superpowers", "vercel".
  source     text not null default 'manual',
  slug       text,
  origin     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- If upgrading an existing database, add the sync columns:
do $$ begin
  alter table public.skills add column if not exists source text not null default 'manual';
  alter table public.skills add column if not exists slug text;
  alter table public.skills add column if not exists origin text;
exception when others then null; end $$;

create index if not exists skills_user_id_idx on public.skills (user_id);
create index if not exists skills_created_at_idx on public.skills (created_at desc);

-- Upsert target for sync: one row per (user, slug). Manual skills have a null
-- slug; nulls are distinct in Postgres, so many hand-added rows can coexist.
create unique index if not exists skills_user_slug_key on public.skills (user_id, slug);

-- ----- updated_at trigger --------------------------------------------------
create or replace function public.skills_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists skills_set_updated_at on public.skills;
create trigger skills_set_updated_at
  before update on public.skills
  for each row execute function public.skills_touch_updated_at();

-- ----- Row Level Security --------------------------------------------------
alter table public.skills enable row level security;

drop policy if exists "skills_select_own" on public.skills;
create policy "skills_select_own" on public.skills
  for select using (auth.uid() = user_id);

drop policy if exists "skills_insert_own" on public.skills;
create policy "skills_insert_own" on public.skills
  for insert with check (auth.uid() = user_id);

drop policy if exists "skills_update_own" on public.skills;
create policy "skills_update_own" on public.skills
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "skills_delete_own" on public.skills;
create policy "skills_delete_own" on public.skills
  for delete using (auth.uid() = user_id);


-- ####################################################################
-- MIGRATION: 20260905000000_app_state.sql
-- ####################################################################

-- ============================================================================
-- Shared per-user app state — the cross-device sync table.
--
-- Most apps in this hub keep their whole state as one JSON blob under a single
-- localStorage key (see src/lib/*/store.ts). That works on one machine and
-- fails the moment the same person opens the site on a phone: the two devices
-- keep separate, silently diverging copies.
--
-- Rather than give each app its own bespoke tables, this is one narrow table
-- holding the same blob each app already serializes, keyed by (user, app key).
-- The app's own shape stays its business; this only moves the bytes.
--
-- Last-write-wins on updated_at. That is the honest guarantee for a
-- single-person, few-devices workload: it cannot merge two concurrent edits,
-- and is not meant to. Anything needing real multi-party concurrency (the
-- Recall Lists board, STD Safe grants) gets its own modelled tables instead.
-- ============================================================================

create table if not exists public.app_state (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  key        text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create index if not exists app_state_user_idx on public.app_state (user_id);

-- ----- Row level security --------------------------------------------------
-- A row is readable and writable only by the user it belongs to. `with check`
-- matters as much as `using` here: without it a signed-in user could write a
-- row carrying someone else's user_id.
alter table public.app_state enable row level security;

drop policy if exists app_state_all on public.app_state;
create policy app_state_all on public.app_state for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ----- updated_at trigger --------------------------------------------------
-- Set server-side so the conflict resolution cannot be skewed by a device
-- whose clock is wrong.
create or replace function public.touch_app_state_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists app_state_touch on public.app_state;
create trigger app_state_touch
  before update on public.app_state
  for each row execute function public.touch_app_state_updated_at();
