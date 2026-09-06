-- ============================================================================
-- Voice Studio — storage for recorded and generated audio.
--
-- Voice Studio kept its cloned-voice reference clips and its generated history
-- as base64 data: URLs inside one localStorage blob. That cannot follow the
-- user to another device the way the other apps now do: a 10-30 second clip is
-- far too big to sit in an app_state jsonb row, and a handful of them would
-- blow past sensible row limits and make every sync slow.
--
-- So the bytes live here and only the path travels in the row.
--
-- Unlike the older project-files bucket, ownership is encoded in the object
-- path — every object must sit under a folder named for the owner's user id —
-- and the policies below enforce that. Without it, "authenticated" would mean
-- any signed-in user could read every other user's voice recordings.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('voice-clips', 'voice-clips', false)
on conflict (id) do nothing;

-- storage.foldername(name) splits the object path; [1] is the first segment,
-- which callers must set to the uploader's auth.uid().
drop policy if exists voice_clips_select on storage.objects;
create policy voice_clips_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'voice-clips'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists voice_clips_insert on storage.objects;
create policy voice_clips_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'voice-clips'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists voice_clips_update on storage.objects;
create policy voice_clips_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'voice-clips'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'voice-clips'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists voice_clips_delete on storage.objects;
create policy voice_clips_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'voice-clips'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
