-- Add gyms to exercises (#961)
--
-- Per-gym exercise membership for the exclusive gym filter. An exercise can
-- belong to any number of gyms; an EMPTY array means "unassigned — shows
-- under every gym filter" (shared equipment like barbells needs no setup).
-- The gym name list itself lives in the user_preferences JSONB blob; this
-- column stores plain gym-name strings per exercise (same string-identity
-- model as tags — a rename rewrites exercise rows client-side).
--
-- Filtering is CLIENT-SIDE ONLY (local-first: the full exercise list is
-- already in memory), so unlike tags' GIN index there is deliberately no
-- index here — no server query ever filters by gym. Purely additive:
-- `not null default '{}'` keeps every existing row and query working, and
-- the upsert always sends the column so clearing propagates (equipment/#931
-- always-send rule).

alter table exercises add column if not exists gyms text[] not null default '{}';
