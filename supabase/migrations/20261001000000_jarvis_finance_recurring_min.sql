-- ============================================================================
-- Jarvis — Personal Finance, follow-up.
--
-- One column, added after the first migration had already been applied.
--
-- It exists because running the engines over a REAL Plaid feed showed the
-- undeclared-subscription rule firing eleven times, including for McDonald's
-- and Starbucks. Part of the fix was a floor below which a repeating charge is
-- not worth calling a subscription, and the floor belongs with the owner's
-- other thresholds rather than hardcoded.
--
-- The app does not depend on this: `toSettings` falls back to 3 when the column
-- is absent, so running this is housekeeping, not a fix for anything broken.
--
-- Additive and idempotent: safe to run twice.
-- ============================================================================

alter table public.finance_settings
  add column if not exists recurring_min_amount numeric(14, 2) not null default 3.00;
