-- AI Coach "Weekly Review" — server-authoritative quota, spend ceiling, consent, audit.
--
-- The client-side counter is cosmetic; THIS is the real cap. Every write here is
-- guarded so a user cannot reset their own quota:
--   * coach_usage / coach_global_spend / coach_usage_log have NO client write policy.
--   * They are mutated only through SECURITY DEFINER functions that derive the user
--     from auth.uid() internally (never a client-supplied id) and SET search_path = ''.
--   * EXECUTE on those functions is revoked from public/anon and granted to authenticated.
-- See docs/ai-coach.md and api/coach.ts.

-- 1. Per-user quota (rolling 7-day window). limit_override is the premium seam.
create table coach_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  period_start timestamptz not null default now(),
  request_count integer not null default 0,
  limit_override integer,
  updated_at timestamptz not null default now()
);

alter table coach_usage enable row level security;

-- Users may READ their own counter (for an honest "N left" hint); they may NOT write it.
create policy "Users can view own coach usage"
  on coach_usage for select using (auth.uid() = user_id);

-- 2. Global daily spend ceiling — the true bound against multi-account farming.
create table coach_global_spend (
  day date primary key,
  spent_cents integer not null default 0,
  updated_at timestamptz not null default now()
);

-- RLS on with NO policies: clients cannot read or write; only SECURITY DEFINER touches it.
alter table coach_global_spend enable row level security;

-- 3. Append-only audit ledger for forensics + dashboard reconciliation.
--    Stores token counts and cost ONLY — never prompt bodies or insight text.
create table coach_usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  model text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  est_cost_cents integer not null,
  created_at timestamptz not null default now()
);

create index idx_coach_usage_log_user_id on coach_usage_log(user_id);
create index idx_coach_usage_log_created_at on coach_usage_log(created_at);

alter table coach_usage_log enable row level security;

create policy "Users can view own coach usage log"
  on coach_usage_log for select using (auth.uid() = user_id);

-- 4. Versioned consent — health/fitness data leaves the device, so consent is
--    recorded server-side and versioned (a stale client blob must not re-enable egress).
create table coach_consent (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version integer not null,
  accepted_at timestamptz not null default now()
);

alter table coach_consent enable row level security;

create policy "Users can view own coach consent"
  on coach_consent for select using (auth.uid() = user_id);

-- 5. claim_coach_request — ONE atomic call: global pre-charge + per-user quota.
--    Returns the decision; the function refunds the global pre-charge if the
--    per-user gate then rejects, so the two ledgers never drift.
create or replace function claim_coach_request(
  p_max_cost_cents integer,
  p_daily_ceiling_cents integer,
  p_default_limit integer
)
returns table (allowed boolean, reason text, request_count integer, reset_at timestamptz, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_window interval := interval '7 days';
  v_limit integer;
  v_global integer;
  v_count integer;
  v_period_start timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Global pre-charge (max possible cost) first — cheap brake.
  insert into public.coach_global_spend (day, spent_cents)
    values (current_date, p_max_cost_cents)
    on conflict (day) do update
      set spent_cents = public.coach_global_spend.spent_cents + p_max_cost_cents,
          updated_at = now()
    returning spent_cents into v_global;

  if v_global > p_daily_ceiling_cents then
    update public.coach_global_spend
      set spent_cents = public.coach_global_spend.spent_cents - p_max_cost_cents,
          updated_at = now()
      where day = current_date;
    return query select false, 'global'::text, 0, null::timestamptz, 0;
    return;
  end if;

  -- Per-user window reset + increment + cap check in ONE statement (race-safe).
  insert into public.coach_usage (user_id, period_start, request_count)
    values (v_uid, now(), 1)
    on conflict (user_id) do update
      set request_count = case
            when now() - public.coach_usage.period_start >= v_window then 1
            else public.coach_usage.request_count + 1 end,
          period_start = case
            when now() - public.coach_usage.period_start >= v_window then now()
            else public.coach_usage.period_start end,
          updated_at = now()
    returning request_count, period_start, limit_override
      into v_count, v_period_start, v_limit;

  v_limit := coalesce(v_limit, p_default_limit);

  if v_count > v_limit then
    -- Refund the global pre-charge; this request is not served.
    update public.coach_global_spend
      set spent_cents = public.coach_global_spend.spent_cents - p_max_cost_cents,
          updated_at = now()
      where day = current_date;
    return query select false, 'quota'::text, v_count, v_period_start + v_window, 0;
    return;
  end if;

  return query select true, null::text, v_count, v_period_start + v_window, greatest(v_limit - v_count, 0);
end;
$$;

-- 6. record_coach_usage — true up the global ledger to ACTUAL usage and audit.
--    On an unbilled failure (no usable output) it also refunds the per-user count.
create or replace function record_coach_usage(
  p_pre_charge_cents integer,
  p_actual_cost_cents integer,
  p_input_tokens integer,
  p_output_tokens integer,
  p_model text,
  p_billed boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  update public.coach_global_spend
    set spent_cents = greatest(
          public.coach_global_spend.spent_cents - p_pre_charge_cents
          + case when p_billed then p_actual_cost_cents else 0 end, 0),
        updated_at = now()
    where day = current_date;

  if p_billed then
    insert into public.coach_usage_log (user_id, model, input_tokens, output_tokens, est_cost_cents)
      values (v_uid, p_model, p_input_tokens, p_output_tokens, p_actual_cost_cents);
  else
    update public.coach_usage
      set request_count = greatest(public.coach_usage.request_count - 1, 0),
          updated_at = now()
      where user_id = v_uid;
  end if;
end;
$$;

-- 7. record_coach_consent — the only write path for consent (called by the future UI).
create or replace function record_coach_consent(p_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  insert into public.coach_consent (user_id, version, accepted_at)
    values (v_uid, p_version, now())
    on conflict (user_id) do update
      set version = excluded.version, accepted_at = now();
end;
$$;

-- 8. delete_coach_data — account-deletion path for the server-only tables.
--    (coach_usage has no client delete policy by design, so deletion must go
--    through here; deleteAccount() in useAuth.ts must call this and must assert
--    on the resolved {error}, not just a rejected promise — see docs/ai-coach.md.)
create or replace function delete_coach_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  delete from public.coach_usage_log where user_id = v_uid;
  delete from public.coach_usage where user_id = v_uid;
  delete from public.coach_consent where user_id = v_uid;
end;
$$;

-- 9. Lock down EXECUTE: revoke the PUBLIC/anon defaults, grant to authenticated only.
revoke all on function claim_coach_request(integer, integer, integer) from public, anon;
revoke all on function record_coach_usage(integer, integer, integer, integer, text, boolean) from public, anon;
revoke all on function record_coach_consent(integer) from public, anon;
revoke all on function delete_coach_data() from public, anon;

grant execute on function claim_coach_request(integer, integer, integer) to authenticated;
grant execute on function record_coach_usage(integer, integer, integer, integer, text, boolean) to authenticated;
grant execute on function record_coach_consent(integer) to authenticated;
grant execute on function delete_coach_data() to authenticated;
