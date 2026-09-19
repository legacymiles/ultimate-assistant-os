-- ============================================================================
-- Jarvis — semantic memory.
--
-- One row per remembered thing, with both a meaning vector (pgvector) and a
-- text-search vector, so a question can be answered by meaning AND by exact
-- words. The two orders are fused in the app (reciprocal rank fusion), which
-- is why this function returns BOTH ranks rather than one blended score.
--
-- Rows belong to one person. RLS is on, and the policies are owner-only —
-- Jarvis's memory holds the owner's private life, so no world-readable path
-- exists, not even for aggregates.
--
-- Additive and idempotent: safe to run twice.
-- ============================================================================

create extension if not exists vector;

create table if not exists public.jarvis_memories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Which Four-Cs profile this belongs to, so onboarding someone else does not
  -- pour their memories into the owner's ball.
  profile_id  text not null default 'owner',
  source      text not null check (source in
                ('note','chat','master-folder','skill','file','email','event','profile')),
  title       text not null check (char_length(title) between 1 and 300),
  content     text not null,
  origin      text not null default 'you',
  tags        text[] not null default '{}',
  meta        jsonb not null default '{}'::jsonb,
  -- A stable key for re-syncable sources (a file path, a message id). Lets the
  -- master-folder sync run twice without duplicating every note.
  external_id text,
  embedding   vector(1536),
  captured_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- One row per external thing per person: the sync is an upsert, not an append.
create unique index if not exists jarvis_memories_external_idx
  on public.jarvis_memories (user_id, source, external_id)
  where external_id is not null;

create index if not exists jarvis_memories_user_idx
  on public.jarvis_memories (user_id, captured_at desc);

-- Word search. A generated column keeps it in step with edits automatically.
alter table public.jarvis_memories
  add column if not exists tsv tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) stored;

create index if not exists jarvis_memories_tsv_idx
  on public.jarvis_memories using gin (tsv);

-- Meaning search. IVFFlat needs rows before it helps; with few rows Postgres
-- scans, which is correct and fast at this size.
create index if not exists jarvis_memories_embedding_idx
  on public.jarvis_memories using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

alter table public.jarvis_memories enable row level security;

drop policy if exists "jarvis_memories owner reads" on public.jarvis_memories;
create policy "jarvis_memories owner reads" on public.jarvis_memories
  for select using (auth.uid() = user_id);

drop policy if exists "jarvis_memories owner writes" on public.jarvis_memories;
create policy "jarvis_memories owner writes" on public.jarvis_memories
  for insert with check (auth.uid() = user_id);

drop policy if exists "jarvis_memories owner updates" on public.jarvis_memories;
create policy "jarvis_memories owner updates" on public.jarvis_memories
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "jarvis_memories owner deletes" on public.jarvis_memories;
create policy "jarvis_memories owner deletes" on public.jarvis_memories
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Hybrid search.
--
-- Returns the best `k` rows by meaning and the best `k` by words, each with its
-- position in that order. The caller fuses them. Returning ranks instead of a
-- blended score keeps the ranking rule in one tested place in the app, and
-- keeps this function honest about which search found what.
-- ---------------------------------------------------------------------------
create or replace function public.jarvis_search(
  p_user       uuid,
  p_profile    text,
  p_embedding  vector(1536),
  p_query      text,
  p_k          int default 10,
  p_sources    text[] default null
)
returns table (
  id           uuid,
  source       text,
  title        text,
  content      text,
  origin       text,
  captured_at  timestamptz,
  vector_rank  int,
  word_rank    int
)
language sql
stable
security invoker
set search_path = public
as $$
  with scope as (
    select m.* from public.jarvis_memories m
    where m.user_id = p_user
      and m.profile_id = p_profile
      and (p_sources is null or m.source = any (p_sources))
  ),
  by_vector as (
    select s.id, row_number() over (order by s.embedding <=> p_embedding) as rk
    from scope s
    where p_embedding is not null and s.embedding is not null
    order by s.embedding <=> p_embedding
    limit p_k
  ),
  by_words as (
    select s.id,
           row_number() over (
             order by ts_rank_cd(s.tsv, websearch_to_tsquery('english', p_query)) desc
           ) as rk
    from scope s
    where p_query <> '' and s.tsv @@ websearch_to_tsquery('english', p_query)
    limit p_k
  )
  select s.id, s.source, s.title, s.content, s.origin, s.captured_at,
         coalesce(v.rk, 0)::int as vector_rank,
         coalesce(w.rk, 0)::int as word_rank
  from scope s
  left join by_vector v on v.id = s.id
  left join by_words  w on w.id = s.id
  where v.id is not null or w.id is not null;
$$;

grant execute on function public.jarvis_search(uuid, text, vector, text, int, text[]) to authenticated;
