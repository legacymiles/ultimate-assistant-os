-- ============================================================================
-- The vault outbox — notes captured where the vault cannot be reached.
--
-- The owner's Obsidian vault lives on their PC and is the source of truth. A
-- phone has no route to it, so a thought captured on a phone has to be queued
-- and written later, when New Jarvis is next open on that machine with the
-- local agent running.
--
-- ## Why this is a table and not a field on app_state
--
-- Every other app in this hub keeps its state as one blob in `app_state`, and
-- the obvious thing would be to put a pending-writes array there too. That is
-- a silent data-loss bug, and the reason is written on app_state itself:
-- last-write-wins, no merging. The failure runs:
--
--   1. a phone queues an op and pushes its whole blob
--   2. the PC flushes the op to disk, clears the queue, pushes the cleared blob
--   3. the owner edits that note in Obsidian
--   4. the phone — which never reloaded — ticks something unrelated, so its
--      stale blob is newer by its own stamp and is pushed WITH the queue in it
--   5. the next flush replays the op and overwrites the Obsidian edit
--
-- "Already applied" has to be a row fact that no blob overwrite can undo.
-- Hence `state`, here, per op.
--
-- ## Why only create and append
--
-- There is deliberately no `replace`. A device that cannot read the file cannot
-- know what it would be replacing, so a blind full-body write is the conflict
-- generator. Appends commute — the result does not depend on the order they
-- arrive in — which is precisely why append is the one operation allowed
-- against a file we cannot see. The check constraint enforces it at the
-- database rather than trusting every caller.
--
-- Nothing here is the durable copy of anything: an applied op's content lives
-- in the vault, and a pending op is also mirrored into `jarvis_memories` with
-- `meta.pending` so it is searchable before it reaches disk.
-- ============================================================================

create table if not exists public.jarvis_vault_ops (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  profile_id  text        not null default 'owner',

  -- Vault-relative, assigned at CAPTURE time rather than at write time. That
  -- is what makes external_id stable before the file exists, lets the note be
  -- searchable immediately, and makes the eventual write an idempotent
  -- create-at-path rather than "find somewhere to put this".
  path        text        not null,

  op          text        not null check (op in ('create', 'append')),
  body        text        not null,

  -- What the capturing device believed the file hashed to; null for a create.
  -- Diagnostic rather than a lock: an append to a file that changed since is
  -- the SAFE case, so a mismatch is not a conflict. Idempotency is carried by
  -- an invisible marker containing this row's id, written into the file itself.
  base_hash   text,

  state       text        not null default 'pending'
                          check (state in ('pending', 'applied', 'conflict')),

  -- Set when a create found the path already taken. The sibling note that was
  -- written instead, so the owner can find both. Nothing is ever overwritten.
  conflict_path text,

  applied_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- The flush reads pending ops oldest-first for one person.
create index if not exists jarvis_vault_ops_pending_idx
  on public.jarvis_vault_ops (user_id, profile_id, state, created_at);

-- ----- Row level security --------------------------------------------------
-- As everywhere else in this schema: a row belongs to one user, and `with
-- check` matters as much as `using`, or a signed-in user could write a row
-- carrying someone else's user_id.
alter table public.jarvis_vault_ops enable row level security;

drop policy if exists jarvis_vault_ops_all on public.jarvis_vault_ops;
create policy jarvis_vault_ops_all on public.jarvis_vault_ops for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
