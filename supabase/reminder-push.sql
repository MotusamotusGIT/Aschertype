-- ============================================================================
-- Server-side reminder push (events + task reminders -> Android via FCM)
-- Idempotent. Run in the Supabase SQL editor.
-- Assumes: events(user_id, date, time, title), todos(user_id, text, done, due, reminder_time)
-- ============================================================================

create table if not exists public.device_push_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  token      text not null unique,
  platform   text not null default 'android',
  timezone   text not null default 'UTC',
  updated_at timestamptz not null default now()
);
create index if not exists device_push_tokens_user_idx on public.device_push_tokens (user_id);

create table if not exists public.reminder_pushes (
  token        text not null,
  reminder_key text not null,
  fire_at      timestamptz not null,
  sent_at      timestamptz not null default now(),
  primary key (token, reminder_key, fire_at)
);

-- No direct client access; everything goes through the functions below.
alter table public.device_push_tokens enable row level security;
alter table public.reminder_pushes    enable row level security;
revoke all on public.device_push_tokens from anon, authenticated, public;
revoke all on public.reminder_pushes    from anon, authenticated, public;

-- The signed-in user registers/refreshes THIS device. user_id always comes from
-- auth.uid(), so a token that moves to another account is re-owned, never shared.
create or replace function public.register_push_token(p_token text, p_timezone text default 'UTC')
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tz text := coalesce(nullif(trim(p_timezone), ''), 'UTC');
begin
  if auth.uid() is null then return false; end if;
  if p_token is null or length(p_token) < 20 or length(p_token) > 4096 then return false; end if;
  begin perform now() at time zone v_tz; exception when others then v_tz := 'UTC'; end;
  insert into public.device_push_tokens (user_id, token, timezone, updated_at)
  values (auth.uid(), p_token, v_tz, now())
  on conflict (token) do update
    set user_id = auth.uid(), timezone = excluded.timezone, updated_at = now();
  return true;
end $$;

create or replace function public.unregister_push_token(p_token text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return false; end if;
  delete from public.device_push_tokens where token = p_token and user_id = auth.uid();
  return found;
end $$;

-- Service role only: atomically claim reminders that are due and not yet sent.
-- Event/task times are stored as local wall-clock strings, so each one is
-- interpreted in the timezone of the device it is being sent to.
create or replace function public.claim_due_reminders()
returns table(token text, title text, body text, reminder_key text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.reminder_pushes where fire_at < now() - interval '2 days';

  return query
  with cand as (
    select d.token as tk, 'event-start:' || e.id::text as k, 'Starting now'::text as ttl, e.title::text as bdy,
           ((e.date::text || ' ' || e.time::text)::timestamp at time zone d.timezone) as fire_at
      from public.device_push_tokens d
      join public.events e on e.user_id = d.user_id
     where e.time is not null and e.time::text <> '' and e.date is not null
    union all
    select d.token, 'event-soon:' || e.id::text, 'Coming up in 5 minutes', e.title::text,
           ((e.date::text || ' ' || e.time::text)::timestamp at time zone d.timezone) - interval '5 minutes'
      from public.device_push_tokens d
      join public.events e on e.user_id = d.user_id
     where e.time is not null and e.time::text <> '' and e.date is not null
    union all
    select d.token, 'task:' || t.id::text, 'Task due today', t.text::text,
           ((t.due::text || ' ' || t.reminder_time::text)::timestamp at time zone d.timezone)
      from public.device_push_tokens d
      join public.todos t on t.user_id = d.user_id
     where coalesce(t.done, false) = false and t.due is not null and t.reminder_time is not null
  ),
  due as (
    select * from cand
     where fire_at <= now() and fire_at > now() - interval '10 minutes'
  ),
  claimed as (
    insert into public.reminder_pushes (token, reminder_key, fire_at)
    select tk, k, fire_at from due
    on conflict do nothing
    returning public.reminder_pushes.token as ctk, public.reminder_pushes.reminder_key as ck, public.reminder_pushes.fire_at as cf
  )
  select due.tk, due.ttl, due.bdy, due.k
    from due join claimed c on c.ctk = due.tk and c.ck = due.k and c.cf = due.fire_at;
end $$;

create or replace function public.delete_push_token_service(p_token text)
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from public.device_push_tokens where token = p_token;
$$;

revoke all on function public.register_push_token(text, text)   from public, anon, authenticated;
revoke all on function public.unregister_push_token(text)       from public, anon, authenticated;
revoke all on function public.claim_due_reminders()             from public, anon, authenticated;
revoke all on function public.delete_push_token_service(text)   from public, anon, authenticated;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text)     to authenticated;
grant execute on function public.claim_due_reminders()           to service_role;
grant execute on function public.delete_push_token_service(text) to service_role;

-- ---------------------------------------------------------------------------
-- Schedule (run once). Needs the pg_cron and pg_net extensions enabled, and a
-- vault secret named reminder_cron_secret that matches the CRON_SECRET function secret:
--   select vault.create_secret('<long-random-string>', 'reminder_cron_secret');
-- ---------------------------------------------------------------------------
-- select cron.schedule('send-reminders', '* * * * *', $$
--   select net.http_post(
--     url := 'https://tjjzeetbsxnkrgoiagbf.supabase.co/functions/v1/send-reminders',
--     headers := jsonb_build_object('Authorization',
--       'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret'))
--   );
-- $$);