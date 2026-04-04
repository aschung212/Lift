-- Add active_theme and epoch columns to xp_events
-- Add epoch column to user_progression
-- Supports per-theme stats and prestige system

ALTER TABLE xp_events ADD COLUMN IF NOT EXISTS active_theme text;
ALTER TABLE xp_events ADD COLUMN IF NOT EXISTS epoch integer NOT NULL DEFAULT 1;

ALTER TABLE user_progression ADD COLUMN IF NOT EXISTS epoch integer NOT NULL DEFAULT 1;
