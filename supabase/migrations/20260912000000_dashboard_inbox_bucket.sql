-- Dashboard iPhone photo inbox.
--
-- An iOS Shortcut POSTs photos to /api/dashboard/inbox/push, and the route
-- stores each one here through src/lib/server/blobStore.ts until a browser
-- claims it — at which point it is deleted. The inbox is a transit buffer, not
-- a library; unclaimed photos are swept after 7 days.
--
-- Without this bucket every push on a deployed host fails with "storage
-- unavailable". blobStore uses Supabase Storage whenever SUPABASE_SERVICE_ROLE_KEY
-- is set, and nothing else creates the bucket. Local development never noticed,
-- because the preview server blanks the Supabase URL and falls back to the
-- filesystem.
--
-- Private, and deliberately given NO storage policy — the same arrangement as
-- std-safe-reports. Only the server, holding the service-role key, reads or
-- writes it; the anon and authenticated roles are denied outright. Whose photos
-- are whose is enforced in the route layer, by the per-user device token.
--
-- The inbox's manifest (hashed tokens, pending entries, seen identifiers) lives
-- in public.server_docs, which already exists.
--
-- Safe to run twice.

insert into storage.buckets (id, name, public)
values ('dashboard-inbox', 'dashboard-inbox', false)
on conflict (id) do nothing;

-- No policy is created for this bucket, and any that exists is removed:
-- deny-all to anon and authenticated is the intended posture, and this
-- migration is the place that asserts it — as std-safe-reports does.
drop policy if exists dashboard_inbox_rw on storage.objects;
drop policy if exists dashboard_inbox_select on storage.objects;
drop policy if exists dashboard_inbox_insert on storage.objects;
drop policy if exists dashboard_inbox_update on storage.objects;
drop policy if exists dashboard_inbox_delete on storage.objects;
