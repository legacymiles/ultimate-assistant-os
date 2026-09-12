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


-- ####################################################################
-- MIGRATION: 20260905000100_voice_clips_bucket.sql
-- ####################################################################

-- ============================================================================
-- Voice Studio — storage for recorded and generated audio.
--
-- Voice Studio kept its cloned-voice reference clips and its generated history
-- as base64 data: URLs inside one localStorage blob. That cannot follow the
-- user to another device the way the other apps now do: a 10-30 second clip is
-- far too big to sit in an app_state jsonb row, and a handful of them would
-- blow past sensible row limits and make every sync slow.
--
-- So the bytes live here and only the path travels in the row.
--
-- Unlike the older project-files bucket, ownership is encoded in the object
-- path — every object must sit under a folder named for the owner's user id —
-- and the policies below enforce that. Without it, "authenticated" would mean
-- any signed-in user could read every other user's voice recordings.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('voice-clips', 'voice-clips', false)
on conflict (id) do nothing;

-- storage.foldername(name) splits the object path; [1] is the first segment,
-- which callers must set to the uploader's auth.uid().
drop policy if exists voice_clips_select on storage.objects;
create policy voice_clips_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'voice-clips'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists voice_clips_insert on storage.objects;
create policy voice_clips_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'voice-clips'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists voice_clips_update on storage.objects;
create policy voice_clips_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'voice-clips'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'voice-clips'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists voice_clips_delete on storage.objects;
create policy voice_clips_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'voice-clips'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ####################################################################
-- MIGRATION: 20260905000200_server_docs.sql
-- ####################################################################

-- ============================================================================
-- Server-owned JSON documents.
--
-- Two apps here are not per-user stores and cannot use app_state: STD Safe and
-- the Recall Lists board. Both are shared, multi-party, and keep their own
-- account systems — STD Safe's whole point is that a second person asks you for
-- a result and you approve it — so their state is one document owned by the
-- server, not a row owned by a viewer.
--
-- Both wrote that document to a JSON file next to the project. On Vercel the
-- filesystem is read-only and per-instance, so those writes either fail or
-- vanish at the next deploy. This table is where the document goes instead.
--
-- SECURITY: row level security is enabled and NO policy is created. That is
-- deliberate, not an oversight. Postgres denies every access to a table with
-- RLS on and no matching policy, so `anon` and `authenticated` — which is to
-- say anything holding the publishable key, including all browser code — can
-- neither read nor write these rows. Only the service role, which bypasses RLS
-- and is used exclusively in server routes, can reach them.
--
-- That matters more here than anywhere else in this schema: one of these
-- documents holds real health records, and every rule about who may see which
-- result is enforced in the route layer above. A client-readable copy would
-- route around all of it.
-- ============================================================================

create table if not exists public.server_docs (
  name       text        primary key,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Enabled with no policy: deny-all to every client-facing role. See above.
alter table public.server_docs enable row level security;

-- Should a policy ever have been added by hand, remove it — the deny-all
-- posture is the point, and this migration is the place that asserts it.
drop policy if exists server_docs_all on public.server_docs;

create or replace function public.touch_server_docs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists server_docs_touch on public.server_docs;
create trigger server_docs_touch
  before update on public.server_docs
  for each row execute function public.touch_server_docs_updated_at();


-- ####################################################################
-- MIGRATION: 20260905000300_std_safe_reports_bucket.sql
-- ####################################################################

-- ============================================================================
-- STD Safe — storage for uploaded lab reports.
--
-- These are the most sensitive bytes in the hub: a real lab report carries a
-- full legal name, a date of birth and a medical record number next to the
-- results. They were written to std-safe-reports/<user>/ on local disk, which
-- on Vercel means the upload is accepted and then silently lost.
--
-- SECURITY: like server_docs, RLS is on and NO policy is created, so every
-- client-facing role is denied outright. This is stricter than the voice-clips
-- bucket on purpose, and the reason is that STD Safe does not use Supabase auth
-- at all — it has its own accounts, handles and share codes, so auth.uid() says
-- nothing about who owns a report and cannot be used to fence one off.
--
-- Ownership is therefore enforced where it is actually known: in the routes,
-- which re-derive the owner from the session rather than trusting the URL, and
-- never include a report in a shared view. Only the service role reaches these
-- objects, and only through that code.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('std-safe-reports', 'std-safe-reports', false)
on conflict (id) do nothing;

-- No policy is created for this bucket. Any policy that previously existed is
-- removed: deny-all to anon and authenticated is the intended posture, and
-- this migration is the place that asserts it.
drop policy if exists std_safe_reports_rw on storage.objects;
drop policy if exists std_safe_reports_select on storage.objects;
drop policy if exists std_safe_reports_insert on storage.objects;
drop policy if exists std_safe_reports_update on storage.objects;
drop policy if exists std_safe_reports_delete on storage.objects;


-- ####################################################################
-- MIGRATION: 20260906000000_tighten_cross_user_access.sql
-- ####################################################################

-- ============================================================================
-- Close three ways one signed-in user could reach another's data.
--
-- Everything here is a policy or helper change. No table is altered, no row is
-- touched, and no object is moved, so it is safe to run against live data and
-- safe to run twice.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. project-files: ownership was never checked.
--
-- The old policy was `using (bucket_id = 'project-files')` for role
-- `authenticated` — every signed-in user could read, overwrite and delete
-- every other user's uploaded project files. Its own comment said to tighten
-- it "if you need per-user object isolation".
--
-- The obvious fix is the voice-clips pattern: put the owner's id in the object
-- path. That is not used here, because the paths already written do not carry
-- one (`<versionId>/<file>` and `knowledge/<projectId>/<file>`), and adopting
-- it would orphan every file uploaded so far.
--
-- Instead ownership is derived from the path by joining back to the row that
-- owns it — versions and projects already know who they belong to, and
-- owns_version() already encodes that. Existing objects keep working, and the
-- client needs no change.
-- ----------------------------------------------------------------------------

create or replace function public.owns_project_file(objname text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  parts     text[] := storage.foldername(objname);
  candidate text;
  uuid_re   constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  -- A bare filename at the bucket root belongs to no project, so nobody owns
  -- it and nobody may touch it.
  if parts is null or array_length(parts, 1) is null then
    return false;
  end if;

  -- knowledge/<projectId>/<file>
  if parts[1] = 'knowledge' then
    if array_length(parts, 1) < 2 then
      return false;
    end if;
    candidate := parts[2];
    -- Guard the cast: a malformed segment must return false, not raise, or the
    -- error surfaces as a broken request instead of a denied one.
    if candidate !~ uuid_re then
      return false;
    end if;
    return exists (
      select 1 from public.projects p
      where p.id = candidate::uuid and p.user_id = auth.uid()
    );
  end if;

  -- <versionId>/<file>
  candidate := parts[1];
  if candidate !~ uuid_re then
    return false;
  end if;
  return public.owns_version(candidate::uuid);
end;
$$;

drop policy if exists project_files_rw on storage.objects;
create policy project_files_rw on storage.objects
  for all to authenticated
  using (bucket_id = 'project-files' and public.owns_project_file(name))
  with check (bucket_id = 'project-files' and public.owns_project_file(name));


-- ----------------------------------------------------------------------------
-- 2. Cookbook share links granted access to everyone.
--
-- can_view_cookbook() ended with `or s.share_link_token is not null`. The token
-- was never compared to anything — its mere EXISTENCE satisfied the clause. So
-- the moment a cookbook had a share link created, every authenticated user
-- could read it and all its recipes, link or no link.
--
-- The clause is dropped. Share links keep working through redeem_cookbook_share
-- below, which is the right shape for this: a secret in a URL cannot be checked
-- by a row policy, but it can be checked as a function argument.
-- ----------------------------------------------------------------------------

create or replace function public.can_view_cookbook(_cookbook_id uuid, _user_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.cookbooks c
    where c.id = _cookbook_id and (c.owner_id = _user_id or c.privacy = 'public')
  ) or exists (
    select 1 from public.cookbook_shares s
    where s.cookbook_id = _cookbook_id
      and (s.shared_with_user_id = _user_id
           or s.shared_with_email = (select email from auth.users where id = _user_id))
  );
$$;

-- The same phantom-token clause let any user read every share row, which
-- carries shared_with_email — other people's email addresses.
drop policy if exists shares_select on public.cookbook_shares;
create policy shares_select on public.cookbook_shares for select
  using (
    shared_by = auth.uid()
    or shared_with_user_id = auth.uid()
    or shared_with_email = (auth.jwt() ->> 'email')
  );

-- `or shared_with_user_id is null` let ANY user rewrite a share that had not
-- been claimed yet — including pointing it at themselves to take access to a
-- private cookbook they were never sent. Claiming now goes through
-- redeem_cookbook_share(), which requires holding the token.
drop policy if exists shares_update on public.cookbook_shares;
create policy shares_update on public.cookbook_shares for update
  using (shared_by = auth.uid())
  with check (shared_by = auth.uid());

-- Redeem a share link: bind the caller to the share identified by the token.
-- Returns the cookbook id when the caller now holds the share, else null.
-- Security definer so it can update a row the caller cannot otherwise see —
-- the token IS the authorisation, and only someone holding it can get here.
create or replace function public.redeem_cookbook_share(_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _cookbook uuid;
begin
  if auth.uid() is null or _token is null or _token = '' then
    return null;
  end if;

  -- First one through the link claims it. This preserves the behaviour the app
  -- already had; a link is single-use, not a standing invitation.
  update public.cookbook_shares
     set shared_with_user_id = auth.uid()
   where share_link_token = _token
     and shared_with_user_id is null
     and (expires_at is null or expires_at > now())
  returning cookbook_id into _cookbook;

  if _cookbook is not null then
    return _cookbook;
  end if;

  -- Already claimed. Only the person who claimed it gets the cookbook back;
  -- anyone else holding the same URL gets null, exactly as if it were wrong.
  select cookbook_id into _cookbook
    from public.cookbook_shares
   where share_link_token = _token
     and shared_with_user_id = auth.uid()
     and (expires_at is null or expires_at > now());

  return _cookbook;
end;
$$;

revoke all on function public.redeem_cookbook_share(text) from public, anon;
grant execute on function public.redeem_cookbook_share(text) to authenticated;

-- The share COUNT shown on a cookbook card was computed by selecting every
-- share row, which the fixed policy above no longer allows. The count itself
-- is harmless — it is the rows that were not — so it comes from a function
-- that returns totals and no personal data.
create or replace function public.cookbook_share_counts()
returns table (cookbook_id uuid, share_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select s.cookbook_id, count(*)::bigint
  from public.cookbook_shares s
  group by s.cookbook_id;
$$;

revoke all on function public.cookbook_share_counts() from public, anon;
grant execute on function public.cookbook_share_counts() to authenticated;


-- ####################################################################
-- MIGRATION: 20260912000000_dashboard_inbox_bucket.sql
-- ####################################################################

-- Dashboard iPhone photo inbox.
--
-- An iOS Shortcut POSTs photos to /api/dashboard/inbox/push, and the route
-- stores each one here through src/lib/server/blobStore.ts until a browser
-- claims it — at which point it is deleted. The inbox is a transit buffer, not
-- a library; unclaimed photos are swept after 7 days.
--
-- Without this bucket every push on a deployed host fails with "storage
-- unavailable". blobStore uses Supabase Storage whenever SUPABASE_SERVICE_ROLE_KEY
-- is set, and nothing else creates the bucket. Local development never noticed,
-- because the preview server blanks the Supabase URL and falls back to the
-- filesystem.
--
-- Private, and deliberately given NO storage policy — the same arrangement as
-- std-safe-reports. Only the server, holding the service-role key, reads or
-- writes it; the anon and authenticated roles are denied outright. Whose photos
-- are whose is enforced in the route layer, by the per-user device token.
--
-- The inbox's manifest (hashed tokens, pending entries, seen identifiers) lives
-- in public.server_docs, which already exists.
--
-- Safe to run twice.

insert into storage.buckets (id, name, public)
values ('dashboard-inbox', 'dashboard-inbox', false)
on conflict (id) do nothing;

-- No policy is created for this bucket, and any that exists is removed:
-- deny-all to anon and authenticated is the intended posture, and this
-- migration is the place that asserts it — as std-safe-reports does.
drop policy if exists dashboard_inbox_rw on storage.objects;
drop policy if exists dashboard_inbox_select on storage.objects;
drop policy if exists dashboard_inbox_insert on storage.objects;
drop policy if exists dashboard_inbox_update on storage.objects;
drop policy if exists dashboard_inbox_delete on storage.objects;
