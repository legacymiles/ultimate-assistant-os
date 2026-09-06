-- ============================================================================
-- STD Safe — storage for uploaded lab reports.
--
-- These are the most sensitive bytes in the hub: a real lab report carries a
-- full legal name, a date of birth and a medical record number next to the
-- results. They were written to std-safe-reports/<user>/ on local disk, which
-- on Vercel means the upload is accepted and then silently lost.
--
-- SECURITY: like server_docs, RLS is on and NO policy is created, so every
-- client-facing role is denied outright. This is stricter than the voice-clips
-- bucket on purpose, and the reason is that STD Safe does not use Supabase auth
-- at all — it has its own accounts, handles and share codes, so auth.uid() says
-- nothing about who owns a report and cannot be used to fence one off.
--
-- Ownership is therefore enforced where it is actually known: in the routes,
-- which re-derive the owner from the session rather than trusting the URL, and
-- never include a report in a shared view. Only the service role reaches these
-- objects, and only through that code.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('std-safe-reports', 'std-safe-reports', false)
on conflict (id) do nothing;

-- No policy is created for this bucket. Any policy that previously existed is
-- removed: deny-all to anon and authenticated is the intended posture, and
-- this migration is the place that asserts it.
drop policy if exists std_safe_reports_rw on storage.objects;
drop policy if exists std_safe_reports_select on storage.objects;
drop policy if exists std_safe_reports_insert on storage.objects;
drop policy if exists std_safe_reports_update on storage.objects;
drop policy if exists std_safe_reports_delete on storage.objects;
