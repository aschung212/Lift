-- Add group_id to exercises (LIFT-616: superset / circuit grouping)
--
-- Exercises that share a non-null group_id form a superset (or circuit):
-- the user alternates sets between them. The id is a client-generated UUID
-- shared across the grouped rows — there is no separate "groups" table, so
-- grouping is a pure attribute that syncs through the existing exercise
-- upsert path with no extra round-trips.
--
-- Purely additive: NULL = ungrouped (the default for every existing row).
-- The client enforces the "a group needs 2+ members" invariant and dissolves
-- orphaned groups locally, so no constraint or index is required here.

alter table exercises add column if not exists group_id text;
