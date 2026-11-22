-- ---------------------------------------------------------------------------
-- Search keys belong to people.
--
-- The first cut had one kind of key: the owner's, for the owner's own agents
-- and repos. This adds the second: a key issued TO someone, with their own
-- ceiling, their own usage, and an expiry — so the search service can be
-- handed out without handing out the owner's quota or the owner's providers.
--
-- Deliberately keyed on EMAIL rather than on a Supabase user id. The owner
-- issues a key before the person has an account — that is the normal order —
-- and `user_id` is filled in the first time they sign in with that address.
-- An email is also what the owner actually knows about them.
--
-- Safe to run twice.
-- ---------------------------------------------------------------------------

-- Who the key is for. Null = the hub owner's own key (every key issued before
-- this migration), which is why there is no backfill and no NOT NULL.
alter table public.search_api_keys
  add column if not exists owner_email text,
  add column if not exists owner_user_id uuid,
  add column if not exists plan text not null default 'owner',
  add column if not exists expires_at timestamptz,
  add column if not exists note text;

-- The plans a key can be on. Kept as a check rather than a table: there are
-- three, they change about once a year, and a lookup table would be a join on
-- the hot path of every authenticated call.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'search_api_keys_plan_check'
  ) then
    alter table public.search_api_keys
      add constraint search_api_keys_plan_check
      check (plan in ('owner', 'member', 'trial'));
  end if;
end $$;

-- "Every live key for this person", which is what both the owner's admin list
-- and the member's own page ask for.
create index if not exists search_api_keys_owner_email_idx
  on public.search_api_keys (lower(owner_email))
  where revoked_at is null;

create index if not exists search_api_keys_owner_user_idx
  on public.search_api_keys (owner_user_id)
  where revoked_at is null;

-- Usage carries the person too, so "what has this member been searching for,
-- and how much of it is costing me" is one query rather than a join against a
-- key that may since have been revoked and replaced.
alter table public.search_usage
  add column if not exists owner_email text,
  add column if not exists plan text;

create index if not exists search_usage_owner_email_idx
  on public.search_usage (lower(owner_email), created_at desc);

-- ---------------------------------------------------------------------------
-- search_key_claim — attach a key to a Supabase user the first time they sign
-- in with the address it was issued to.
--
-- A function rather than an update from the app because it has to be
-- idempotent and case-insensitive, and because it must never move a key
-- between accounts: once owner_user_id is set it stays set, so a second
-- account claiming the same address cannot take over an existing key.
-- ---------------------------------------------------------------------------
create or replace function public.search_key_claim(p_email text, p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.search_api_keys
     set owner_user_id = p_user_id
   where lower(owner_email) = lower(p_email)
     and owner_user_id is null
     and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.search_key_claim(text, uuid) from public;
grant execute on function public.search_key_claim(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- An expired key is a revoked key, so the hot-path lookup does not have to
-- carry a second condition and nothing downstream has to learn about expiry.
-- Runs opportunistically from the app the same way the rate sweep does.
-- ---------------------------------------------------------------------------
create or replace function public.search_keys_expire()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.search_api_keys
     set revoked_at = now()
   where revoked_at is null
     and expires_at is not null
     and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.search_keys_expire() from public;
grant execute on function public.search_keys_expire() to service_role;
