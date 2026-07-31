-- LIFT-850 — early-warning Slack alert for the AI Coach daily spend ceiling.
--
-- coach_global_spend already auto-pauses the feature at 100% of the ceiling
-- (claim_coach_request returns reason 'global' -> 503). This adds the EARLY
-- WARNING: record_coach_usage, which trues the ledger up to actual spend, now
-- also reports the FIRST time today's cumulative spend crosses the alert
-- threshold (50% of the ceiling) so api/coach.ts can fire a one-shot Slack alert.
--
-- The once-per-day guard (half_alert_sent) MUST live here: api/coach.ts is a
-- stateless serverless function and would otherwise re-alert on every request
-- above the threshold. This is an additive migration; do not edit the original
-- 20260627000000 file (already applied). See docs/ai-coach.md.

alter table coach_global_spend
  add column if not exists half_alert_sent boolean not null default false;

-- Return type changes (void -> table), so the old function must be dropped first.
drop function if exists record_coach_usage(integer, integer, integer, integer, text, boolean);

create or replace function record_coach_usage(
  p_pre_charge_cents integer,
  p_actual_cost_cents integer,
  p_input_tokens integer,
  p_output_tokens integer,
  p_model text,
  p_billed boolean,
  p_daily_ceiling_cents integer
)
returns table (crossed_alert boolean, spent_cents integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_spent integer;
  v_crossed boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  update public.coach_global_spend
    set spent_cents = greatest(
          public.coach_global_spend.spent_cents - p_pre_charge_cents
          + case when p_billed then p_actual_cost_cents else 0 end, 0),
        updated_at = now()
    where day = current_date
    returning public.coach_global_spend.spent_cents into v_spent;

  if p_billed then
    insert into public.coach_usage_log (user_id, model, input_tokens, output_tokens, est_cost_cents)
      values (v_uid, p_model, p_input_tokens, p_output_tokens, p_actual_cost_cents);
  else
    update public.coach_usage
      set request_count = greatest(public.coach_usage.request_count - 1, 0),
          updated_at = now()
      where user_id = v_uid;
  end if;

  -- One-shot alert: a SINGLE atomic UPDATE both tests the threshold and flips the
  -- guard, so two concurrent requests that both cross can't both alert — the row
  -- lock lets exactly one win the `half_alert_sent = false` predicate. FOUND is
  -- true only for that winning request (day is the PK, so 0-or-1 rows).
  if p_daily_ceiling_cents > 0 then
    update public.coach_global_spend
      set half_alert_sent = true, updated_at = now()
      where day = current_date
        and half_alert_sent = false
        and public.coach_global_spend.spent_cents >= p_daily_ceiling_cents / 2;
    v_crossed := found;
  end if;

  return query select v_crossed, coalesce(v_spent, 0);
end;
$$;

-- Re-lock EXECUTE for the new signature: revoke the PUBLIC/anon defaults, grant to authenticated.
revoke all on function record_coach_usage(integer, integer, integer, integer, text, boolean, integer) from public, anon;
grant execute on function record_coach_usage(integer, integer, integer, integer, text, boolean, integer) to authenticated;
