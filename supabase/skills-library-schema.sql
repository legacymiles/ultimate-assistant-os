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
