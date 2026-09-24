-- Cross-device email confirmation handoff
-- Run this in Supabase SQL Editor. This lets a waiting browser learn that
-- email confirmation completed on another device without exposing sessions.

create extension if not exists pgcrypto;

create table if not exists public.email_confirmation_handoffs (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  email text not null,
  user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'consumed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  confirmed_at timestamptz
);

alter table public.email_confirmation_handoffs enable row level security;

revoke all on public.email_confirmation_handoffs from anon, authenticated;

create or replace function public.create_email_confirmation_handoff(p_token text, p_email text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if length(coalesce(p_token, '')) < 32 or length(coalesce(p_email, '')) > 320 then
    return false;
  end if;
  delete from public.email_confirmation_handoffs where expires_at < now();
  insert into public.email_confirmation_handoffs (token_hash, email)
  values (encode(extensions.digest(p_token, 'sha256'), 'hex'), lower(trim(p_email)))
  on conflict (token_hash) do update
    set email = excluded.email, status = 'pending', user_id = null,
        confirmed_at = null, created_at = now(), expires_at = now() + interval '15 minutes';
  return true;
end;
$$;

create or replace function public.complete_email_confirmation_handoff(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.email_confirmation_handoffs
     set status = 'confirmed', user_id = auth.uid(), confirmed_at = now()
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and status = 'pending' and expires_at > now() and auth.uid() is not null;
  return found;
end;
$$;

create or replace function public.get_email_confirmation_handoff(p_token text)
returns table(status text, email text)
language sql
security definer
set search_path = public, extensions
as $$
  select h.status, h.email
    from public.email_confirmation_handoffs h
   where h.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and h.expires_at > now()
   limit 1;
$$;

revoke all on function public.create_email_confirmation_handoff(text, text) from public;
revoke all on function public.complete_email_confirmation_handoff(text) from public;
revoke all on function public.get_email_confirmation_handoff(text) from public;
grant execute on function public.create_email_confirmation_handoff(text, text) to anon, authenticated;
grant execute on function public.complete_email_confirmation_handoff(text) to authenticated;
grant execute on function public.get_email_confirmation_handoff(text) to anon, authenticated;

-- Optional cleanup. Run on a schedule if pg_cron is enabled.
-- delete from public.email_confirmation_handoffs where expires_at < now();
