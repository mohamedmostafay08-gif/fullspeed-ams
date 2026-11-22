-- Teams own companies: the admin or a manager assigns companies to a team, and the team leader
-- splits them among the team's agents. A team leader can also add agents (to their own team)
-- and ask the admin to deactivate or reactivate one.

create table public.team_companies (
  team_id uuid not null references public.teams(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (team_id, company_id)
);
create index on public.team_companies (company_id);
alter table public.team_companies enable row level security;
create policy "read team companies" on public.team_companies for select to authenticated using (true);
create policy "managers assign team companies" on public.team_companies for all to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));
grant select, insert, delete on public.team_companies to authenticated;

-- An agent in a team may only be assigned that team's companies.
create or replace function public.check_agent_company_in_team()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare t uuid := (select team_id from public.profiles where id = new.agent_id);
begin
  if t is not null and not exists (select 1 from public.team_companies tc where tc.team_id = t and tc.company_id = new.company_id) then
    raise exception 'company_not_in_team' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_agent_company_in_team() from anon, authenticated, public;
create trigger agent_companies_in_team before insert on public.agent_companies
  for each row execute function public.check_agent_company_in_team();

-- Taking a company away from a team takes it away from the team's agents.
create or replace function public.drop_team_company_from_agents()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.agent_companies ac
  using public.profiles p
  where p.id = ac.agent_id and p.team_id = old.team_id and ac.company_id = old.company_id;
  return old;
end;
$$;
revoke execute on function public.drop_team_company_from_agents() from anon, authenticated, public;
create trigger team_companies_cascade after delete on public.team_companies
  for each row execute function public.drop_team_company_from_agents();

-- Moving an agent to another team drops the companies the new team doesn't have.
create or replace function public.trim_companies_on_team_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.team_id is distinct from old.team_id and new.team_id is not null then
    delete from public.agent_companies ac
    where ac.agent_id = new.id
      and not exists (select 1 from public.team_companies tc where tc.team_id = new.team_id and tc.company_id = ac.company_id);
  end if;
  return new;
end;
$$;
revoke execute on function public.trim_companies_on_team_change() from anon, authenticated, public;
create trigger profiles_team_change after update of team_id on public.profiles
  for each row execute function public.trim_companies_on_team_change();

-- Start each existing team with the companies its agents already work on.
insert into public.team_companies (team_id, company_id, assigned_by)
select distinct p.team_id, ac.company_id, null::uuid
from public.agent_companies ac join public.profiles p on p.id = ac.agent_id
where p.team_id is not null
on conflict do nothing;

-- Team leaders can ask the admin to deactivate or reactivate an agent in their own team.
drop policy "managers request" on public.admin_requests;
create policy "managers request" on public.admin_requests for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and status = 'pending'
    and (
      ((select public.my_role()) = 'manager'
        and exists (select 1 from public.profiles t where t.id = target_id and t.role in ('team_leader', 'agent')
                    and ((kind = 'deactivate' and t.is_active) or (kind = 'activate' and not t.is_active))))
      or ((select public.my_role()) = 'team_leader'
        and exists (select 1 from public.profiles t
                    join public.profiles me on me.id = (select auth.uid())
                    where t.id = target_id and t.role = 'agent' and t.team_id is not null and t.team_id = me.team_id
                      and ((kind = 'deactivate' and t.is_active) or (kind = 'activate' and not t.is_active))))
    )
  );
