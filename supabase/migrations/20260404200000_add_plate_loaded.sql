-- Add plate calculator fields to exercises table
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS plate_loaded boolean NOT NULL DEFAULT false;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS bar_weight real NOT NULL DEFAULT 45;
