-- 0065 · «وزّع بالتساوي» on the company page stops at each agent's cap.
-- Replaces the body of rebalance_company_leads (0057); same signature and grants. Needs 0055 (max_open_default = 150).
-- Paste into the Supabase SQL editor.
--
-- Same pool as 0057: the company's unassigned open leads, plus untouched leads (new, never called, no callback) held by
-- agents not linked any more, and by every linked agent (or only by p_from). The pool is split as evenly as the caps allow:
-- an agent's room = cap − open leads they keep outside the pool (all companies), the same cap distribute_unassigned uses
-- (profiles.max_open_leads, else assignment_settings.max_open_default; no cap = no limit). Agents with little room are
-- filled first and the rest is shared by the others. Leads nobody has room for go back to «مش متوزعة», so
-- distribute_unassigned hands them out later as room frees up. Only the surplus moves; worked leads never move.

create or replace function public.rebalance_company_leads(p_company uuid, p_from uuid default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  def_cap integer := nullif((select max_open_default from public.assignment_settings where id = 1), 0);
  ag record;
  ids uuid[] := '{}';
  wants integer[] := '{}';
  total integer;
  rem integer;
  k integer;
  give integer;
  moved integer;
begin
  if not public.is_manager() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if to_regclass('pg_temp.rb_pool') is not null then
    drop table rb_pool;
  end if;
  create temp table rb_pool on commit drop as
  select l.id, l.agent_id as old_agent, l.created_at
  from public.leads l
  where l.company_id = p_company
    and l.status not in ('hired', 'rejected')
    and (
      l.agent_id is null
      or (l.status = 'new' and l.attempts = 0 and l.first_contact_at is null and l.callback_at is null
          and (p_from is null or l.agent_id = p_from
               or not exists (
                 select 1 from public.agent_companies ac
                 join public.profiles p on p.id = ac.agent_id and p.is_active and p.role = 'agent' and p.receives_leads
                 where ac.company_id = p_company and ac.agent_id = l.agent_id)))
    );

  select count(*) into total from rb_pool;
  select count(*) into k
  from public.agent_companies ac
  join public.profiles p on p.id = ac.agent_id and p.is_active and p.role = 'agent' and p.receives_leads
  where ac.company_id = p_company;
  if k = 0 or total = 0 then
    return 0;
  end if;

  -- Water-fill: tightest room first, each takes min(room, fair share of what is left).
  rem := total;
  for ag in
    select a.id, a.room
    from (
      select p.id,
        coalesce(nullif(p.max_open_leads, 0), def_cap)
          - ((select count(*) from public.leads l where l.agent_id = p.id and l.status in ('new', 'no_answer', 'contacted', 'interview', 'documents'))
             - (select count(*) from rb_pool x where x.old_agent = p.id)) as room
      from public.agent_companies ac
      join public.profiles p on p.id = ac.agent_id and p.is_active and p.role = 'agent' and p.receives_leads
      where ac.company_id = p_company
    ) a
    order by a.room asc nulls last, random()
  loop
    give := least(ceil(rem::numeric / k)::integer, coalesce(greatest(ag.room, 0)::integer, rem));
    ids := ids || ag.id;
    wants := wants || give;
    rem := rem - give;
    k := k - 1;
  end loop;

  perform set_config('app.bulk_assign', 'on', true);
  with target as (
    select t.agent, t.i, t.want from unnest(ids, wants) with ordinality as t(agent, want, i)
  ),
  ranked as (
    select p.id, p.old_agent, row_number() over (partition by p.old_agent order by p.created_at, p.id) as rk
    from rb_pool p
  ),
  kept as (
    select r.id, r.old_agent from ranked r join target g on g.agent = r.old_agent where r.rk <= g.want
  ),
  slots as (
    select g.agent, row_number() over (order by s.n, g.i) as sn
    from target g
    cross join lateral generate_series((select count(*) from kept k2 where k2.old_agent = g.agent) + 1, g.want) as s(n)
  ),
  free as (
    select p.id, p.old_agent, row_number() over (order by p.created_at, p.id) as fn
    from rb_pool p where not exists (select 1 from kept k3 where k3.id = p.id)
  ),
  plan as (
    -- Free leads beyond everyone's room get no slot: they go back to unassigned.
    select f.id, f.old_agent, s.agent as new_agent from free f left join slots s on s.sn = f.fn
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
    from upd u where u.agent_id is not null group by u.agent_id, u.company_id
    returning 1
  )
  select count(*) into moved from upd;
  perform set_config('app.bulk_assign', '', true);
  return moved;
end;
$$;
revoke execute on function public.rebalance_company_leads(uuid, uuid) from anon, public;
grant execute on function public.rebalance_company_leads(uuid, uuid) to authenticated;
