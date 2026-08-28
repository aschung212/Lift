-- Add intensity_max_reps to exercises (#770)
--
-- Per-exercise config for the log-set "Intensity" lens: how many rep rows
-- (1..N) the intensity table calculates and displays. Client code defaults to
-- 10 when unset; this column only stores a user OVERRIDE:
--   NULL → no override, use the default (10)
--   N    → show rep rows 1..N (clamped client-side to [1, 100])
--
-- A plain integer column (not a child table) because it is a single scalar
-- setting that only ever travels with its parent exercise — like bar_weight.
-- Purely additive: every existing query keeps working, and a NULL default
-- means existing rows use the default rep count exactly as before.
--
-- Note: the older warmup_scheme column (LIFT-725) is now dormant — the
-- Intensity lens supersedes the standalone warmup ramp (#770) — but the column
-- is intentionally left in place to avoid a destructive migration.

alter table exercises add column if not exists intensity_max_reps integer;
