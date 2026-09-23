-- Cook Connect, third pass: groups and group chat.
--
-- Pod Play Connect had interest groups — curated communities you join, each
-- with its own conversation. They were left out of the first merge on purpose
-- and are wanted after all, so they come across here with the cooking slant
-- the rest of the app has.
--
-- Member counts are NOT stored on the group. Pod Play kept a member_count
-- column and incremented it from the client, which drifts the moment a join
-- fails halfway. Here the count is read from the membership table.
--
-- Run after 20260922120000_cook_connect_journal_and_shares.sql.

create table if not exists cook.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 2 and 60),
  description text,
  /** 0-359. Gives each group a consistent colour without storing a gradient. */
  hue         integer not null default 24 check (hue between 0 and 359),
  created_by  uuid not null references cook.profiles(id) on delete cascade,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists cook.group_members (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid not null references cook.groups(id) on delete cascade,
  user_id   uuid not null references cook.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create index if not exists group_members_group_idx on cook.group_members(group_id);
create index if not exists group_members_user_idx on cook.group_members(user_id);

-- ── Row level security ────────────────────────────────────────────

alter table cook.groups        enable row level security;
alter table cook.group_members enable row level security;

drop policy if exists groups_read on cook.groups;
create policy groups_read on cook.groups for select using (is_active);
drop policy if exists groups_write on cook.groups;
create policy groups_write on cook.groups for insert with check (created_by = auth.uid());
drop policy if exists groups_update on cook.groups;
create policy groups_update on cook.groups for update using (created_by = auth.uid());
drop policy if exists groups_delete on cook.groups;
create policy groups_delete on cook.groups for delete using (created_by = auth.uid());

-- Memberships are public: a group shows who is in it.
drop policy if exists group_members_read on cook.group_members;
create policy group_members_read on cook.group_members for select using (true);
drop policy if exists group_members_join on cook.group_members;
create policy group_members_join on cook.group_members for insert with check (user_id = auth.uid());
drop policy if exists group_members_leave on cook.group_members;
create policy group_members_leave on cook.group_members for delete using (user_id = auth.uid());

-- ── Group chat ────────────────────────────────────────────────────
--
-- Group rooms are 'group:<id>'. Only members may read or post, so a group
-- conversation is not readable by walking the messages table.

create or replace function cook.is_group_member(room_key text)
returns boolean
language sql
stable
security definer
set search_path = cook, public
as $$
  select case
    when room_key not like 'group:%' then true
    else exists (
      select 1 from cook.group_members m
      where m.user_id = auth.uid()
        and m.group_id::text = substring(room_key from 7)
    )
  end;
$$;

grant execute on function cook.is_group_member(text) to authenticated;

drop policy if exists messages_read on cook.messages;
create policy messages_read on cook.messages for select using (
  (room not like 'dm:%' or room like '%' || auth.uid()::text || '%')
  and cook.is_group_member(room)
);

drop policy if exists messages_write on cook.messages;
create policy messages_write on cook.messages for insert with check (
  user_id = auth.uid()
  and (room not like 'dm:%' or room like '%' || auth.uid()::text || '%')
  and cook.is_group_member(room)
);

grant select, insert, update, delete on all tables in schema cook to authenticated;
grant select on all tables in schema cook to anon;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table cook.group_members;
  end if;
exception
  when duplicate_object then null;
end $$;
