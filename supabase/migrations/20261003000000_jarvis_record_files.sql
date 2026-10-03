-- Pictures of the documents behind the Life Record: insurance cards, pay
-- stubs, benefits letters. Per-user folders (<user id>/<file id>.jpg).
--
-- The server also creates this bucket on first use (blobStore.ensureBucket),
-- so nothing breaks before this runs; the migration is the record of intent.
--
-- Private with NO storage policy — same posture as std-safe-reports,
-- dashboard-inbox and dance-studio. Only the server, holding the service-role
-- key, reads or writes it, and whose file is whose is enforced in the route
-- layer by the user-id key prefix.
--
-- Unlike the others, these are NEVER handed out as signed URLs: a signed link
-- to a photograph of an insurance card is a bearer token for that card. The
-- bytes are streamed through /api/jarvis/record/file/<id>, which re-checks the
-- caller on every single view.
--
-- Safe to run twice.

insert into storage.buckets (id, name, public)
values ('jarvis-record-files', 'jarvis-record-files', false)
on conflict (id) do nothing;
