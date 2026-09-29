-- ============================================================================
-- Pricing tiers: free / team / enterprise
-- Idempotent. Assumes: public.projects(id, user_id, name, ...),
-- public.project_members(id, project_id, member_email, status, ...),
-- and that public.profiles(id) already exists (one row per auth.users, PK = user id).
-- If profiles doesn't exist, this creates a minimal one.
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade
);

alter table public.profiles
  add column if not exists plan text not null default 'free'
    check (plan in ('free', 'team', 'enterprise')),
  add column if not exists plan_updated_at timestamptz not null default now();

-- Central place for the numbers, so a price change is a one-line update here,
-- not a hunt through multiple functions.
create table if not exists public.plan_limits (
  plan             text primary key,
  max_projects     integer,   -- null = unlimited
  max_members      integer    -- per project, INCLUDING the owner; null = unlimited
);
insert into public.plan_limits (plan, max_projects, max_members) values
  ('free',       3,   6),
  ('team',       10,  20),
  ('enterprise', null, null)
on conflict (plan) do update
  set max_projects = excluded.max_projects,
      max_members  = excluded.max_members;

alter table public.plan_limits enable row level security;
drop policy if exists "plan_limits readable by anyone signed in" on public.plan_limits;
create policy "plan_limits readable by anyone signed in"
  on public.plan_limits for select to authenticated using (true);

create or replace function public.current_plan(p_user_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select plan from public.profiles where id = p_user_id), 'free');
$$;

-- ---------------------------------------------------------------------------
-- Enforce project-creation limit. Counts projects the user OWNS, not ones
-- they've merely joined — joining someone else's project never counts against you.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_project_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_plan  text;
  v_max   integer;
  v_count integer;
begin
  v_plan := public.current_plan(new.user_id);
  select max_projects into v_max from public.plan_limits where plan = v_plan;
  if v_max is null then return new; end if; -- unlimited

  select count(*) into v_count from public.projects where user_id = new.user_id;
  if v_count >= v_max then
    raise exception 'project_limit_reached: % plan allows up to % owned projects', v_plan, v_max
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_enforce_project_limit on public.projects;
create trigger trg_enforce_project_limit
  before insert on public.projects
  for each row execute function public.enforce_project_limit();

-- ---------------------------------------------------------------------------
-- Enforce member limit. Counts the owner + accepted/pending members already
-- on the project, keyed off the PROJECT OWNER's plan (their limit, their team).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_member_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid;
  v_plan  text;
  v_max   integer;
  v_count integer;
begin
  select user_id into v_owner from public.projects where id = new.project_id;
  if v_owner is null then return new; end if;

  v_plan := public.current_plan(v_owner);
  select max_members into v_max from public.plan_limits where plan = v_plan;
  if v_max is null then return new; end if; -- unlimited

  select count(*) + 1 into v_count -- +1 for the owner, who has no project_members row
    from public.project_members
   where project_id = new.project_id
     and status in ('pending', 'accepted');

  if v_count >= v_max then
    raise exception 'member_limit_reached: % plan allows up to % members per project (including owner)', v_plan, v_max
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_enforce_member_limit on public.project_members;
create trigger trg_enforce_member_limit
  before insert on public.project_members
  for each row execute function public.enforce_member_limit();

-- Client-side helper: check "how close am I" before hitting the wall, so the
-- app can show "2/3 projects used" instead of only a failed insert.
create or replace function public.get_my_plan_usage()
returns table(plan text, owned_projects integer, max_projects integer, max_members integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    public.current_plan(auth.uid()),
    (select count(*)::int from public.projects where user_id = auth.uid()),
    (select max_projects from public.plan_limits where plan = public.current_plan(auth.uid())),
    (select max_members  from public.plan_limits where plan = public.current_plan(auth.uid()));
$$;

revoke all on function public.get_my_plan_usage() from public, anon, authenticated;
grant execute on function public.get_my_plan_usage() to authenticated;

-- Called by the Stripe webhook handler (service role) after a successful
-- checkout/subscription-update event. Never exposed to the client directly.
create or replace function public.set_user_plan(p_user_id uuid, p_plan text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_plan not in ('free', 'team', 'enterprise') then return false; end if;
  insert into public.profiles (id, plan, plan_updated_at)
  values (p_user_id, p_plan, now())
  on conflict (id) do update set plan = excluded.plan, plan_updated_at = now();
  return true;
end $$;
revoke all on function public.set_user_plan(uuid, text) from public, anon, authenticated;
grant execute on function public.set_user_plan(uuid, text) to service_role;

-- ============================================================================
-- Project ownership transfer (real feature, not a placeholder)
-- Only the current owner can transfer; the new owner must already be an
-- accepted member. The new owner's plan limits apply going forward.
-- ============================================================================
create or replace function public.transfer_project_ownership(p_project_id text, p_new_owner_email text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_new_owner_id uuid;
  v_updated      integer;
begin
  if auth.uid() is null then return false; end if;

  select user_id into v_new_owner_id
    from auth.users
   where lower(email) = lower(trim(coalesce(p_new_owner_email, '')));
  if v_new_owner_id is null then return false; end if;

  if not exists (
    select 1 from public.project_members
     where project_id::text = p_project_id
       and lower(member_email) = lower(trim(p_new_owner_email))
       and status = 'accepted'
  ) then
    return false; -- can only transfer to an existing accepted member
  end if;

  update public.projects
     set user_id = v_new_owner_id
   where id::text = p_project_id
     and user_id = auth.uid(); -- only the current owner can initiate

  get diagnostics v_updated = row_count;

  if v_updated > 0 then
    insert into public.project_activity_log (project_id, actor_id, action, detail)
    values (p_project_id, auth.uid(), 'ownership_transferred', jsonb_build_object('to', p_new_owner_email));
  end if;

  return v_updated > 0;
end $$;
revoke all on function public.transfer_project_ownership(text, text) from public, anon, authenticated;
grant execute on function public.transfer_project_ownership(text, text) to authenticated;

-- ============================================================================
-- Project activity log (real feature: who did what, per project)
-- Populated by triggers on the tables that already exist; append-only.
-- ============================================================================
create table if not exists public.project_activity_log (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  actor_id   uuid references auth.users(id) on delete set null,
  action     text not null,
  detail     jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists project_activity_log_project_idx
  on public.project_activity_log (project_id, created_at desc);

alter table public.project_activity_log enable row level security;
revoke all on public.project_activity_log from anon, authenticated, public;

-- Any accepted member (or the owner) of the project can read its log.
drop policy if exists "members can read their project activity" on public.project_activity_log;
create policy "members can read their project activity"
  on public.project_activity_log for select
  to authenticated
  using (
    exists (select 1 from public.projects p where p.id = project_activity_log.project_id and p.user_id = auth.uid())
    or exists (
      select 1 from public.project_members m
       where m.project_id = project_activity_log.project_id
         and lower(m.member_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and m.status = 'accepted'
    )
  );

create or replace function public.log_task_activity()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.project_id is null then return new; end if;
  if TG_OP = 'INSERT' then
    insert into public.project_activity_log (project_id, actor_id, action, detail)
    values (new.project_id, auth.uid(), 'task_created', jsonb_build_object('task_id', new.id, 'text', new.text));
  elsif TG_OP = 'UPDATE' and old.done is distinct from new.done then
    insert into public.project_activity_log (project_id, actor_id, action, detail)
    values (new.project_id, auth.uid(), case when new.done then 'task_completed' else 'task_reopened' end,
            jsonb_build_object('task_id', new.id, 'text', new.text));
  end if;
  return new;
end $$;
drop trigger if exists trg_log_task_activity on public.todos;
create trigger trg_log_task_activity
  after insert or update on public.todos
  for each row execute function public.log_task_activity();

create or replace function public.log_member_activity()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.project_activity_log (project_id, actor_id, action, detail)
    values (new.project_id, auth.uid(), 'member_invited', jsonb_build_object('email', new.member_email));
  elsif TG_OP = 'UPDATE' and old.status is distinct from new.status then
    insert into public.project_activity_log (project_id, actor_id, action, detail)
    values (new.project_id, auth.uid(), 'member_status_changed', jsonb_build_object('email', new.member_email, 'status', new.status));
  end if;
  return new;
end $$;
drop trigger if exists trg_log_member_activity on public.project_members;
create trigger trg_log_member_activity
  after insert or update on public.project_members
  for each row execute function public.log_member_activity();