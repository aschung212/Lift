-- Phase 2, Gate 1: read-only investigation of dupe state
-- Context: PR #338 landed 2026-04-17, removed client-dedup DELETE broadcasts
-- from the sync READ path. This query characterizes the current state of
-- server-side dupes so we can plan the one-time cleanup (Gate 7).
--
-- SAFE: zero writes. Read-only. Can be re-run anytime without side effects.

\echo '=== 1. Baseline row counts ==='
SELECT 'exercises' AS table, count(*) FROM exercises
UNION ALL SELECT 'sets', count(*) FROM sets
UNION ALL SELECT 'bodyweight_entries', count(*) FROM bodyweight_entries
UNION ALL SELECT 'auth.users', count(*) FROM auth.users;

\echo ''
\echo '=== 2. Exercise dupes: same user, same name (case-insensitive) ==='
SELECT
  count(*)                            AS total_dup_groups,
  coalesce(sum(cnt - 1), 0)           AS total_extra_exercise_rows,
  count(*) FILTER (WHERE cnt >= 3)    AS triplicate_or_worse_groups,
  max(cnt)                            AS max_copies_in_one_group
FROM (
  SELECT user_id, lower(name) AS name_key, count(*) AS cnt
  FROM exercises
  GROUP BY user_id, lower(name)
  HAVING count(*) > 1
) g;

\echo ''
\echo '=== 3. Set dupes: same user/exercise/date/weight/reps ==='
SELECT
  count(*)                            AS total_dup_groups,
  coalesce(sum(cnt - 1), 0)           AS total_extra_set_rows,
  count(*) FILTER (WHERE cnt >= 5)    AS straight_set_5plus_groups,
  max(cnt)                            AS max_copies_in_one_group
FROM (
  SELECT user_id, exercise_id, date, weight, reps, count(*) AS cnt
  FROM sets
  GROUP BY user_id, exercise_id, date, weight, reps
  HAVING count(*) > 1
) g;

\echo ''
\echo '=== 4. Bodyweight dupes: same user, same calendar date ==='
SELECT
  count(*)                            AS total_dup_groups,
  coalesce(sum(cnt - 1), 0)           AS total_extra_bw_rows,
  max(cnt)                            AS max_copies_in_one_group
FROM (
  SELECT user_id, date::date AS d, count(*) AS cnt
  FROM bodyweight_entries
  GROUP BY user_id, date::date
  HAVING count(*) > 1
) g;

\echo ''
\echo '=== 5. Orphan sets (exercise_id points to non-existent exercise) ==='
\echo '    Signature of partial dedup failure: sets reassigned to deleted primary'
SELECT
  count(*)                            AS orphan_sets,
  count(DISTINCT s.exercise_id)       AS orphan_exercise_ids,
  count(DISTINCT s.user_id)           AS affected_users
FROM sets s
WHERE NOT EXISTS (SELECT 1 FROM exercises e WHERE e.id = s.exercise_id);

\echo ''
\echo '=== 6. Per-user breakdown: who is affected, how much ==='
SELECT
  u.email,
  (SELECT count(*) FROM exercises e WHERE e.user_id = u.id)          AS n_exercises,
  (SELECT count(*) FROM sets s WHERE s.user_id = u.id)               AS n_sets,
  (SELECT count(*) FROM bodyweight_entries b WHERE b.user_id = u.id) AS n_bw,
  (SELECT coalesce(sum(cnt - 1), 0) FROM (
    SELECT count(*) AS cnt FROM exercises WHERE user_id = u.id GROUP BY lower(name) HAVING count(*) > 1
  ) g)                                                               AS dup_ex_rows,
  (SELECT coalesce(sum(cnt - 1), 0) FROM (
    SELECT count(*) AS cnt FROM sets WHERE user_id = u.id GROUP BY exercise_id, date, weight, reps HAVING count(*) > 1
  ) g)                                                               AS dup_set_rows,
  (SELECT coalesce(sum(cnt - 1), 0) FROM (
    SELECT count(*) AS cnt FROM bodyweight_entries WHERE user_id = u.id GROUP BY date::date HAVING count(*) > 1
  ) g)                                                               AS dup_bw_rows,
  (SELECT count(*) FROM sets s WHERE s.user_id = u.id AND NOT EXISTS (
    SELECT 1 FROM exercises e WHERE e.id = s.exercise_id
  ))                                                                 AS orphan_sets
FROM auth.users u
ORDER BY u.created_at;

\echo ''
\echo '=== 7. Top 15 largest set-dupe groups (shape of problem) ==='
SELECT
  u.email,
  e.name                              AS exercise,
  s.date::date                        AS day,
  s.weight,
  s.reps,
  count(*)                            AS n_copies
FROM sets s
JOIN exercises e ON e.id = s.exercise_id
JOIN auth.users u ON u.id = s.user_id
GROUP BY u.email, e.name, s.date::date, s.weight, s.reps
HAVING count(*) > 1
ORDER BY n_copies DESC, u.email, day DESC
LIMIT 15;

\echo ''
\echo '=== 8. Top 10 exercise-name-dupe groups ==='
SELECT
  u.email,
  lower(e.name)                       AS name_key,
  count(*)                            AS n_copies,
  (SELECT count(*) FROM sets s WHERE s.exercise_id IN (
    SELECT id FROM exercises e2 WHERE e2.user_id = e.user_id AND lower(e2.name) = lower(e.name)
  )) AS total_sets_across_copies
FROM exercises e
JOIN auth.users u ON u.id = e.user_id
GROUP BY u.email, e.user_id, lower(e.name)
HAVING count(*) > 1
ORDER BY n_copies DESC, total_sets_across_copies DESC
LIMIT 10;
