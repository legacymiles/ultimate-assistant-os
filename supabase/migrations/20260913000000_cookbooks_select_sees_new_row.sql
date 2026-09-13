-- ============================================================================
-- Creating a cookbook failed with "new row violates row-level security policy
-- for table cookbooks".
--
-- cookbooks_select called can_view_cookbook(id, ...), a STABLE function that
-- looks the cookbook up again by id. Inside INSERT ... RETURNING that lookup
-- runs on the statement's snapshot, which does not contain the row being
-- inserted, so the returned row failed the SELECT check and the whole insert
-- was reported as an RLS violation.
--
-- The owner and public checks now read the row's own columns, which are always
-- visible. Share-based access still goes through can_view_cookbook(). Who can
-- see what is unchanged. Safe to run twice.
-- ============================================================================

drop policy if exists cookbooks_select on public.cookbooks;
create policy cookbooks_select on public.cookbooks for select
  using (
    owner_id = auth.uid()
    or privacy = 'public'
    or public.can_view_cookbook(id, auth.uid())
  );
