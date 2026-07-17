-- Add free-form notes to sets and exercises (LIFT-619)
--
-- Two independent annotation fields, matching the two competitor-parity use
-- cases (Hevy/Strong): a per-set `note` ("left shoulder felt tight",
-- "paused rep") and a per-exercise `notes` field for durable cues
-- ("brace before unrack", "use fat grips").
--
-- Purely additive and nullable: NULL = no note. Existing reads/writes are
-- unaffected. The client treats an empty string the same as NULL (clears
-- the column) so toggling a note off round-trips cleanly.

alter table sets add column if not exists note text;
alter table exercises add column if not exists notes text;
