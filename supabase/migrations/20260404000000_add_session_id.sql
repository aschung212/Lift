-- Add session_id to sets table for grouping sets into workout sessions
ALTER TABLE sets ADD COLUMN IF NOT EXISTS session_id text;
