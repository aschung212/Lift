-- Add delete RLS policies to tables that were missing them
-- Required for account deletion flow (LIFT-185)

create policy "Users can delete own preferences"
  on user_preferences for delete using (auth.uid() = user_id);

create policy "Users can delete own progression"
  on user_progression for delete using (auth.uid() = user_id);

create policy "Users can delete own xp events"
  on xp_events for delete using (auth.uid() = user_id);

create policy "Users can delete own snapshots"
  on progression_snapshots for delete using (auth.uid() = user_id);
