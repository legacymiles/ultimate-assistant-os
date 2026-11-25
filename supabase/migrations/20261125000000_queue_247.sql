-- ---------------------------------------------------------------------------
-- 24/7 Queue — the persistent task engine behind Jarvis's queue.
--
-- Why Postgres and not Redis + BullMQ: Supabase is already this hub's one
-- database, the Vercel site and the VPS worker can both reach it, and a
-- `FOR UPDATE SKIP LOCKED` claim gives the same exactly-one-worker guarantee a
-- Redis queue does — without a second store to keep alive, back up and expose
-- to the internet. Every task, run, log line and finding is a row, so nothing
-- depends on a browser, a worker's memory or a single machine staying up.
--
-- Posture: RLS on, NO policies — the hub's convention for server-owned data.
-- Only the service role (the API routes after their own sign-in checks, and
-- the VPS worker) touches these rows. The claim/renew functions are
-- security definer and revoked from anon/authenticated.
--
-- Safe to run twice.
-- ---------------------------------------------------------------------------

create table if not exists public.queue_tasks (
  id               uuid primary key default gen_random_uuid(),
  user_id          text not null,
  title            text not null,
  description      text not null default '',
  instruction      text not null default '',
  app              text not null default '',
  executor         text not null,
  agent            text not null default '',
  kind             text not null default 'once'
                     check (kind in ('once','scheduled','recurring','continuous')),
  status           text not null default 'queued'
                     check (status in ('queued','scheduled','running','waiting_approval','needs_input','paused','completed','failed','cancelled')),
  priority         smallint not null default 3 check (priority between 1 and 5),
  progress         smallint not null default 0 check (progress between 0 and 100),
  current_step     text not null default '',
  steps            jsonb not null default '[]'::jsonb,
  config           jsonb not null default '{}'::jsonb,
  state            jsonb not null default '{}'::jsonb,
  schedule         jsonb not null default '{}'::jsonb,
  next_run_at      timestamptz,
  last_run_at      timestamptz,
  last_activity_at timestamptz,
  attempts         integer not null default 0,
  max_attempts     integer not null default 5,
  parent_id        uuid references public.queue_tasks(id) on delete set null,
  depends_on       uuid[] not null default '{}',
  needs            text[] not null default '{}',
  locked_by        text,
  lock_until       timestamptz,
  success_count    integer not null default 0,
  failure_count    integer not null default 0,
  last_error       text,
  result_summary   text,
  question         text,
  created_by       text not null default 'you',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- The claim's scan: due, claimable work, best first.
create index if not exists queue_tasks_due_idx
  on public.queue_tasks (priority desc, next_run_at)
  where status in ('queued','scheduled','running');
create index if not exists queue_tasks_user_idx on public.queue_tasks (user_id, updated_at desc);
create index if not exists queue_tasks_parent_idx on public.queue_tasks (parent_id);

alter table public.queue_tasks enable row level security;

-- One row per executed step: who ran it, how long, what came of it.
create table if not exists public.queue_runs (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.queue_tasks(id) on delete cascade,
  worker      text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  outcome     text,
  summary     text,
  error       text,
  metrics     jsonb not null default '{}'::jsonb
);
create index if not exists queue_runs_task_idx on public.queue_runs (task_id, started_at desc);
alter table public.queue_runs enable row level security;

-- The execution log. Append-only.
create table if not exists public.queue_events (
  id       bigserial primary key,
  task_id  uuid not null references public.queue_tasks(id) on delete cascade,
  run_id   uuid references public.queue_runs(id) on delete set null,
  at       timestamptz not null default now(),
  level    text not null default 'info' check (level in ('info','step','warn','error','result')),
  message  text not null,
  data     jsonb
);
create index if not exists queue_events_task_idx on public.queue_events (task_id, id desc);
alter table public.queue_events enable row level security;

-- Durable results: ranked bots, storyboards, research notes, alerts.
-- (user_id, kind, key) is the memory that stops the same thing being
-- researched, downloaded or reported twice.
create table if not exists public.queue_findings (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid references public.queue_tasks(id) on delete set null,
  user_id    text not null,
  app        text not null default '',
  kind       text not null,
  key        text not null,
  title      text not null,
  summary    text not null default '',
  url        text,
  score      real,
  data       jsonb not null default '{}'::jsonb,
  notable    boolean not null default false,
  seen       boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, key)
);
create index if not exists queue_findings_user_idx on public.queue_findings (user_id, created_at desc);
create index if not exists queue_findings_task_idx on public.queue_findings (task_id, score desc nulls last);
alter table public.queue_findings enable row level security;

-- The conversation with Jarvis, per task or general.
create table if not exists public.queue_messages (
  id       uuid primary key default gen_random_uuid(),
  task_id  uuid references public.queue_tasks(id) on delete cascade,
  user_id  text not null,
  role     text not null check (role in ('you','jarvis')),
  text     text not null,
  task_ids uuid[] not null default '{}',
  at       timestamptz not null default now()
);
create index if not exists queue_messages_user_idx on public.queue_messages (user_id, at desc);
create index if not exists queue_messages_task_idx on public.queue_messages (task_id, at);
alter table public.queue_messages enable row level security;

-- Apps connected to the queue from outside the hub. Hub apps come from the
-- catalog and are not stored here.
create table if not exists public.queue_apps (
  id           text not null,
  user_id      text not null,
  name         text not null,
  url          text,
  description  text not null default '',
  capabilities text[] not null default '{}',
  callback_url text,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.queue_apps enable row level security;

-- Keys an outside app uses to talk to the queue. sha256 of the secret only;
-- the plaintext is shown once at creation.
create table if not exists public.queue_app_keys (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  app_id      text not null,
  prefix      text not null,
  key_hash    text not null unique,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at  timestamptz
);
create index if not exists queue_app_keys_live_idx on public.queue_app_keys (key_hash) where revoked_at is null;
alter table public.queue_app_keys enable row level security;

-- Every worker's heartbeat: what it can do, what it is running, its load.
create table if not exists public.queue_workers (
  id           text primary key,
  host         text not null default '',
  capabilities text[] not null default '{}',
  concurrency  integer not null default 1,
  running      integer not null default 0,
  version      text not null default '',
  metrics      jsonb not null default '{}'::jsonb,
  started_at   timestamptz not null default now(),
  seen_at      timestamptz not null default now()
);
alter table public.queue_workers enable row level security;

-- In-app notifications: a notable discovery, a task that needs the owner, a failure.
create table if not exists public.queue_notifications (
  id       uuid primary key default gen_random_uuid(),
  user_id  text not null,
  task_id  uuid references public.queue_tasks(id) on delete cascade,
  title    text not null,
  body     text not null default '',
  link     text,
  read     boolean not null default false,
  at       timestamptz not null default now()
);
create index if not exists queue_notifications_user_idx on public.queue_notifications (user_id, at desc);
alter table public.queue_notifications enable row level security;

-- ---------------------------------------------------------------------------
-- The claim. Exactly one worker gets a given task, even with many workers
-- polling at once: SKIP LOCKED makes a row another transaction is claiming
-- invisible instead of making us wait for it.
--
-- Claimable = due (next_run_at <= now) AND (unlocked OR its lease expired —
-- a crashed worker's task comes back by itself) AND every dependency
-- completed AND the worker has every capability it needs AND its executor is
-- not one the worker is already running at its limit.
-- ---------------------------------------------------------------------------
create or replace function public.queue_claim(
  p_worker text,
  p_caps text[],
  p_lease_seconds integer,
  p_skip_executors text[] default '{}'
) returns setof public.queue_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  picked public.queue_tasks;
begin
  select t.* into picked
    from public.queue_tasks t
   where t.status in ('queued','scheduled','running')
     and (t.next_run_at is null or t.next_run_at <= now())
     and (t.lock_until is null or t.lock_until < now())
     and t.needs <@ p_caps
     and not (t.executor = any(p_skip_executors))
     and not exists (
       select 1 from public.queue_tasks d
        where d.id = any(t.depends_on) and d.status <> 'completed'
     )
   order by t.priority desc, t.next_run_at nulls first, t.created_at
   for update skip locked
   limit 1;

  if not found then
    return;
  end if;

  update public.queue_tasks
     set status = 'running',
         locked_by = p_worker,
         lock_until = now() + make_interval(secs => p_lease_seconds),
         attempts = attempts + 1,
         last_activity_at = now(),
         updated_at = now()
   where id = picked.id
  returning * into picked;

  return next picked;
end;
$$;

-- A worker still busy on a long step extends its lease. Returns false when the
-- lease was lost (expired and taken) or the owner paused/cancelled the task —
-- the worker then aborts the step.
create or replace function public.queue_renew(
  p_task uuid,
  p_worker text,
  p_lease_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.queue_tasks
     set lock_until = now() + make_interval(secs => p_lease_seconds),
         last_activity_at = now()
   where id = p_task
     and locked_by = p_worker
     and status = 'running';
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.queue_claim(text, text[], integer, text[]) from public, anon, authenticated;
revoke all on function public.queue_renew(uuid, text, integer) from public, anon, authenticated;

-- updated_at on findings
create or replace function public.queue_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists queue_findings_touch on public.queue_findings;
create trigger queue_findings_touch before update on public.queue_findings
  for each row execute function public.queue_touch();
