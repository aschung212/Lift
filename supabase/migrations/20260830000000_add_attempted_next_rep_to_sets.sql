-- Add attempted_next_rep to sets (#1271)
--
-- A set logged as "8 reps" collapses two different efforts into one number:
-- eight reps then a deliberate re-rack, versus eight reps then a failed attempt
-- at a ninth. The second is the higher-output set and is real evidence that
-- progressive overload is still moving even though the rep count did not
-- change, so the client records which one happened:
--   false (default) → re-racked after the last completed rep, as before
--   true            → went for one more rep past `reps` and missed it
--
-- Purely additive with a NOT NULL DEFAULT false, exactly like
-- exercises.bodyweight_loaded (LIFT-834): every existing row and query keeps
-- its current behavior, and existing sets are NOT backfilled — the annotation
-- is a claim about what happened and we never asked at the time.

alter table sets add column if not exists attempted_next_rep boolean not null default false;
