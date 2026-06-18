-- Add plate_count_mode to exercises (LIFT-783)
--
-- Per-exercise plate-counting preference for the plate calculator:
--   NULL        → no override, client default ('per-side')
--   'per-side'  → plates shown per side of the bar
--   'total'     → plates shown as a single total
--
-- This closes a sync gap: plateCountMode is a sibling of inputMode/barWeight
-- (both of which already sync), but it was persisted only to localStorage and
-- never written to Supabase, so it silently diverged across a user's devices.
--
-- A plain text column (not a child table) because it is a single scalar
-- setting that only ever travels with its parent exercise — like bar_weight
-- and input_mode. Purely additive: every existing query keeps working, and a
-- NULL default means existing rows fall back to the client default exactly as
-- before.

alter table exercises add column if not exists plate_count_mode text;
