-- DTF Studio — projects, orders, assets, settings.
--
-- The app's server routes talk to these tables with the service role and
-- check ownership themselves (src/lib/dtf/server/access.ts). Row-level security
-- is ALSO on, so the public anon key can only ever see a customer's own rows:
-- a leaked anon key reads nothing that is not the signed-in person's.
--
-- Safe to run twice.

create table if not exists public.dtf_projects (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists dtf_projects_user_idx on public.dtf_projects (user_id, updated_at desc);

create table if not exists public.dtf_assets (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('original','ai','processed','reference','mockup','production')),
  key text not null,
  mime text not null,
  bytes integer not null default 0,
  width integer not null default 0,
  height integer not null default 0,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists dtf_assets_user_idx on public.dtf_assets (user_id, created_at desc);

create table if not exists public.dtf_orders (
  id text primary key,
  number text not null unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null,
  payment_state text not null,
  stripe_session_id text unique,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dtf_orders_user_idx on public.dtf_orders (user_id, created_at desc);
create index if not exists dtf_orders_status_idx on public.dtf_orders (status, created_at desc);

-- Owner settings, the print station's token hash, AI usage counters.
create table if not exists public.dtf_settings (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create sequence if not exists public.dtf_order_seq start with 117;

create or replace function public.dtf_next_order_seq() returns bigint
language sql security definer set search_path = public as $$
  select nextval('public.dtf_order_seq');
$$;
revoke all on function public.dtf_next_order_seq() from public, anon, authenticated;

alter table public.dtf_projects enable row level security;
alter table public.dtf_assets enable row level security;
alter table public.dtf_orders enable row level security;
alter table public.dtf_settings enable row level security;

-- A customer may read and change their own designs.
drop policy if exists dtf_projects_own on public.dtf_projects;
create policy dtf_projects_own on public.dtf_projects
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- A customer may read their own uploads' metadata. Writes go through the server.
drop policy if exists dtf_assets_own_read on public.dtf_assets;
create policy dtf_assets_own_read on public.dtf_assets
  for select to authenticated
  using (user_id = auth.uid());

-- A customer may read their own orders. Every write (payment, status, print
-- files) goes through the server, so there is no insert/update policy at all.
drop policy if exists dtf_orders_own_read on public.dtf_orders;
create policy dtf_orders_own_read on public.dtf_orders
  for select to authenticated
  using (user_id = auth.uid());

-- dtf_settings: RLS on, no policy — service role only.

-- The private bucket for every DTF file class (originals, AI, processed,
-- references, mockups, production). No storage policy: files are served by
-- the app's own routes after an ownership check, or by short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('dtf-assets', 'dtf-assets', false)
on conflict (id) do nothing;
