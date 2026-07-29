-- Add target_e1rm to exercises (LIFT-1035)
--
-- Per-exercise strength goal: an optional target estimated-1RM (stored in lbs,
-- the same unit as sets.estimated_1rm) drawn as a dashed reference line on the
-- exercise progress graph. Mirrors the bodyweight goal-line pattern.
--   NULL → no goal set (no line drawn)
--   N    → target e1RM in lbs (clamped client-side to (0, MAX_WEIGHT])
--
-- A plain numeric column (not a child table) because it is a single scalar
-- setting that only ever travels with its parent exercise — like bar_weight
-- and intensity_max_reps. Purely additive: existing queries keep working and a
-- NULL default means existing rows simply have no goal line, exactly as before.

alter table exercises add column if not exists target_e1rm numeric;
