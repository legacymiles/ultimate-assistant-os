-- ============================================================================
-- Jarvis memory — make the meaning search survive 30,000 chunks.
--
-- scripts/sync-folder-rag.mjs indexes the whole master folder as ~30,000
-- retrievable chunks, and at that size every memory search began failing with
-- `57014 canceling statement due to statement timeout`. Four traps, and the
-- missing index was the SMALLEST of them.
--
-- 1. jarvis_search could not use a vector index even if one existed.
--
--    `scope` was a CTE referenced three times, so Postgres materialised it:
--    all 30k rows, full `content` text and `tsv` carried along. Then
--    by_vector ranked with
--
--        row_number() over (order by s.embedding <=> p_embedding)
--
--    and a window function's ORDER BY sorts EVERY row before the `limit p_k`
--    can apply. pgvector only uses an index for a plain `order by <=> limit n`
--    on a table scan, so this was an external disk sort of ~186 MB of vectors
--    on every single question — including the ones that only ever wanted a
--    note the owner typed by hand.
--
--    Both halves are rewritten as plain `order by ... limit p_k` subqueries
--    against the base table, with row_number() applied OUTSIDE, over the p_k
--    rows that survive. That makes the vector index reachable, and it also
--    gives the word half back its gin index on `tsv`, which the materialised
--    CTE had been hiding too.
--
-- 2. The index is ivfflat, not hnsw.
--
--    20260919120000_jarvis_memory.sql said to add one "for tens of thousands
--    of rows", and named ivfflat. An earlier draft of this file reached for
--    hnsw instead — and the build timed out in the dashboard SQL Editor,
--    because hnsw wants the whole graph in maintenance_work_mem (~190 MB for
--    30k x 1536 floats) and falls back to a per-row on-disk build when it does
--    not fit. This instance gives 32 MB (see trap 4), and there is no local
--    DDL path here (no psql, no Supabase CLI, no DATABASE_URL) to raise it
--    from. ivfflat builds in seconds at this size: k-means over 30 centres on
--    a sample, then one assignment pass. `lists = 30` follows pgvector's own
--    guidance of rows/1000 below 1M rows.
--
--    Search becomes approximate: a question can now miss a chunk an exhaustive
--    scan would have ranked tenth. That is the normal trade at this size, and
--    jarvis_search fuses the vector rank with an exact word rank (ts_rank_cd
--    over the gin-indexed tsv), so an exact-word match still cannot be missed.
--
-- 3. probes is set INSIDE the function, not as a SET clause on it.
--
--    ivfflat reads a single list unless told otherwise — default probes is 1,
--    which would read ~1,000 of the 30,000 rows and quietly lose most of the
--    recall the index is for. The obvious home for that is a function-level
--    `set ivfflat.probes = 6` clause, and it is rejected here:
--
--        42501: permission denied to set parameter "ivfflat.probes"
--
--    Until pgvector's library is loaded in a backend, `ivfflat.probes` is only
--    a GUC *placeholder*, and Postgres requires superuser to persist a setting
--    for a placeholder (it cannot know whether the extension will later define
--    it as superuser-only). Supabase's `postgres` role is not superuser. The
--    same assignment at RUNTIME has no such check, so it moves into the body
--    as set_config(..., local => true) — scoped to the transaction, which is
--    one PostgREST request. That also means the function is plpgsql rather
--    than sql, hence `#variable_conflict use_column`: the RETURNS TABLE names
--    are plpgsql variables, and a bare `id` in the body would resolve to one.
--
-- 4. The build needs more maintenance_work_mem than this instance gives.
--
--        54000: memory required is 61 MB, maintenance_work_mem is 32 MB
--
--    That 61 MB is pgvector's k-means SAMPLE — a floor of 10,000 rows, so
--    10,000 x 1536 dims x 4 bytes — and it therefore does not shrink with
--    `lists`. Dropping to lists = 10 would have changed nothing. The raise
--    below is session-scoped and reverts when the script finishes, which is
--    why it is safe on a small instance: nothing holds 96 MB afterwards.
--
-- Build the index AFTER a full run of sync-folder-rag.mjs: ivfflat clusters
-- the vectors that exist at build time, and building against an empty table
-- just means rebuilding later.
--
-- Additive and idempotent: safe to run twice. Kept byte-identical to the
-- paste-ready copy handed to the owner, comments aside.
-- ============================================================================


-- The index build is the one statement here that does real work. This instance
-- gives it 32 MB and ivfflat wants 61 MB, which is pgvector's 10,000-row
-- k-means sample (10,000 x 1536 dims x 4 bytes) and so does NOT shrink with
-- `lists`. Session-scoped, and it reverts the moment this script finishes.
set maintenance_work_mem = '96MB';
set statement_timeout = '10min';

create or replace function public.jarvis_search(
  p_user uuid, p_profile text, p_embedding vector(1536),
  p_query text, p_k int default 10, p_sources text[] default null
)
returns table (
  id uuid, source text, title text, content text, origin text,
  captured_at timestamptz, vector_rank int, word_rank int
)
language plpgsql stable security invoker as $$
#variable_conflict use_column
begin
  -- ivfflat reads ONE list unless told otherwise, which would quietly cost
  -- recall. 6 is sqrt(lists) for the lists = 30 index below, which is
  -- pgvector's own guidance. Set here rather than as a SET clause on the
  -- function: that needs superuser, because the GUC is only a placeholder
  -- until pgvector's library loads in the backend. local = reverts with the
  -- transaction, which is one PostgREST request.
  perform set_config('ivfflat.probes', '6', true);

  return query
  with by_vector as (
    select t.id, row_number() over (order by t.dist) as rk
    from (
      select m.id, m.embedding <=> p_embedding as dist
      from public.jarvis_memories m
      where m.user_id = p_user
        and m.profile_id = p_profile
        and (p_sources is null or m.source = any (p_sources))
        and p_embedding is not null
        and m.embedding is not null
      order by m.embedding <=> p_embedding
      limit p_k
    ) t
  ),
  by_words as (
    select t.id, row_number() over (order by t.score desc) as rk
    from (
      select m.id,
             ts_rank_cd(m.tsv, websearch_to_tsquery('english', p_query)) as score
      from public.jarvis_memories m
      where m.user_id = p_user
        and m.profile_id = p_profile
        and (p_sources is null or m.source = any (p_sources))
        and p_query <> ''
        and m.tsv @@ websearch_to_tsquery('english', p_query)
      order by ts_rank_cd(m.tsv, websearch_to_tsquery('english', p_query)) desc
      limit p_k
    ) t
  ),
  hits as (
    select by_vector.id from by_vector
    union
    select by_words.id from by_words
  )
  select m.id, m.source, m.title, m.content, m.origin, m.captured_at,
         coalesce(v.rk, 0)::int as vector_rank,
         coalesce(w.rk, 0)::int as word_rank
  from hits h
  join public.jarvis_memories m on m.id = h.id
  left join by_vector v on v.id = h.id
  left join by_words w on w.id = h.id;
end
$$;

create index if not exists jarvis_memories_embedding_idx
  on public.jarvis_memories using ivfflat (embedding vector_cosine_ops)
  with (lists = 30);
