-- A read-only "performance" role: sees every team's numbers, changes nothing.
-- The new enum value can't be used as a literal in the same transaction, so checks below compare role::text.
alter type public.user_role add value if not exists 'performance';

-- Reads: performance sees everything admin/managers see (leads, profiles, numbers).
create or replace function public.sees_all()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and is_active and role::text in ('admin', 'manager', 'performance')) $$;

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
          me.role::text in ('admin', 'manager', 'performance')
          or (
            me.role = 'team_leader'
            and me.team_id is not null
            and me.team_id = (select team_id from public.profiles where id = p_agent)
          )
        )
    )
$$;

-- Writes: the one policy that let anyone who "sees all" change rows now needs a staff role (or the agent's own task).
drop policy "update tasks" on public.tasks;
create policy "update tasks" on public.tasks for update to authenticated
  using (agent_id = (select auth.uid())
         or ((select public.is_staff()) and ((select public.sees_all()) or agent_id = any ((select public.my_team_member_ids())::uuid[]))))
  with check (agent_id = (select auth.uid())
         or ((select public.is_staff()) and ((select public.sees_all()) or agent_id = any ((select public.my_team_member_ids())::uuid[]))));

-- The daily and weekly/monthly report notifications also go to performance users.
do $$
declare
  fn text;
  def text;
begin
  foreach fn in array array['public.send_daily_report()', 'public.send_period_reports()'] loop
    def := pg_get_functiondef(fn::regprocedure);
    def := replace(def, $q$role in ('admin', 'manager', 'team_leader')$q$, $q$role::text in ('admin', 'manager', 'team_leader', 'performance')$q$);
    execute def;
  end loop;
end;
$$;
