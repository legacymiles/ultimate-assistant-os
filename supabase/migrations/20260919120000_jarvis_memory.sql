-- ============================================================================
-- Jarvis — semantic memory.
--
-- One row per remembered thing, carrying BOTH a meaning vector (pgvector) and
-- a text-search vector, so a question can be answered by meaning and by exact
-- words. jarvis_search returns the two ranks separately; the app fuses them
-- (reciprocal rank fusion, src/lib/jarvis/rank.ts) so the same ranking rule
-- also runs in the on-device fallback and is unit tested without a database.
--
-- Rows belong to one person and RLS is owner-only: Jarvis's memory holds the
-- owner's private life, so there is no world-readable path, not even for
-- aggregates.
--
-- This file is the exact SQL that ran successfully on 2026-09-19 against
-- project kiiwaiwrfslqankcsnkf, in three parts. Two things that are NOT here,
-- because an earlier draft carrying them was rejected by the SQL editor:
--   * a schema-qualified `extensions.vector(1536)` type — the unqualified name
--     resolves, the qualified one depends on where the extension landed;
--   * an ivfflat index. It is an optimisation for tens of thousands of rows,
--     and an exact scan is both correct and fast below that. Add it later:
--       create index jarvis_memories_embedding_idx on public.jarvis_memories
--         using ivfflat (embedding vector_cosine_ops) with (lists = 100);
--
-- Additive and idempotent: safe to run twice.
-- ============================================================================

-- 1 of 3 ---------------------------------------------------------------------
create extension if not exists vector;

-- 2 of 3 ---------------------------------------------------------------------
create table if not exists public.jarvis_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Which Four-Cs profile this belongs to, so onboarding someone else does not
  -- pour their memories into the owner's ball.
  profile_id text not null default 'owner',
  source text not null,
  title text not null,
  content text not null,
  origin text not null default 'you',
  tags text[] not null default '{}',
  meta jsonb not null default '{}'::jsonb,
  -- A stable key for re-syncable sources (a file path, a message id), so the
  -- master-folder sync upserts instead of duplicating every note.
  external_id text,
  embedding vector(1536),
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) stored
);

create unique index if not exists jarvis_memories_external_idx
  on public.jarvis_memories (user_id, source, external_id) where external_id is not null;
create index if not exists jarvis_memories_user_idx
  on public.jarvis_memories (user_id, captured_at desc);
create index if not exists jarvis_memories_tsv_idx
  on public.jarvis_memories using gin (tsv);

alter table public.jarvis_memories enable row level security;
drop policy if exists "jarvis owner all" on public.jarvis_memories;
create policy "jarvis owner all" on public.jarvis_memories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3 of 3 ---------------------------------------------------------------------
create or replace function public.jarvis_search(
  p_user uuid, p_profile text, p_embedding vector(1536),
  p_query text, p_k int default 10, p_sources text[] default null
)
returns table (
  id uuid, source text, title text, content text, origin text,
  captured_at timestamptz, vector_rank int, word_rank int
)
language sql stable security invoker as $$
  with scope as (
    select m.* from public.jarvis_memories m
    where m.user_id = p_user and m.profile_id = p_profile
      and (p_sources is null or m.source = any (p_sources))
  ),
  by_vector as (
    select s.id, row_number() over (order by s.embedding <=> p_embedding) as rk
    from scope s where p_embedding is not null and s.embedding is not null limit p_k
  ),
  by_words as (
    select s.id, row_number() over (
      order by ts_rank_cd(s.tsv, websearch_to_tsquery('english', p_query)) desc) as rk
    from scope s
    where p_query <> '' and s.tsv @@ websearch_to_tsquery('english', p_query) limit p_k
  )
  select s.id, s.source, s.title, s.content, s.origin, s.captured_at,
         coalesce(v.rk, 0)::int, coalesce(w.rk, 0)::int
  from scope s
  left join by_vector v on v.id = s.id
  left join by_words w on w.id = s.id
  where v.id is not null or w.id is not null;
$$;
