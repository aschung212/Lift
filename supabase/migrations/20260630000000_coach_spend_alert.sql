-- AI Coach — daily spend early-warning alert (LIFT-850).
--
-- The hard backstops against runaway cost already exist: the per-day global ceiling
-- (claim_coach_request refuses to pre-charge past it) and the provider-side monthly
-- budget cap. This adds a single heads-up: when ACTUAL daily spend first crosses a
-- threshold (50% of the ceiling), the function fires one Slack alert for the day.
--
-- The crossing detection + once-per-day dedup must be atomic across concurrent
-- requests, so it lives in the true-up RPC (record_coach_usage) next to the spend
-- update — never in the stateless function. A new alert_sent flag on
-- coach_global_spend is the per-day latch; record_coach_usage now returns whether
-- THIS call flipped it, and the function only posts to Slack when it did.

-- 1. Per-day latch so the alert fires at most once per UTC day.
alter table coach_global_spend
  add column if not exists alert_sent boolean not null default false;

-- 2. Replace record_coach_usage: same true-up + audit + per-user refund behaviour,
--    plus a new p_alert_threshold_cents param and a boolean return that is true only
--    when this call moved actual spend from below the threshold to at/above it.
--    Signature changes (void -> boolean, +1 param), so drop the old one first.
drop function if exists record_coach_usage(integer, integer, integer, integer, text, boolean);

create or replace function record_coach_usage(
  p_pre_charge_cents integer,
  p_actual_cost_cents integer,
  p_input_tokens integer,
  p_output_tokens integer,
  p_model text,
  p_billed boolean,
  p_alert_threshold_cents integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_spent integer;
  v_already_alerted boolean;
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
    returning spent_cents, alert_sent into v_spent, v_already_alerted;

  if p_billed then
    insert into public.coach_usage_log (user_id, model, input_tokens, output_tokens, est_cost_cents)
      values (v_uid, p_model, p_input_tokens, p_output_tokens, p_actual_cost_cents);
  else
    update public.coach_usage
      set request_count = greatest(public.coach_usage.request_count - 1, 0),
          updated_at = now()
      where user_id = v_uid;
  end if;

  -- Early-warning latch: fire once per day when actual spend first crosses.
  -- coalesce(v_already_alerted, true): if the day row is somehow missing, treat as
  -- already alerted so we never alert without a spend record to anchor it.
  if p_alert_threshold_cents > 0
     and v_spent >= p_alert_threshold_cents
     and not coalesce(v_already_alerted, true) then
    update public.coach_global_spend
      set alert_sent = true, updated_at = now()
      where day = current_date;
    v_crossed := true;
  end if;

  return v_crossed;
end;
$$;

-- 3. Re-lock EXECUTE on the new signature (the dropped one's grants went with it).
revoke all on function record_coach_usage(integer, integer, integer, integer, text, boolean, integer) from public, anon;
grant execute on function record_coach_usage(integer, integer, integer, integer, text, boolean, integer) to authenticated;
