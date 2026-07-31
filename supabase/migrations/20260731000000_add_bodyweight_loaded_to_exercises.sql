-- Add bodyweight_loaded to exercises (LIFT-834)
--
-- Marks calisthenic-loaded lifts (pull-ups, dips, weighted chins) where the
-- numeric `weight` on a set is only the EXTERNAL added load. When true, the
-- client folds the lifter's tracked bodyweight into the load so estimated 1RM
-- reflects real effort instead of undercounting (a bodyweight rep at +0 lb
-- would otherwise estimate a 0 lb 1RM).
--
-- A plain boolean column (not a child table) because it is a single scalar
-- setting that only ever travels with its parent exercise — like bar_weight and
-- intensity_max_reps. Purely additive with a false default so every existing
-- row keeps standard (external-load-only) behavior exactly as before.

alter table exercises add column if not exists bodyweight_loaded boolean not null default false;
