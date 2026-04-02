-- Add updated_at columns for conflict resolution
-- Enables last-write-wins merge when syncing across multiple devices.
-- Original: migration-004-updated-at.sql

-- Add updated_at to exercises
alter table exercises add column if not exists updated_at timestamptz not null default now();

-- Add updated_at to sets
alter table sets add column if not exists updated_at timestamptz not null default now();

-- Add updated_at to bodyweight_entries
alter table bodyweight_entries add column if not exists updated_at timestamptz not null default now();

-- Auto-update trigger function
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Attach triggers
create trigger trg_exercises_updated_at
  before update on exercises
  for each row execute function update_updated_at_column();

create trigger trg_sets_updated_at
  before update on sets
  for each row execute function update_updated_at_column();

create trigger trg_bodyweight_entries_updated_at
  before update on bodyweight_entries
  for each row execute function update_updated_at_column();

-- Index for efficient conflict queries (fetch changed rows since last sync)
create index if not exists idx_exercises_updated_at on exercises(updated_at);
create index if not exists idx_sets_updated_at on sets(updated_at);
create index if not exists idx_bodyweight_entries_updated_at on bodyweight_entries(updated_at);
