-- Add duration/time-based set support (LIFT-836)
--
-- Timed strength movements (planks, dead hangs, loaded carries, isometric
-- holds) are logged as a number of SECONDS held rather than weight × reps.
-- Two additive columns support this:
--
--   sets.duration          integer  — seconds held for a duration-mode set.
--                                      NULL for a normal weight×reps set, so
--                                      switching an exercise's mode clears any
--                                      stale value. A set with a duration carries
--                                      weight/reps/estimated_1rm as 0, so it is
--                                      naturally excluded from 1RM/PR math.
--   exercises.is_duration  boolean  — the exercise logs time-based sets.
--                                      NULL/false = default weight×reps mode.
--
-- Purely additive: every existing query keeps working, and the NULL defaults
-- mean existing rows behave exactly as before.

alter table sets add column if not exists duration integer;
alter table exercises add column if not exists is_duration boolean;
