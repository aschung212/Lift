-- Add superset_id to exercises (#616)
--
-- Superset / circuit grouping: exercises that share the same non-null
-- superset_id are trained in alternation (push/pull supersets, tri-sets,
-- giant sets). The id is an opaque client-minted uuid string — the same
-- string-identity model as gyms/tags, with grouping resolved entirely
-- client-side (local-first: the full exercise list is already in memory),
-- so there is deliberately no index. A group needs ≥2 members to exist;
-- an id held by a single row is dissolved client-side, so no server
-- constraint enforces cardinality.
--
-- Purely additive: nullable with no default keeps every existing row and
-- query working, and the upsert always sends the column (null when
-- ungrouped) so dissolving a superset propagates the clear server-side
-- (equipment/#931 + gyms/#961 always-send rule).

alter table exercises add column if not exists superset_id text;
