-- Add plate_count_mode to exercises (LIFT-1039)
--
-- Per-exercise plate-counting convention for the plate calculator:
--   'per-side' → plates are counted per side of the bar (default)
--   'total'    → plates are counted as the total load (loadable dumbbells,
--                Smith/machine setups where you add plates at a single point)
--   NULL       → unset; the client falls back to 'per-side'.
--
-- This setting existed on the client `Exercise` model but was only ever
-- persisted to localStorage — it never synced, so it diverged across devices
-- (LIFT-1039, split from LIFT-783). A plain text column, same additive pattern
-- as bar_weight / intensity_max_reps / equipment: existing rows get NULL and
-- behave exactly as before.

alter table exercises add column if not exists plate_count_mode text;
