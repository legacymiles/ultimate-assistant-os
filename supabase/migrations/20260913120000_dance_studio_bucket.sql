-- Dance Studio media: reference dance clips, character images, posters and
-- generated videos, under per-user folders (<user id>/clips/…).
--
-- The server also creates this bucket on first use (blobStore.ensureBucket),
-- so nothing breaks before this runs; the migration is the record of intent.
--
-- Private with NO storage policy — the same posture as std-safe-reports and
-- dashboard-inbox. Only the server, holding the service-role key, reads or
-- writes it. The browser uploads through one-time signed upload links and
-- views through short signed read links; the video model downloads through
-- signed links too. Whose files are whose is enforced in the route layer by
-- the user-id key prefix.
--
-- Safe to run twice.

insert into storage.buckets (id, name, public)
values ('dance-studio', 'dance-studio', false)
on conflict (id) do nothing;
