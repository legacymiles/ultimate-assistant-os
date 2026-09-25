-- ============================================================================
-- Jarvis memory — make the sync's unique index usable.
--
-- The index this replaces was PARTIAL:
--
--   create unique index jarvis_memories_external_idx
--     on public.jarvis_memories (user_id, source, external_id)
--     where external_id is not null;
--
-- Postgres will not infer a partial index for ON CONFLICT unless the statement
-- repeats the predicate, and PostgREST (so the Supabase client, so the app) has
-- no way to send one. Every master-folder sync therefore failed with
--
--   42P10: there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
-- and the Memory tab stayed empty while ~100 skills and ~90 Claude Code memory
-- files sat on disk.
--
-- A total index is safe here: in a unique index NULLs are never equal to each
-- other, so the hand-written memories (external_id null) can still be as many
-- as the owner likes — exactly what the partial predicate was protecting.
--
-- Additive and idempotent: safe to run twice.
-- ============================================================================

drop index if exists public.jarvis_memories_external_idx;

create unique index if not exists jarvis_memories_external_idx
  on public.jarvis_memories (user_id, source, external_id);
