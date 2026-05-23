-- LIFT-310: add supporter self-attestation column to user_progression
--
-- A boolean flag the user toggles in settings to enable the supporter
-- badge / theme after sponsoring via GitHub Sponsors or Buy Me a Coffee.
-- Default false so existing rows stay unchanged.

ALTER TABLE public.user_progression
  ADD COLUMN IF NOT EXISTS supporter boolean NOT NULL DEFAULT false;
