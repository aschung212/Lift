-- LIFT-723: body circumference measurements (chest, arms, waist, thighs)
--
-- Mirrors the bodyweight_entries shape so the existing sync / soft-delete /
-- IndexedDB-backup infrastructure can be reused. Each row is a single
-- measurement of one body part on one date. Values are stored canonically in
-- centimeters; the client converts to inches for imperial display.
--
-- Purely additive: new table, new indexes, new RLS policies. No existing
-- queries or data are affected, so rollback is just `drop table`.

create table if not exists body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date timestamptz not null,
  type text not null,
  value real not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_body_measurements_user_id
  on body_measurements(user_id);

-- Partial index for the common "active rows for this user" lookup.
create index if not exists idx_body_measurements_user_active
  on body_measurements (user_id) where deleted_at is null;

alter table body_measurements enable row level security;

create policy "Users can view own body measurements"
  on body_measurements for select using (auth.uid() = user_id);
create policy "Users can insert own body measurements"
  on body_measurements for insert with check (auth.uid() = user_id);
create policy "Users can update own body measurements"
  on body_measurements for update using (auth.uid() = user_id);
create policy "Users can delete own body measurements"
  on body_measurements for delete using (auth.uid() = user_id);
