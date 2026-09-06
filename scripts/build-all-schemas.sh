#!/usr/bin/env bash
# Regenerate supabase/all-schemas.sql from the migrations directory.
#
# all-schemas.sql exists only for the dashboard-paste path, used when no
# database credential is available to run `supabase db push`. The files in
# supabase/migrations are the source of truth; this just concatenates them.
set -euo pipefail
cd "$(dirname "$0")/.."

{
  cat <<'HDR'
-- ============================================================================
-- GENERATED FILE — do not edit by hand.
--
-- Every migration in ./migrations concatenated in order, for the one case the
-- Supabase CLI cannot cover: applying the schema by pasting into the dashboard
-- SQL Editor when no database credential is available locally.
--
-- The migrations themselves are the source of truth. Regenerate with:
--   scripts/build-all-schemas.sh
--
-- Every statement is idempotent (create ... if not exists / drop policy if
-- exists / duplicate_object guards), so running this more than once is safe.
-- ============================================================================

HDR
  for f in supabase/migrations/*.sql; do
    printf '\n\n-- ####################################################################\n'
    printf -- '-- MIGRATION: %s\n' "$(basename "$f")"
    printf -- '-- ####################################################################\n\n'
    cat "$f"
  done
} > supabase/all-schemas.sql

echo "wrote supabase/all-schemas.sql ($(wc -l < supabase/all-schemas.sql) lines)"
