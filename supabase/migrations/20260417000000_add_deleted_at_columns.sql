-- Phase 2 Gate 4: additive soft-delete columns (follow-up to #338 / #339)
--
-- Adds a nullable deleted_at timestamptz to the three mutable data tables.
-- NULL = active row, non-NULL = soft-deleted-at-that-time.
--
-- This migration is purely additive:
--   - No existing queries filter on deleted_at, so they keep seeing all rows.
--   - No data is mutated; all existing rows start with deleted_at = NULL.
--   - No triggers, no RLS changes, no client-facing behavior change.
--
-- Client UPDATE-instead-of-DELETE rollout lands in a separate PR (Gate 5)
-- so rollback here is trivial: drop three columns, drop three indexes.

alter table exercises          add column if not exists deleted_at timestamptz;
alter table sets               add column if not exists deleted_at timestamptz;
alter table bodyweight_entries add column if not exists deleted_at timestamptz;

-- Partial indexes for the common "give me active rows for this user" lookup.
-- Existing idx_*_user_id indexes remain in place for admin / cleanup queries
-- that need to see soft-deleted rows too.
create index if not exists idx_exercises_user_active
  on exercises (user_id) where deleted_at is null;

create index if not exists idx_sets_user_exercise_active
  on sets (user_id, exercise_id) where deleted_at is null;

create index if not exists idx_bodyweight_user_active
  on bodyweight_entries (user_id) where deleted_at is null;
