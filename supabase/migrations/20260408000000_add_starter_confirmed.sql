-- Add starter_confirmed column to user_progression
-- Fixes bug where Supabase sync restores starter_theme but not the confirmation flag,
-- causing users to re-enter trial mode after localStorage eviction.

ALTER TABLE user_progression ADD COLUMN IF NOT EXISTS starter_confirmed boolean NOT NULL DEFAULT false;
