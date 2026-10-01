-- ============================================================================
-- Jarvis — Personal Finance.
--
-- Two ledgers and one reconciliation: `finance_bills` is what the owner says
-- should happen, `finance_txns` is what the bank reports did happen, and every
-- alert is a mismatch between them. See
-- docs/superpowers/specs/2026-09-30-personal-finance-design.md.
--
-- Four decisions worth knowing before changing anything here:
--
-- 1. RLS IS OWNER-ONLY on every table, with no world-readable path, not even
--    for aggregates — the same reasoning as jarvis_memories. This holds bank
--    transactions.
--
-- 2. ACCESS TOKENS ARE ENCRYPTED BY THE APP, never stored raw, and no API route
--    returns one. The column holds AES-256-GCM ciphertext.
--
-- 3. finance_alerts_fingerprint_idx IS NOT A PARTIAL INDEX. A PostgREST upsert
--    cannot use a partial unique index — error 42P10, which is exactly what
--    broke the Jarvis memory sync. Resist adding a WHERE clause to it.
--
-- 4. AMOUNTS ARE POSITIVE WHEN MONEY LEAVES, matching Plaid's sign convention,
--    so spend is a plain sum and no adapter has to flip signs.
--
-- Additive and idempotent: safe to run twice.
-- ============================================================================

-- 1 of 6 --------------------------------------------------------------------
create table if not exists public.finance_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('plaid', 'gocardless', 'manual')),
  institution_id text,
  institution_name text not null default '',
  -- AES-256-GCM ciphertext. Never a raw token, never returned to a client.
  access_token_enc text,
  item_id text,
  sync_cursor text,
  status text not null default 'active'
    check (status in ('active', 'needs_reauth', 'error', 'revoked')),
  status_detail text not null default '',
  -- The EU 90-day consent clock. Null for providers without a fixed expiry.
  consent_expires_at timestamptz,
  last_synced_at timestamptz,
  -- Enforces a provider's per-day call ceiling (GoCardless allows as few as 4).
  sync_count_today smallint not null default 0,
  sync_count_day date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_connections_user_idx
  on public.finance_connections (user_id, provider);

-- 2 of 6 --------------------------------------------------------------------
create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid references public.finance_connections (id) on delete cascade,
  provider_account_id text,
  name text not null default '',
  official_name text,
  mask text,
  type text not null default 'depository' check (type in ('depository', 'credit')),
  subtype text,
  currency text not null default 'GBP',
  balance_current numeric(14, 2),
  balance_available numeric(14, 2),
  balances_as_of timestamptz,
  -- Does this account's spending count toward the daily/weekly figures?
  -- Credit cards yes, current accounts no, until the owner says otherwise.
  count_in_spend boolean not null default true,
  -- ---- credit only --------------------------------------------------------
  credit_limit numeric(14, 2),
  apr_purchase numeric(6, 3),
  last_statement_balance numeric(14, 2),
  statement_last_closed date,
  statement_next_closing date,
  statement_next_closing_estimated boolean not null default false,
  next_due_date date,
  minimum_payment numeric(14, 2),
  is_overdue boolean not null default false,
  cycle_days smallint,
  -- Where the dates above came from. The UI shows this, so it cannot lie.
  dates_source text not null default 'typed'
    check (dates_source in ('bank', 'typed', 'inferred')),
  dates_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_accounts_provider_idx
  on public.finance_accounts (connection_id, provider_account_id)
  where provider_account_id is not null;
create index if not exists finance_accounts_user_idx
  on public.finance_accounts (user_id, type);

-- 3 of 6 --------------------------------------------------------------------
create table if not exists public.finance_bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  payee text not null default '',
  merchant_matchers text[] not null default '{}',
  amount_expected numeric(14, 2) not null default 0,
  amount_tolerance numeric(14, 2) not null default 1.00,
  amount_tolerance_pct numeric(5, 2) not null default 5,
  currency text not null default 'GBP',
  account_id uuid references public.finance_accounts (id) on delete set null,
  autopay boolean not null default false,
  category text,
  cadence text not null default 'monthly'
    check (cadence in ('weekly', 'fortnightly', 'monthly', 'quarterly', 'annual', 'one_off')),
  -- 31 means "the last day of the month", so a short February behaves.
  day_of_month smallint check (day_of_month between 1 and 31),
  weekday smallint check (weekday between 0 and 6),
  month_of_year smallint check (month_of_year between 1 and 12),
  first_due date not null,
  end_date date,
  grace_days smallint not null default 3,
  -- Minutes before the due date, the same vocabulary as the Recall calendar.
  reminders int[] not null default '{1440}',
  paused boolean not null default false,
  origin text not null default 'typed' check (origin in ('typed', 'detected')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_bills_user_idx
  on public.finance_bills (user_id, paused, first_due);

-- 4 of 6 --------------------------------------------------------------------
create table if not exists public.finance_txns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.finance_accounts (id) on delete cascade,
  provider_txn_id text not null,
  date date not null,
  authorized_date date,
  -- Positive when money leaves, matching Plaid, so spend is a plain sum.
  amount numeric(14, 2) not null,
  currency text not null default 'GBP',
  merchant_raw text not null default '',
  merchant_norm text not null default '',
  category text,
  pending boolean not null default false,
  -- On a POSTED row, the pending row it replaced. Folding this pair is what
  -- stops an ordinary purchase being read as a double charge.
  pending_txn_id text,
  -- Soft delete, set by a TRANSACTIONS_REMOVED webhook. Hard-deleting would
  -- lose the fact a charge was once seen, which matters when an alert cites it.
  removed_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists finance_txns_provider_idx
  on public.finance_txns (account_id, provider_txn_id);
create index if not exists finance_txns_user_date_idx
  on public.finance_txns (user_id, date desc);
create index if not exists finance_txns_merchant_idx
  on public.finance_txns (user_id, merchant_norm);

-- 5 of 6 --------------------------------------------------------------------
create table if not exists public.finance_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'duplicate-charge', 'missed-bill', 'amount-changed',
    'unplanned-recurring', 'card-due-soon', 'card-statement-closing'
  )),
  -- Stable identity across reconciliation runs, so a dismissal sticks.
  fingerprint text not null,
  state text not null default 'open'
    check (state in ('open', 'acknowledged', 'dismissed', 'resolved')),
  severity text not null default 'warn' check (severity in ('info', 'warn', 'urgent')),
  title text not null,
  -- The evidence sentence: amounts, payee, dates.
  why text not null default '',
  amount numeric(14, 2),
  currency text not null default 'GBP',
  bill_id uuid references public.finance_bills (id) on delete set null,
  account_id uuid references public.finance_accounts (id) on delete set null,
  txn_ids text[] not null default '{}',
  noticed_at timestamptz not null default now(),
  decided_at timestamptz,
  note text not null default '',
  updated_at timestamptz not null default now()
);

-- NOT partial. A PostgREST upsert cannot use a partial unique index (42P10).
create unique index if not exists finance_alerts_fingerprint_idx
  on public.finance_alerts (user_id, fingerprint);
create index if not exists finance_alerts_open_idx
  on public.finance_alerts (user_id, state, noticed_at desc);

-- 6 of 6 --------------------------------------------------------------------
create table if not exists public.finance_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  lead_days int[] not null default '{7,3,1}',
  duplicate_min_amount numeric(14, 2) not null default 1.00,
  duplicate_window_days smallint not null default 3,
  -- Payees where several same-amount charges in a day are normal. Grows from
  -- the owner dismissing a real alert, not from a guessed seed list.
  multi_charge_payees text[] not null default '{}',
  email_kinds text[] not null default '{duplicate-charge,missed-bill,card-due-soon}',
  quiet_hours_start smallint not null default 22,
  quiet_hours_end smallint not null default 7,
  -- 0 = Sunday, 1 = Monday.
  week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6),
  alert_email text,
  -- Null means "show each account in its own currency". Nothing is converted.
  currency_display text,
  updated_at timestamptz not null default now()
);

-- RLS ------------------------------------------------------------------------
-- Owner-only on every table. Written out rather than looped: this file is
-- pasted into the SQL editor by hand, and a dynamic-SQL failure there is a
-- worse trade than six repeated statements.

alter table public.finance_connections enable row level security;
alter table public.finance_accounts    enable row level security;
alter table public.finance_bills       enable row level security;
alter table public.finance_txns        enable row level security;
alter table public.finance_alerts      enable row level security;
alter table public.finance_settings    enable row level security;

drop policy if exists finance_connections_owner on public.finance_connections;
create policy finance_connections_owner on public.finance_connections
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists finance_accounts_owner on public.finance_accounts;
create policy finance_accounts_owner on public.finance_accounts
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists finance_bills_owner on public.finance_bills;
create policy finance_bills_owner on public.finance_bills
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists finance_txns_owner on public.finance_txns;
create policy finance_txns_owner on public.finance_txns
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists finance_alerts_owner on public.finance_alerts;
create policy finance_alerts_owner on public.finance_alerts
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists finance_settings_owner on public.finance_settings;
create policy finance_settings_owner on public.finance_settings
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
