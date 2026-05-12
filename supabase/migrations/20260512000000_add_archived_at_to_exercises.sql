-- Add archived_at to exercises (LIFT-434)
--
-- "Archived" is a soft-hide for exercises the user has stopped training
-- in the current block but does NOT want to delete. The row stays in the
-- table — sets continue to count toward lifetime PR/volume queries — but
-- the UI filters archived rows out of the main list and exercise pickers
-- unless the user explicitly asks to see them.
--
-- Purely additive: NULL = active, non-NULL = archived-at-that-time.
-- Existing queries (`is('deleted_at', null)`) keep working unchanged; the
-- client filters on archived_at locally so that unarchive can restore
-- without round-tripping.

alter table exercises add column if not exists archived_at timestamptz;

-- No partial index — archive lookups happen on the client after the same
-- `is('deleted_at', null)` fetch already covered by idx_exercises_user_active.
