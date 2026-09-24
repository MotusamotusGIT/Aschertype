-- ============================================================================
-- Cross-device email confirmation handoff (v2)
-- ----------------------------------------------------------------------------
-- Lets a waiting browser tab learn that email confirmation completed on
-- another device, WITHOUT transferring a session or leaking credentials.
--
-- Flow:
--   1. Register tab (desktop): calls create_email_confirmation_handoff(token, email)
--      → row (token_hash, email, status='pending')
--   2. Confirm page (phone): after the Supabase SDK establishes the session
--      from the URL hash, calls complete_email_confirmation_handoff(token)
--      → row flips to status='confirmed', user_id=auth.uid()
--   3. Register tab (desktop): polls get_email_confirmation_handoff(token)
--      every 2.5s → sees status='confirmed' → signs in with the password
--      it kept in memory.
-- ============================================================================

-- 1. Ensure pgcrypto lives in the `extensions` schema. On Supabase it
--    already does; on plain Postgres this moves it there.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- 2. Table -------------------------------------------------------------------
create table if not exists public.email_confirmation_handoffs (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text unique not null,
  email        text not null,
  user_id      uuid references auth.users(id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'confirmed', 'consumed')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '30 minutes'),
  confirmed_at timestamptz
);

-- Useful index for the poller's lookup pattern.
create index if not exists email_confirmation_handoffs_token_hash_idx
  on public.email_confirmation_handoffs (token_hash);

-- 3. Lock the table down. Only the SECURITY DEFINER functions below may
--    touch it — anon and authenticated have zero direct access.
alter table public.email_confirmation_handoffs enable row level security;
revoke all on public.email_confirmation_handoffs from anon, authenticated, public;

-- 4. create_email_confirmation_handoff --------------------------------------
-- Called by the register tab. Upserts on token_hash so a re-register with
-- the same email simply refreshes the existing pending row.
create or replace function public.create_email_confirmation_handoff(
  p_token text,
  p_email text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash text;
  v_email text;
begin
  -- Basic input sanity.
  if p_token is null or length(p_token) < 32 or length(p_token) > 512 then
    return false;
  end if;
  if p_email is null or length(trim(p_email)) = 0 or length(p_email) > 320 then
    return false;
  end if;

  v_hash  := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_email := lower(trim(p_email));

  -- Opportunistic cleanup — cheap, keeps the table tiny.
  delete from public.email_confirmation_handoffs where expires_at < now();

  insert into public.email_confirmation_handoffs (token_hash, email)
  values (v_hash, v_email)
  on conflict (token_hash) do update
    set email        = excluded.email,
        status       = 'pending',
        user_id      = null,
        confirmed_at = null,
        created_at   = now(),
        expires_at   = now() + interval '30 minutes';

  return true;
exception
  when others then
    -- Never leak a Postgres error to the client; the caller treats false
    -- as "handoff unavailable" and falls back to the manual flow.
    return false;
end;
$$;

-- 5. complete_email_confirmation_handoff ------------------------------------
-- Called by the confirm page AFTER the Supabase SDK has established a
-- session from the URL hash. `auth.uid()` is the just-confirmed user.
create or replace function public.complete_email_confirmation_handoff(
  p_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash   text;
  v_uid    uuid;
  v_updated integer;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 512 then
    return false;
  end if;

  v_uid := auth.uid();
  if v_uid is null then
    -- The confirm page called us before the SDK had set the session.
    -- The caller retries; we do NOT error so the phone doesn't show a
    -- scary message.
    return false;
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  update public.email_confirmation_handoffs
     set status       = 'confirmed',
         user_id      = v_uid,
         confirmed_at = now()
   where token_hash = v_hash
     and status     = 'pending'
     and expires_at > now();

  get diagnostics v_updated = row_count;
  return v_updated > 0;
exception
  when others then
    return false;
end;
$$;

-- 6. get_email_confirmation_handoff -----------------------------------------
-- Called by the register tab's poller. Returns the LATEST matching row
-- for this token (there should only ever be one, but ordering protects
-- against the rare re-register race).
create or replace function public.get_email_confirmation_handoff(
  p_token text
)
returns table(status text, email text, created_at timestamptz)
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select h.status, h.email, h.created_at
    from public.email_confirmation_handoffs h
   where h.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and h.expires_at > now()
   order by h.created_at desc
   limit 1;
$$;

-- 7. Grants ------------------------------------------------------------------
-- create_*: anyone (anon or signed-in) can register a handoff.
-- complete_*: MUST be authenticated — auth.uid() is required, and we
--             rely on that to stamp user_id.
-- get_*: anyone with the token can read status. The token is a
--        128-char random string; possessing it is proof enough.
revoke all on function public.create_email_confirmation_handoff(text, text) from public, anon, authenticated;
revoke all on function public.complete_email_confirmation_handoff(text)       from public, anon, authenticated;
revoke all on function public.get_email_confirmation_handoff(text)            from public, anon, authenticated;

grant execute on function public.create_email_confirmation_handoff(text, text) to anon, authenticated;
grant execute on function public.complete_email_confirmation_handoff(text)       to authenticated;
grant execute on function public.get_email_confirmation_handoff(text)            to anon, authenticated;

-- 8. Optional: scheduled cleanup --------------------------------------------
-- If pg_cron is enabled, uncomment to purge expired rows nightly.
-- select cron.schedule(
--   'purge-email-confirmation-handoffs',
--   '0 3 * * *',
--   $$delete from public.email_confirmation_handoffs where expires_at < now()$$
-- );