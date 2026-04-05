-- Add input mode and bar weight fields to exercises table
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS plate_loaded boolean NOT NULL DEFAULT false;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS input_mode text NOT NULL DEFAULT 'numpad';
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS bar_weight real NOT NULL DEFAULT 45;
