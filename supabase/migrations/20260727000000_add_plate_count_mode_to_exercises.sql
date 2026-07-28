-- Add per-exercise plate-count mode so it syncs across devices (LIFT-783).
-- Sibling of input_mode/bar_weight (both already synced). Nullable: NULL/absent
-- means the client default ('per-side'), matching how the client reads it.
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS plate_count_mode text;
