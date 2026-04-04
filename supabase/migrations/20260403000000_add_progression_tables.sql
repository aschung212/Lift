-- Progression system: user_progression, xp_events, progression_snapshots
-- Issue #113 (epic), #124 (instrumentation)

-- 1. user_progression table (one row per user, stores progression state)
create table user_progression (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_xp numeric not null default 0,
  streak_weeks integer not null default 0,
  weekly_target integer not null default 3,
  pending_target_change integer,
  show_progression boolean not null default true,
  progression_enabled boolean not null default false,
  unlocked_themes jsonb not null default '["pearl"]',
  starter_theme text,
  streak_history jsonb not null default '[]',
  xp_per_set jsonb not null default '{}',
  bodyweight_xp_dates jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

alter table user_progression enable row level security;

create policy "Users can view own progression"
  on user_progression for select using (auth.uid() = user_id);
create policy "Users can insert own progression"
  on user_progression for insert with check (auth.uid() = user_id);
create policy "Users can update own progression"
  on user_progression for update using (auth.uid() = user_id);

-- 2. xp_events table (per-set XP log for analytics)
create table xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  set_id text not null,
  exercise_id text,
  set_date timestamptz,
  logged_at timestamptz not null default now(),
  base_xp numeric not null,
  streak_multiplier numeric not null default 1,
  final_xp numeric not null,
  is_pr boolean not null default false,
  is_tie boolean not null default false,
  is_rep_pr boolean not null default false,
  zone text not null
);

create index idx_xp_events_user_id on xp_events(user_id);
create index idx_xp_events_set_id on xp_events(set_id);
create unique index idx_xp_events_user_set on xp_events(user_id, set_id);

alter table xp_events enable row level security;

create policy "Users can view own xp events"
  on xp_events for select using (auth.uid() = user_id);
create policy "Users can insert own xp events"
  on xp_events for insert with check (auth.uid() = user_id);
create policy "Users can upsert own xp events"
  on xp_events for update using (auth.uid() = user_id);

-- 3. progression_snapshots table (weekly snapshots for threshold tuning)
create table progression_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  total_xp numeric not null,
  week_xp numeric not null default 0,
  streak_weeks integer not null default 0,
  training_days integer not null default 0,
  weekly_target integer not null default 3,
  themes_unlocked integer not null default 1,
  created_at timestamptz not null default now()
);

create index idx_progression_snapshots_user_id on progression_snapshots(user_id);
create unique index idx_progression_snapshots_user_week on progression_snapshots(user_id, week_start);

alter table progression_snapshots enable row level security;

create policy "Users can view own snapshots"
  on progression_snapshots for select using (auth.uid() = user_id);
create policy "Users can insert own snapshots"
  on progression_snapshots for insert with check (auth.uid() = user_id);
create policy "Users can upsert own snapshots"
  on progression_snapshots for update using (auth.uid() = user_id);
