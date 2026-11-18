-- Full Speed AMS — access helpers, triggers and row level security

-- ───────── Access helpers ─────────
create or replace function public.my_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.my_role() in ('admin', 'team_leader'), false)
$$;

-- Admin sees everyone, a team leader sees their team, an agent sees themself.
create or replace function public.can_see_agent(p_agent uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_agent = auth.uid()
    or exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and me.is_active
        and (
          me.role = 'admin'
          or (
            me.role = 'team_leader'
            and me.team_id is not null
            and me.team_id = (select team_id from public.profiles where id = p_agent)
          )
        )
    )
$$;

revoke execute on function public.my_role, public.is_admin, public.is_staff, public.can_see_agent(uuid) from anon, public;
grant execute on function public.my_role, public.is_admin, public.is_staff, public.can_see_agent(uuid) to authenticated;

-- ───────── New auth user → profile ─────────
-- Every account starts as an agent; admins promote via the profiles table
-- (Auth writes app_metadata after the insert, so it can't be read here).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────── Guards: agents may only change their own working fields ─────────
create or replace function public.guard_lead_update()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.updated_at := now();
  if new.status = 'hired' and old.status is distinct from 'hired' then
    new.hired_at := now();
  elsif new.status <> 'hired' then
    new.hired_at := null;
  end if;

  if not public.is_staff() then
    if new.agent_id is distinct from old.agent_id
       or new.company_id is distinct from old.company_id
       or new.source is distinct from old.source
       or new.external_id is distinct from old.external_id
       or new.created_by is distinct from old.created_by then
      raise exception 'Agents cannot reassign leads';
    end if;
  end if;
  return new;
end;
$$;

create trigger leads_guard before update on public.leads
  for each row execute function public.guard_lead_update();

create or replace function public.log_lead_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lead_activities (lead_id, actor_id, to_status, note)
    values (new.id, auth.uid(), new.status, 'created via ' || new.source);
  elsif new.status is distinct from old.status then
    insert into public.lead_activities (lead_id, actor_id, from_status, to_status)
    values (new.id, auth.uid(), old.status, new.status);
  end if;
  return new;
end;
$$;

create trigger leads_log after insert or update of status on public.leads
  for each row execute function public.log_lead_status();

create or replace function public.guard_task_update()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.status = 'done' and old.status <> 'done' then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;

  if not public.is_staff() then
    if (to_jsonb(new) - 'status' - 'completed_at') <> (to_jsonb(old) - 'status' - 'completed_at') then
      raise exception 'Agents can only change task status';
    end if;
  end if;
  return new;
end;
$$;

create trigger tasks_guard before update on public.tasks
  for each row execute function public.guard_task_update();

-- ───────── Notification fan-out ─────────
create or replace function public.notify_announcement()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, company_id, type, title, body, link)
  select ac.agent_id, new.company_id, new.type,
         c.name || ' — ' || new.title,
         concat_ws(' · ', new.body,
                   case when new.amount is not null then new.amount::text || ' ج.م' end),
         '/agent/notifications'
  from public.agent_companies ac
  join public.companies c on c.id = ac.company_id
  where ac.company_id = new.company_id;
  return new;
end;
$$;

create trigger announcements_notify after insert on public.company_announcements
  for each row execute function public.notify_announcement();

create or replace function public.notify_task()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, company_id, type, title, body, link)
  values (new.agent_id, new.company_id, 'task', 'تاسك جديد: ' || new.title, new.description, '/agent/tasks');
  return new;
end;
$$;

create trigger tasks_notify after insert on public.tasks
  for each row execute function public.notify_task();

create or replace function public.notify_assignment()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, company_id, type, title, link)
  select new.agent_id, new.company_id, 'assignment', 'تم تعيينك على شركة ' || c.name, '/agent'
  from public.companies c where c.id = new.company_id;
  return new;
end;
$$;

create trigger assignments_notify after insert on public.agent_companies
  for each row execute function public.notify_assignment();

create or replace function public.notify_lead_assigned()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.agent_id is not null
     and (tg_op = 'INSERT' or new.agent_id is distinct from old.agent_id)
     and new.agent_id is distinct from auth.uid() then
    insert into public.notifications (user_id, company_id, type, title, body, link)
    values (new.agent_id, new.company_id, 'lead', 'ليد جديد: ' || new.full_name, new.phone, '/agent/leads');
  end if;
  return new;
end;
$$;

create trigger leads_notify after insert or update of agent_id on public.leads
  for each row execute function public.notify_lead_assigned();

-- ───────── CRM intake: pick the assigned agent with the fewest leads today ─────────
create or replace function public.pick_agent_for_company(p_company uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select ac.agent_id
  from public.agent_companies ac
  join public.profiles p on p.id = ac.agent_id and p.is_active and p.role = 'agent'
  left join public.leads l
    on l.agent_id = ac.agent_id
   and l.created_at >= (date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo')
  where ac.company_id = p_company
  group by ac.agent_id
  order by count(l.id), random()
  limit 1
$$;

revoke execute on function public.pick_agent_for_company(uuid) from anon, authenticated, public;

-- ───────── Performance report (respects RLS of the caller) ─────────
create or replace function public.performance_report(p_from date, p_to date, p_agent uuid default null)
returns table (
  day date, agent_id uuid, company_id uuid,
  leads_count bigint, hired_count bigint,
  target_leads integer, target_hired integer
)
language sql stable security invoker set search_path = public
as $$
  with ev as (
    select (created_at at time zone 'Africa/Cairo')::date as d, agent_id, company_id, 1 as l, 0 as h
    from public.leads where agent_id is not null and (p_agent is null or agent_id = p_agent)
    union all
    select (hired_at at time zone 'Africa/Cairo')::date, agent_id, company_id, 0, 1
    from public.leads where hired_at is not null and agent_id is not null and (p_agent is null or agent_id = p_agent)
  ), agg as (
    select d, agent_id, company_id, sum(l)::bigint as lc, sum(h)::bigint as hc
    from ev where d between p_from and p_to
    group by 1, 2, 3
  ), t as (
    select * from public.daily_targets
    where date between p_from and p_to and (p_agent is null or agent_id = p_agent)
  )
  select coalesce(agg.d, t.date), coalesce(agg.agent_id, t.agent_id), coalesce(agg.company_id, t.company_id),
         coalesce(agg.lc, 0), coalesce(agg.hc, 0),
         coalesce(t.target_leads, 0), coalesce(t.target_hired, 0)
  from agg
  full join t on t.date = agg.d and t.agent_id = agg.agent_id and t.company_id = agg.company_id
$$;

-- ───────── Row level security ─────────
alter table public.governorates enable row level security;
alter table public.regions enable row level security;
alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_governorates enable row level security;
alter table public.company_announcements enable row level security;
alter table public.agent_companies enable row level security;
alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;
alter table public.tasks enable row level security;
alter table public.daily_targets enable row level security;
alter table public.notifications enable row level security;

-- Reference data: readable by any signed-in user, written by admins
create policy "read geo" on public.governorates for select to authenticated using (true);
create policy "admin geo" on public.governorates for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read regions" on public.regions for select to authenticated using (true);
create policy "admin regions" on public.regions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read companies" on public.companies for select to authenticated using (true);
create policy "admin companies" on public.companies for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read company geo" on public.company_governorates for select to authenticated using (true);
create policy "admin company geo" on public.company_governorates for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read teams" on public.teams for select to authenticated using (true);
create policy "admin teams" on public.teams for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Announcements: staff see all; agents see those of their companies
create policy "read announcements" on public.company_announcements for select to authenticated
  using (public.is_staff() or exists (
    select 1 from public.agent_companies ac where ac.agent_id = auth.uid() and ac.company_id = company_announcements.company_id));
create policy "staff announcements" on public.company_announcements for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Profiles
create policy "read profiles" on public.profiles for select to authenticated using (public.can_see_agent(id));
create policy "admin profiles" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Assignments
create policy "read assignments" on public.agent_companies for select to authenticated using (public.can_see_agent(agent_id));
create policy "staff assign" on public.agent_companies for insert to authenticated
  with check (public.is_staff() and public.can_see_agent(agent_id));
create policy "staff unassign" on public.agent_companies for delete to authenticated
  using (public.is_staff() and public.can_see_agent(agent_id));

-- Leads
create policy "read leads" on public.leads for select to authenticated
  using (public.can_see_agent(agent_id) or (agent_id is null and public.is_staff()));
create policy "insert leads" on public.leads for insert to authenticated
  with check (
    (public.is_staff() and (agent_id is null or public.can_see_agent(agent_id)))
    or (
      agent_id = auth.uid()
      and exists (select 1 from public.agent_companies ac where ac.agent_id = auth.uid() and ac.company_id = leads.company_id)
    )
  );
create policy "update leads" on public.leads for update to authenticated
  using (public.can_see_agent(agent_id) or (agent_id is null and public.is_staff()))
  with check (public.can_see_agent(agent_id) or (agent_id is null and public.is_staff()));
create policy "admin delete leads" on public.leads for delete to authenticated using (public.is_admin());

create policy "read lead activity" on public.lead_activities for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_activities.lead_id
                 and (public.can_see_agent(l.agent_id) or (l.agent_id is null and public.is_staff()))));

-- Tasks
create policy "read tasks" on public.tasks for select to authenticated using (public.can_see_agent(agent_id));
create policy "staff create tasks" on public.tasks for insert to authenticated
  with check (public.is_staff() and public.can_see_agent(agent_id));
create policy "update tasks" on public.tasks for update to authenticated
  using (public.can_see_agent(agent_id)) with check (public.can_see_agent(agent_id));
create policy "staff delete tasks" on public.tasks for delete to authenticated
  using (public.is_staff() and public.can_see_agent(agent_id));

-- Targets
create policy "read targets" on public.daily_targets for select to authenticated using (public.can_see_agent(agent_id));
create policy "staff targets" on public.daily_targets for all to authenticated
  using (public.is_staff() and public.can_see_agent(agent_id))
  with check (public.is_staff() and public.can_see_agent(agent_id));

-- Notifications: each user reads / marks their own; staff can send to people they manage
create policy "read own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "mark own notifications" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "staff send notifications" on public.notifications for insert to authenticated
  with check (public.is_staff() and public.can_see_agent(user_id));

-- Realtime for in-app notifications
alter publication supabase_realtime add table public.notifications;
