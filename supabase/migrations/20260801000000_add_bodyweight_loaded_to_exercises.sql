-- Add bodyweight_loaded to exercises (LIFT-834)
--
-- Flags calisthenic-loaded lifts (pull-ups, dips, weighted chins) whose true
-- load is the lifter's bodyweight plus any added plate/belt weight. The client
-- folds the lifter's bodyweight into the effective load for volume + e1RM when
-- this is true:
--   false (default) → the `weight` column is the whole load, as before
--   true            → `weight` is the ADDED weight; bodyweight is folded in
--
-- A plain boolean that travels with its parent exercise — like bar_weight and
-- intensity_max_reps. Purely additive with a NOT NULL DEFAULT false, so every
-- existing row and query keeps its current behavior exactly.

alter table exercises add column if not exists bodyweight_loaded boolean not null default false;
