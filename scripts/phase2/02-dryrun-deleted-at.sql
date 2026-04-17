-- Phase 2, Gate 4 DRY RUN: additive soft-delete columns
-- This file is run inside BEGIN/ROLLBACK so nothing is persisted.
-- If this run is clean, the migration itself (same DDL, different file)
-- lands in supabase/migrations/ and auto-applies on master push.

\echo '=== DRY RUN: wrapping everything in a transaction that rolls back ==='
BEGIN;

-- Columns: nullable timestamptz. Null = not deleted. Purely additive.
ALTER TABLE exercises          ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE sets               ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE bodyweight_entries ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Partial indexes for the common "active rows" lookup pattern.
-- Existing full indexes on user_id stay in place for admin / cleanup queries
-- that need to see deleted rows too.
CREATE INDEX IF NOT EXISTS idx_exercises_user_active
  ON exercises (user_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sets_user_exercise_active
  ON sets (user_id, exercise_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bodyweight_user_active
  ON bodyweight_entries (user_id) WHERE deleted_at IS NULL;

\echo ''
\echo '=== Verify columns added ==='
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'deleted_at'
ORDER BY table_name;

\echo ''
\echo '=== Verify indexes created ==='
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND indexname LIKE '%active%'
ORDER BY tablename, indexname;

\echo ''
\echo '=== Verify zero data mutation: row counts unchanged ==='
SELECT 'exercises'          AS t, count(*) FROM exercises
UNION ALL SELECT 'sets',                count(*) FROM sets
UNION ALL SELECT 'bodyweight_entries',  count(*) FROM bodyweight_entries;

\echo ''
\echo '=== Sample: confirm existing rows have deleted_at = NULL (not deleted) ==='
SELECT count(*) FILTER (WHERE deleted_at IS NULL)     AS not_deleted,
       count(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted
FROM exercises;

\echo ''
\echo '=== ROLLBACK — nothing persisted ==='
ROLLBACK;

\echo ''
\echo '=== Post-rollback: columns should NOT exist ==='
SELECT count(*) AS should_be_zero
FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'deleted_at';
