-- 0054 · Distribute unassigned leads in one click, and the numbers the «التوزيع» page shows.
-- Additive: two new functions, and the per-lead "new lead" notification learns to stay quiet during a bulk hand-out
-- (each agent gets one summary notification instead of hundreds of pushes). Paste into the Supabase SQL editor; the app code ships after it.
--
-- distribution_board(): one row per active company — open leads with no agent, linked agents, and who they are.
-- distribute_unassigned(company, limit): hands a company's (or every company's) unassigned open leads to its linked
--   agents who receive leads, round-robin, the agent with the fewest open leads first. Admin and manager only.

create or replace function public.distribution_board()
returns table (company_id uuid, company text, logo_path text, unassigned bigint, agents jsonb)
language sql stable security definer set search_path = public
as $$
  select c.id, c.name, c.logo_path,
    (select count(*) from public.leads l
      where l.company_id = c.id and l.agent_id is null and l.status not in ('hired', 'rejected')),
    coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'receives', p.receives_leads) order by p.full_name)
              from public.agent_companies ac
              join public.profiles p on p.id = ac.agent_id and p.is_active and p.role = 'agent'
              where ac.company_id = c.id), '[]'::jsonb)
  from public.companies c
  where c.is_active and public.my_role() in ('admin', 'manager', 'team_leader')
  order by 4 desc, c.name
$$;
revoke execute on function public.distribution_board() from anon, public;
grant execute on function public.distribution_board() to authenticated;

create or replace function public.notify_lead_assigned()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(current_setting('app.bulk_assign', true), '') = 'on' then
    return new;
  end if;
  if new.agent_id is not null
     and (tg_op = 'INSERT' or new.agent_id is distinct from old.agent_id)
     and new.agent_id is distinct from auth.uid() then
    insert into public.notifications (user_id, company_id, type, title, body, link)
    values (new.agent_id, new.company_id, 'lead', 'ليد جديد: ' || new.full_name, new.phone, '/agent/leads');
  end if;
  return new;
end;
$$;
revoke execute on function public.notify_lead_assigned() from anon, authenticated, public;

create or replace function public.distribute_unassigned(p_company uuid default null, p_limit integer default 5000)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  c record;
  ids uuid[];
  n integer;
  moved integer := 0;
  step integer;
begin
  if not public.is_manager() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  perform set_config('app.bulk_assign', 'on', true);
  for c in
    select id from public.companies where is_active and (p_company is null or id = p_company)
  loop
    -- Linked agents who receive leads, the lightest load first.
    select array_agg(a.id order by a.open_n, random()) into ids
    from (
      select p.id,
        (select count(*) from public.leads l where l.agent_id = p.id and l.status in ('new', 'no_answer', 'contacted', 'interview', 'documents')) as open_n
      from public.agent_companies ac
      join public.profiles p on p.id = ac.agent_id and p.is_active and p.role = 'agent' and p.receives_leads
      where ac.company_id = c.id
    ) a;
    n := coalesce(array_length(ids, 1), 0);
    continue when n = 0;

    with todo as (
      select l.id, row_number() over (order by l.created_at) as rn
      from public.leads l
      where l.company_id = c.id and l.agent_id is null and l.status not in ('hired', 'rejected')
      order by l.created_at
      limit greatest(p_limit - moved, 0)
    ),
    upd as (
      update public.leads l set agent_id = ids[((t.rn - 1) % n) + 1]
      from todo t where l.id = t.id
      returning l.agent_id, l.company_id
    ),
    note as (
      insert into public.notifications (user_id, company_id, type, title, body, link)
      select u.agent_id, u.company_id, 'lead'::public.notification_type, 'اتوزّع عليك ' || count(*) || ' ليد جديد', null, '/agent/leads'
      from upd u group by u.agent_id, u.company_id
      returning 1
    )
    select count(*) into step from upd;
    moved := moved + step;
    exit when moved >= p_limit;
  end loop;
  perform set_config('app.bulk_assign', '', true);
  return moved;
end;
$$;
revoke execute on function public.distribute_unassigned(uuid, integer) from anon, public;
grant execute on function public.distribute_unassigned(uuid, integer) to authenticated;
