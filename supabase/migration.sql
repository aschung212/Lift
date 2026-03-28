-- Lift: Supabase schema migration
-- Run this in the Supabase SQL Editor

-- 1. exercises table
create table exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index idx_exercises_user_id on exercises(user_id);

alter table exercises enable row level security;

create policy "Users can view own exercises"
  on exercises for select using (auth.uid() = user_id);
create policy "Users can insert own exercises"
  on exercises for insert with check (auth.uid() = user_id);
create policy "Users can update own exercises"
  on exercises for update using (auth.uid() = user_id);
create policy "Users can delete own exercises"
  on exercises for delete using (auth.uid() = user_id);

-- 2. sets table
create table sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid not null references exercises(id) on delete cascade,
  date timestamptz not null,
  weight real not null,
  reps integer not null,
  estimated_1rm real not null,
  created_at timestamptz not null default now()
);

create index idx_sets_user_id on sets(user_id);
create index idx_sets_exercise_id on sets(exercise_id);

alter table sets enable row level security;

create policy "Users can view own sets"
  on sets for select using (auth.uid() = user_id);
create policy "Users can insert own sets"
  on sets for insert with check (auth.uid() = user_id);
create policy "Users can update own sets"
  on sets for update using (auth.uid() = user_id);
create policy "Users can delete own sets"
  on sets for delete using (auth.uid() = user_id);

-- 3. bodyweight_entries table
create table bodyweight_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date timestamptz not null,
  weight real not null,
  created_at timestamptz not null default now()
);

create index idx_bodyweight_entries_user_id on bodyweight_entries(user_id);

alter table bodyweight_entries enable row level security;

create policy "Users can view own bodyweight entries"
  on bodyweight_entries for select using (auth.uid() = user_id);
create policy "Users can insert own bodyweight entries"
  on bodyweight_entries for insert with check (auth.uid() = user_id);
create policy "Users can update own bodyweight entries"
  on bodyweight_entries for update using (auth.uid() = user_id);
create policy "Users can delete own bodyweight entries"
  on bodyweight_entries for delete using (auth.uid() = user_id);
