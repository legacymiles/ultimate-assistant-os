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
