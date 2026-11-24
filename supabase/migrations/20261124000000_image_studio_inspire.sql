-- Image Studio › Inspire — shared images, personal libraries, collections and
-- the daily AI allowance.
--
-- The app's routes talk to these tables with the service role and check
-- ownership themselves (src/lib/image-studio/inspire/server/access.ts).
-- Row-level security is ALSO on, so the public anon key can read public images
-- and nothing else that is not the signed-in member's own.
--
-- Safe to run twice.

create table if not exists public.inspire_images (
  id text primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private','public')),
  category text not null default '',
  style text not null default '',
  subject text not null default '',
  source text not null default 'upload' check (source in ('seed','upload','generated','reverse','reference')),
  search text not null default '',
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists inspire_images_public_idx on public.inspire_images (visibility, created_at desc);
create index if not exists inspire_images_owner_idx on public.inspire_images (owner_id, created_at desc);

create table if not exists public.inspire_library (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('image','prompt','chip','reference')),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists inspire_library_user_idx on public.inspire_library (user_id, updated_at desc);

create table if not exists public.inspire_collections (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists inspire_collections_user_idx on public.inspire_collections (user_id, created_at);

create table if not exists public.inspire_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  used integer not null default 0,
  primary key (user_id, day)
);

-- One atomic add, so two tabs spending at once cannot both read the old count.
create or replace function public.inspire_add_usage(p_user uuid, p_day date, p_cost integer) returns void
language sql security definer set search_path = public as $$
  insert into public.inspire_usage (user_id, day, used) values (p_user, p_day, p_cost)
  on conflict (user_id, day) do update set used = public.inspire_usage.used + excluded.used;
$$;
revoke all on function public.inspire_add_usage(uuid, date, integer) from public, anon, authenticated;

alter table public.inspire_images enable row level security;
alter table public.inspire_library enable row level security;
alter table public.inspire_collections enable row level security;
alter table public.inspire_usage enable row level security;

-- Anyone may read a public image; a member may also read their own private ones.
drop policy if exists inspire_images_read on public.inspire_images;
create policy inspire_images_read on public.inspire_images
  for select to anon, authenticated
  using (visibility = 'public' or owner_id = auth.uid());

-- A member may change and remove only their own images.
drop policy if exists inspire_images_own_write on public.inspire_images;
create policy inspire_images_own_write on public.inspire_images
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists inspire_library_own on public.inspire_library;
create policy inspire_library_own on public.inspire_library
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists inspire_collections_own on public.inspire_collections;
create policy inspire_collections_own on public.inspire_collections
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- A member may see their own allowance. Writes go through inspire_add_usage.
drop policy if exists inspire_usage_own_read on public.inspire_usage;
create policy inspire_usage_own_read on public.inspire_usage
  for select to authenticated
  using (user_id = auth.uid());

-- Image bytes. Private: public images are streamed by the app's file route,
-- which checks visibility first.
insert into storage.buckets (id, name, public)
values ('inspire-images', 'inspire-images', false)
on conflict (id) do nothing;
