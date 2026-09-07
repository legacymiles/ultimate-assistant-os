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
