-- 0057 · Hand a company's leads to its own agents from inside the company page.
-- Additive: two new functions. Paste into the Supabase SQL editor; the app code ships after it. Needs 0054 (bulk notification flag).
--
-- company_lead_load(company): who holds the company's leads — one row per linked agent and per agent holding leads,
--   plus one row with a null agent for the unassigned ones. Admin, manager and team leader only.
-- rebalance_company_leads(company, from_agent): evens out the company's untouched leads (new, never called, no callback)
--   across the agents linked to the company who receive leads. The pool is the unassigned leads, untouched leads held by
--   agents not linked any more, and untouched leads of every linked agent (or only of from_agent). Only the surplus moves;
--   leads someone already worked on never move. Admin and manager only.

create or replace function public.company_lead_load(p_company uuid)
returns table (agent_id uuid, name text, linked boolean, receives boolean, untouched bigint, open_n bigint)
language sql stable security definer set search_path = public
as $$
  with holders as (
    select l.agent_id,
      count(*) filter (where l.status = 'new' and l.attempts = 0 and l.first_contact_at is null and l.callback_at is null) as untouched,
      count(*) filter (where l.status not in ('hired', 'rejected')) as open_n
    from public.leads l
    where l.company_id = p_company
    group by l.agent_id
  ),
  linked as (
    select ac.agent_id
    from public.agent_companies ac
    join public.profiles p on p.id = ac.agent_id and p.is_active and p.role = 'agent'
    where ac.company_id = p_company
  )
  select coalesce(h.agent_id, k.agent_id), p.full_name, k.agent_id is not null, coalesce(p.receives_leads, false),
    coalesce(h.untouched, 0), coalesce(h.open_n, 0)
  from holders h
  full join linked k on k.agent_id = h.agent_id
  left join public.profiles p on p.id = coalesce(h.agent_id, k.agent_id)
  where public.my_role() in ('admin', 'manager', 'team_leader')
  order by coalesce(h.agent_id, k.agent_id) is not null, coalesce(h.open_n, 0) desc, p.full_name
$$;
revoke execute on function public.company_lead_load(uuid) from anon, public;
grant execute on function public.company_lead_load(uuid) to authenticated;

create or replace function public.rebalance_company_leads(p_company uuid, p_from uuid default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  ids uuid[];
  n integer;
  moved integer;
begin
  if not public.is_manager() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select array_agg(p.id order by random()) into ids
  from public.agent_companies ac
  join public.profiles p on p.id = ac.agent_id and p.is_active and p.role = 'agent' and p.receives_leads
  where ac.company_id = p_company;
  n := coalesce(array_length(ids, 1), 0);
  if n = 0 then
    return 0;
  end if;

  perform set_config('app.bulk_assign', 'on', true);
  -- Every pooled lead gets one slot; each agent ends with total/n (the first total%n agents one more).
  -- A lead stays with its holder while the holder is under target, so only the surplus moves.
  with pool as (
    select l.id, l.agent_id as old_agent, l.created_at
    from public.leads l
    where l.company_id = p_company
      and l.status not in ('hired', 'rejected')
      and (
        l.agent_id is null
        or (l.status = 'new' and l.attempts = 0 and l.first_contact_at is null and l.callback_at is null
            and (p_from is null or l.agent_id = p_from or not (l.agent_id = any(ids))))
      )
  ),
  total as (select count(*) as t from pool),
  target as (
    select a.agent, a.i, (tt.t / n) + case when a.i <= tt.t % n then 1 else 0 end as want
    from unnest(ids) with ordinality as a(agent, i), total tt
  ),
  ranked as (
    select p.id, p.old_agent, row_number() over (partition by p.old_agent order by p.created_at, p.id) as rk
    from pool p
  ),
  kept as (
    select r.id, r.old_agent from ranked r join target g on g.agent = r.old_agent where r.rk <= g.want
  ),
  slots as (
    select g.agent, row_number() over (order by s.k, g.i) as sn
    from target g
    cross join lateral generate_series((select count(*) from kept k where k.old_agent = g.agent) + 1, g.want) as s(k)
  ),
  free as (
    select p.id, p.old_agent, row_number() over (order by p.created_at, p.id) as fn
    from pool p where not exists (select 1 from kept k where k.id = p.id)
  ),
  plan as (
    select f.id, f.old_agent, s.agent as new_agent from free f join slots s on s.sn = f.fn
  ),
  upd as (
    update public.leads l set agent_id = p.new_agent
    from plan p
    where l.id = p.id and p.old_agent is distinct from p.new_agent
    returning l.agent_id, l.company_id
  ),
  note as (
    insert into public.notifications (user_id, company_id, type, title, body, link)
    select u.agent_id, u.company_id, 'lead'::public.notification_type, 'اتوزّع عليك ' || count(*) || ' ليد جديد', null, '/agent/leads'
    from upd u group by u.agent_id, u.company_id
    returning 1
  )
  select count(*) into moved from upd;
  perform set_config('app.bulk_assign', '', true);
  return moved;
end;
$$;
revoke execute on function public.rebalance_company_leads(uuid, uuid) from anon, public;
grant execute on function public.rebalance_company_leads(uuid, uuid) to authenticated;
