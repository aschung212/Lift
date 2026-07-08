-- Duration / time-based set types (LIFT-836)
--
-- Planks, dead hangs, loaded carries and isometric holds are measured in
-- seconds, not weight × reps. Two additive columns let the app log them without
-- faking reps:
--
--   exercises.exercise_type  → per-exercise mode. NULL or 'weight' = the normal
--                              weight×reps model; 'duration' = seconds-based.
--   sets.duration_seconds    → whole-second hold time for a duration set, NULL
--                              for every normal set. Duration sets keep
--                              weight/reps/estimated_1rm at 0 so they're
--                              excluded from volume, e1RM and PR math.
--
-- Purely additive: existing rows keep working unchanged (exercise_type NULL →
-- weight model, duration_seconds NULL → not a duration set).

alter table exercises add column if not exists exercise_type text;
alter table sets add column if not exists duration_seconds integer;
