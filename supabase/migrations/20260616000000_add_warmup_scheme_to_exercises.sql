-- Add warmup_scheme to exercises (LIFT-725)
--
-- Per-exercise custom warmup ramp. The default ramp (40/60/80/90% × descending
-- reps) lives in client code; this column only stores a user OVERRIDE:
--   NULL          → no override, use the default ramp
--   []            → explicitly no warmup ramp for this exercise
--   [{pct,reps}…] → the user's custom ladder of warmup steps
--
-- jsonb (not a child table) because the scheme is a tiny, opaque,
-- read-as-a-whole array that only ever travels with its parent exercise —
-- the same shape the client persists to localStorage. Purely additive: every
-- existing query keeps working, and a NULL default means existing rows ramp
-- with the default scheme exactly as before.

alter table exercises add column if not exists warmup_scheme jsonb;
