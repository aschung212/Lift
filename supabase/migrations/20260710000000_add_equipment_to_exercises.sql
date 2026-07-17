-- Add equipment to exercises (#931 phase C)
--
-- Explicit per-exercise equipment classification for the AI Coach's derived
-- analytics (reliable-1RM standards comparison + machine/bodyweight reliability
-- flags). Client code falls back to a conservative name heuristic
-- (classifyExercise in src/lib/coachAnalytics.ts) when unset; this column only
-- stores a user OVERRIDE set in the exercise's Edit sheet:
--   NULL           → no override, use the name heuristic ("Auto")
--   'free_weight' | 'machine' | 'bodyweight'
--
-- A plain text column (not an enum) so a future kind is a client-only change;
-- the client sanitizes on every boundary (store setter, localStorage load,
-- remote fetch) and degrades unknown values to "unset" rather than trusting
-- them. Purely additive, same pattern as bar_weight / intensity_max_reps:
-- every existing query keeps working and NULL rows behave exactly as before.

alter table exercises add column if not exists equipment text;
