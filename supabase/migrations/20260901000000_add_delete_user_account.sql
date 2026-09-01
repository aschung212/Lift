-- delete_user_account — the missing half of "Delete Account" (#1299).
--
-- deleteAccount() in useAuth.ts removed every application row and then signed
-- out, leaving the `auth.users` row itself untouched: the user's email address,
-- their OAuth identity linkage, created_at and last_sign_in_at survived
-- indefinitely, with no remaining in-app way to remove them (they are signed
-- out, and signing back in lands them in an empty account — which reads as
-- "the deletion didn't work"). Four of the five strings on that screen promise
-- account deletion; only one paragraph scoped it to data.
--
-- The browser client holds the ANON key, which cannot reach `auth.admin`, and
-- `auth.users` is not writable by `authenticated` — so, exactly as with the
-- coach tables in 20260627000000, a SECURITY DEFINER function is the only path
-- the client has. Same shape as delete_coach_data(): derives the user from
-- auth.uid() internally (never a client-supplied id), SET search_path = '' so
-- every reference is schema-qualified and no search_path injection can redirect
-- them, EXECUTE revoked from public/anon and granted to authenticated only.
--
-- Deleting the auth user CASCADES through every `user_id ... references
-- auth.users(id) on delete cascade` FK, so it is destructive and unrecoverable.
-- deleteAccount() therefore calls this LAST — after the per-table deletes have
-- been confirmed clean — so a failure anywhere earlier aborts while the account
-- still exists, rather than after it has been destroyed.
create or replace function delete_user_account()
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
  delete from auth.users where id = v_uid;
end;
$$;

-- Lock down EXECUTE: revoke the PUBLIC/anon defaults, grant to authenticated
-- only. A signed-out visitor must never be able to invoke this, and even for a
-- signed-in one it can only ever delete their OWN row (auth.uid()).
revoke all on function delete_user_account() from public, anon;
grant execute on function delete_user_account() to authenticated;
