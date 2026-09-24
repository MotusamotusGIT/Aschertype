-- ============================================================================
-- Cross-device email confirmation handoff (v4)
-- ----------------------------------------------------------------------------
-- Idempotent: safe to re-run. Drops the functions first so signature
-- changes don't abort the script, then recreates everything.
--
-- v4 adds a session-transfer variant: the phone that completes the
-- confirmation writes its access_token + refresh_token into the handoff
-- row, and the waiting PC adopts that session directly via
-- supabase.auth.setSession(). No password grant, no captcha check, no
-- "email not confirmed" race. Tokens are wiped as soon as the PC reads
-- them (status -> 'consumed').
-- ============================================================================

drop function if exists public.create_email_confirmation_handoff(text, text);
drop function if exists public.complete_email_confirmation_handoff(text);
drop function if exists public.complete_email_confirmation_handoff_with_session(text, text, text);
drop function if exists public.get_email_confirmation_handoff(text);
drop function if exists public.consume_email_confirmation_handoff(text);

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.email_confirmation_handoffs (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text unique not null,
  email         text not null,
  user_id       uuid references auth.users(id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'confirmed', 'consumed')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '30 minutes'),
  confirmed_at  timestamptz
);

-- v4 columns — added non-destructively so re-running on an old table works.
alter table public.email_confirmation_handoffs
  add column if not exists access_token  text,
  add column if not exists refresh_token text;

create index if not exists email_confirmation_handoffs_token_hash_idx
  on public.email_confirmation_handoffs (token_hash);

alter table public.email_confirmation_handoffs enable row level security;
revoke all on public.email_confirmation_handoffs from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- create_email_confirmation_handoff
-- ---------------------------------------------------------------------------
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
  v_hash  text;
  v_email text;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 512 then
    return false;
  end if;
  if p_email is null or length(trim(p_email)) = 0 or length(p_email) > 320 then
    return false;
  end if;

  v_hash  := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_email := lower(trim(p_email));

  delete from public.email_confirmation_handoffs where expires_at < now();

  insert into public.email_confirmation_handoffs (token_hash, email)
  values (v_hash, v_email)
  on conflict (token_hash) do update
    set email          = excluded.email,
        status         = 'pending',
        user_id        = null,
        confirmed_at   = null,
        access_token   = null,
        refresh_token  = null,
        created_at     = now(),
        expires_at     = now() + interval '30 minutes';

  return true;
exception
  when others then return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_email_confirmation_handoff  (legacy — no session transfer)
-- Kept so an un-updated client still works. Marks the row confirmed
-- without storing tokens.
-- ---------------------------------------------------------------------------
create or replace function public.complete_email_confirmation_handoff(
  p_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash    text;
  v_uid     uuid;
  v_updated integer;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 512 then
    return false;
  end if;

  v_uid := auth.uid();
  if v_uid is null then return false; end if;

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
  when others then return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_email_confirmation_handoff_with_session
-- The phone calls this after setSession() succeeds. Stores the tokens so
-- the waiting PC can adopt the same session without a password grant.
-- ---------------------------------------------------------------------------
create or replace function public.complete_email_confirmation_handoff_with_session(
  p_token         text,
  p_access_token  text,
  p_refresh_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash    text;
  v_uid     uuid;
  v_updated integer;
begin
  if p_token         is null or length(p_token)         < 32 then return false; end if;
  if p_access_token  is null or length(p_access_token)  < 16 then return false; end if;
  if p_refresh_token is null or length(p_refresh_token) < 16 then return false; end if;

  v_uid := auth.uid();
  if v_uid is null then return false; end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  update public.email_confirmation_handoffs
     set status        = 'confirmed',
         user_id       = v_uid,
         confirmed_at  = now(),
         access_token  = p_access_token,
         refresh_token = p_refresh_token
   where token_hash = v_hash
     and status     = 'pending'
     and expires_at > now();

  get diagnostics v_updated = row_count;
  return v_updated > 0;
exception
  when others then return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_email_confirmation_handoff
-- Returns the token payload so the PC can adopt the session.
-- ---------------------------------------------------------------------------
create or replace function public.get_email_confirmation_handoff(
  p_token text
)
returns table(
  status        text,
  email         text,
  created_at    timestamptz,
  access_token  text,
  refresh_token text
)
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select h.status, h.email, h.created_at, h.access_token, h.refresh_token
    from public.email_confirmation_handoffs h
   where h.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and h.expires_at > now()
   order by h.created_at desc
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- consume_email_confirmation_handoff
-- PC calls this once it has adopted the session, so the tokens are wiped
-- immediately and can't be replayed.
-- ---------------------------------------------------------------------------
create or replace function public.consume_email_confirmation_handoff(
  p_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_token is null or length(p_token) < 32 then return false; end if;

  update public.email_confirmation_handoffs
     set status        = 'consumed',
         access_token  = null,
         refresh_token = null
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and status     = 'confirmed';

  return found;
exception
  when others then return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------
revoke all on function public.create_email_confirmation_handoff(text, text)                 from public, anon, authenticated;
revoke all on function public.complete_email_confirmation_handoff(text)                     from public, anon, authenticated;
revoke all on function public.complete_email_confirmation_handoff_with_session(text, text, text) from public, anon, authenticated;
revoke all on function public.get_email_confirmation_handoff(text)                          from public, anon, authenticated;
revoke all on function public.consume_email_confirmation_handoff(text)                      from public, anon, authenticated;

grant execute on function public.create_email_confirmation_handoff(text, text)                 to anon, authenticated;
grant execute on function public.complete_email_confirmation_handoff(text)                     to authenticated;
grant execute on function public.complete_email_confirmation_handoff_with_session(text, text, text) to authenticated;
grant execute on function public.get_email_confirmation_handoff(text)                          to anon, authenticated;
grant execute on function public.consume_email_confirmation_handoff(text)                      to authenticated;