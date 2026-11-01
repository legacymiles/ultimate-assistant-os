-- ============================================================================
-- Jarvis memory — an index for the meaning search.
--
-- 20260919120000_jarvis_memory.sql deliberately shipped WITHOUT a vector index,
-- and said exactly why:
--
--   "an ivfflat index. It is an optimisation for tens of thousands of rows,
--    and an exact scan is both correct and fast below that."
--
-- scripts/sync-folder-rag.mjs crosses that line. It indexes the whole master
-- folder as ~30,000 retrievable chunks, so every `embedding <=> $1` inside
-- jarvis_search now scans ~30,000 × 1536 floats — roughly 180 MB of vector
-- data per question. That cost lands on EVERY memory search, including the ones
-- that only ever wanted a note the owner typed by hand, and the MCP route gives
-- itself 60 seconds (`maxDuration`) for embedding plus the round trip.
--
-- So the condition the original file named has been met, and this is the index
-- it told us to add — HNSW rather than ivfflat, because ivfflat's `lists` has
-- to be guessed against the current row count and goes stale as the folder
-- grows, while HNSW needs no such guess and gives better recall for the same
-- time budget. The ivfflat form is kept as the fallback for an older pgvector.
--
-- Note that this changes search from exact to approximate: a question can now
-- miss a chunk that an exhaustive scan would have ranked tenth. That is the
-- normal trade for a corpus this size, and jarvis_search fuses the vector rank
-- with a word rank (ts_rank_cd over the tsv column, which is exact and indexed
-- by gin), so an exact-word match still cannot be missed.
--
-- Build it AFTER the first full run of sync-folder-rag.mjs: both index types
-- cluster the vectors that exist at build time, and building against an empty
-- table just means rebuilding later.
--
-- Additive and idempotent: safe to run twice.
-- ============================================================================

do $$
begin
  begin
    create index if not exists jarvis_memories_embedding_idx
      on public.jarvis_memories using hnsw (embedding vector_cosine_ops);
  exception
    when undefined_object or feature_not_supported or syntax_error then
      -- pgvector older than 0.5 has no hnsw: fall back to the plan the first
      -- migration wrote down, with lists sized for the ~30k rows we now hold.
      create index if not exists jarvis_memories_embedding_idx
        on public.jarvis_memories using ivfflat (embedding vector_cosine_ops)
        with (lists = 100);
  end;
end $$;
