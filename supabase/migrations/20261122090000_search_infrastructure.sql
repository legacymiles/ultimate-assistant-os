-- ---------------------------------------------------------------------------
-- Centralized search service: cache, service keys, rate counters, usage.
--
-- Every table is RLS-on with NO policy, which is the posture the rest of this
-- hub uses for server-owned data: the anon key in a browser reads nothing at
-- all, and only the server, holding the service-role key, touches these rows.
-- That matters most for search_api_keys, which holds credential hashes.
--
-- Safe to run twice.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Cache
-- ---------------------------------------------------------------------------
create table if not exists public.search_cache (
  cache_key   text primary key,
  query       text not null,
  kind        text not null,
  provider    text,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);

-- The TTL check is done in the application rather than here, because the TTL
-- is configurable per deployment and a row written under a one-hour TTL should
-- still be usable if the owner later raises it to a day.
create index if not exists search_cache_created_idx on public.search_cache (created_at desc);
create index if not exists search_cache_kind_idx on public.search_cache (kind);

alter table public.search_cache enable row level security;

-- ---------------------------------------------------------------------------
-- Service keys
--
-- `key_hash` is sha256(plaintext). The plaintext is shown once, at creation,
-- and is not recoverable — so a dump of this table is not a set of working
-- credentials. `prefix` is the first 12 characters, enough to tell two keys
-- apart in a list and useless on its own.
-- ---------------------------------------------------------------------------
create table if not exists public.search_api_keys (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  prefix       text not null,
  key_hash     text not null unique,
  scopes       text[] not null default array['search','extract']::text[],
  per_minute   integer,
  per_day      integer,
  calls_total  bigint not null default 0,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

-- The lookup on every authenticated call: by hash, unrevoked.
create index if not exists search_api_keys_live_idx
  on public.search_api_keys (key_hash)
  where revoked_at is null;

alter table public.search_api_keys enable row level security;

-- ---------------------------------------------------------------------------
-- Rate counters
--
-- One row per caller per window. Two windows per caller at any time (this
-- minute, today), so the table stays small and old rows are swept below.
-- ---------------------------------------------------------------------------
create table if not exists public.search_rate_counters (
  caller_id    text not null,
  window_kind  text not null check (window_kind in ('minute', 'day')),
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (caller_id, window_kind, window_start)
);

create index if not exists search_rate_counters_window_idx
  on public.search_rate_counters (window_start);

alter table public.search_rate_counters enable row level security;

-- ---------------------------------------------------------------------------
-- Usage
-- ---------------------------------------------------------------------------
create table if not exists public.search_usage (
  id           bigserial primary key,
  caller_id    text not null,
  caller_kind  text not null,
  caller_label text,
  app          text,
  kind         text not null,
  query        text not null,
  provider     text,
  location     text,
  cached       boolean not null default false,
  degraded     boolean not null default false,
  ms           integer not null default 0,
  result_count integer not null default 0,
  extracted    integer not null default 0,
  ok           boolean not null default true,
  error        text,
  created_at   timestamptz not null default now()
);

create index if not exists search_usage_created_idx on public.search_usage (created_at desc);
create index if not exists search_usage_caller_idx on public.search_usage (caller_id, created_at desc);
create index if not exists search_usage_app_idx on public.search_usage (app, created_at desc);

alter table public.search_usage enable row level security;

-- ---------------------------------------------------------------------------
-- search_rate_bump — count one call against both windows, atomically.
--
-- Why a function and not a read-then-write from the app: ten parallel searches
-- from one agent would all read the same count and all pass a limit of one.
-- `insert … on conflict do update` increments and returns in a single
-- statement, so the tenth call sees ten.
--
-- It also sweeps counters older than two days on roughly one call in two
-- hundred, which keeps the table from growing without needing a cron. The
-- sweep is cheap (an indexed delete of a handful of rows) and random so it
-- never lands on every instance at once.
-- ---------------------------------------------------------------------------
create or replace function public.search_rate_bump(
  p_caller text,
  p_minute timestamptz,
  p_day    timestamptz
)
returns table (minute_count integer, day_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minute integer;
  v_day    integer;
begin
  insert into public.search_rate_counters (caller_id, window_kind, window_start, count)
  values (p_caller, 'minute', p_minute, 1)
  on conflict (caller_id, window_kind, window_start)
    do update set count = public.search_rate_counters.count + 1
  returning count into v_minute;

  insert into public.search_rate_counters (caller_id, window_kind, window_start, count)
  values (p_caller, 'day', p_day, 1)
  on conflict (caller_id, window_kind, window_start)
    do update set count = public.search_rate_counters.count + 1
  returning count into v_day;

  if random() < 0.005 then
    delete from public.search_rate_counters where window_start < now() - interval '2 days';
  end if;

  return query select v_minute, v_day;
end;
$$;

-- ---------------------------------------------------------------------------
-- search_key_touch — stamp last-used and bump the lifetime counter.
--
-- A function so it is one round trip and one statement on the hot path of
-- every authenticated call.
-- ---------------------------------------------------------------------------
create or replace function public.search_key_touch(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.search_api_keys
     set last_used_at = now(),
         calls_total = calls_total + 1
   where id = p_id;
$$;

-- These run as the definer, and the service role is the only caller that can
-- reach them (RLS with no policy blocks anon and authenticated from the tables
-- themselves). Revoking the default public grant stops a signed-in browser
-- using the anon key from calling them directly.
revoke all on function public.search_rate_bump(text, timestamptz, timestamptz) from public;
revoke all on function public.search_key_touch(uuid) from public;
grant execute on function public.search_rate_bump(text, timestamptz, timestamptz) to service_role;
grant execute on function public.search_key_touch(uuid) to service_role;
