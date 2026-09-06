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
