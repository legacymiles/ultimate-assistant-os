-- ============================================================================
-- Server-owned JSON documents.
--
-- Two apps here are not per-user stores and cannot use app_state: STD Safe and
-- the Recall Lists board. Both are shared, multi-party, and keep their own
-- account systems — STD Safe's whole point is that a second person asks you for
-- a result and you approve it — so their state is one document owned by the
-- server, not a row owned by a viewer.
--
-- Both wrote that document to a JSON file next to the project. On Vercel the
-- filesystem is read-only and per-instance, so those writes either fail or
-- vanish at the next deploy. This table is where the document goes instead.
--
-- SECURITY: row level security is enabled and NO policy is created. That is
-- deliberate, not an oversight. Postgres denies every access to a table with
-- RLS on and no matching policy, so `anon` and `authenticated` — which is to
-- say anything holding the publishable key, including all browser code — can
-- neither read nor write these rows. Only the service role, which bypasses RLS
-- and is used exclusively in server routes, can reach them.
--
-- That matters more here than anywhere else in this schema: one of these
-- documents holds real health records, and every rule about who may see which
-- result is enforced in the route layer above. A client-readable copy would
-- route around all of it.
-- ============================================================================

create table if not exists public.server_docs (
  name       text        primary key,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Enabled with no policy: deny-all to every client-facing role. See above.
alter table public.server_docs enable row level security;

-- Should a policy ever have been added by hand, remove it — the deny-all
-- posture is the point, and this migration is the place that asserts it.
drop policy if exists server_docs_all on public.server_docs;

create or replace function public.touch_server_docs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists server_docs_touch on public.server_docs;
create trigger server_docs_touch
  before update on public.server_docs
  for each row execute function public.touch_server_docs_updated_at();
