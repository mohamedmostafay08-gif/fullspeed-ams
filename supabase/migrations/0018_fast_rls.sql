-- Performance: row-level security evaluated "who can I see" once per query instead of once per row.
-- Same rules as can_see_agent(): yourself; every agent for active admins/managers; your team for an
-- active team leader. Wrapping helpers in (select …) lets Postgres compute them a single time.

create or replace function public.sees_all()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and is_active and role in ('admin', 'manager')) $$;

create or replace function public.my_team_member_ids()
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(p.id), '{}')
  from public.profiles me join public.profiles p on p.team_id = me.team_id
  where me.id = auth.uid() and me.is_active and me.role = 'team_leader' and me.team_id is not null
$$;

revoke execute on function public.sees_all(), public.my_team_member_ids() from anon, public;
grant execute on function public.sees_all(), public.my_team_member_ids() to authenticated;

drop policy "read leads" on public.leads;
create policy "read leads" on public.leads for select to authenticated
  using (((select public.sees_all()) or agent_id = (select auth.uid()) or agent_id = any ((select public.my_team_member_ids())::uuid[])) or (agent_id is null and (select public.is_staff())));

drop policy "update leads" on public.leads;
create policy "update leads" on public.leads for update to authenticated
  using (((select public.is_staff()) and (agent_id is null or ((select public.sees_all()) or agent_id = (select auth.uid()) or agent_id = any ((select public.my_team_member_ids())::uuid[])))) or (agent_id = (select auth.uid()) and (select public.location_ok())))
  with check (((select public.is_staff()) and (agent_id is null or ((select public.sees_all()) or agent_id = (select auth.uid()) or agent_id = any ((select public.my_team_member_ids())::uuid[])))) or (agent_id = (select auth.uid()) and (select public.location_ok())));

drop policy "insert leads" on public.leads;
create policy "insert leads" on public.leads for insert to authenticated
  with check (((select public.is_staff()) and (agent_id is null or ((select public.sees_all()) or agent_id = (select auth.uid()) or agent_id = any ((select public.my_team_member_ids())::uuid[])))) or (agent_id = (select auth.uid()) and (select public.location_ok()) and exists (select 1 from public.agent_companies ac where ac.agent_id = (select auth.uid()) and ac.company_id = leads.company_id)));

drop policy "read lead activity" on public.lead_activities;
create policy "read lead activity" on public.lead_activities for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_activities.lead_id and (((select public.sees_all()) or l.agent_id = (select auth.uid()) or l.agent_id = any ((select public.my_team_member_ids())::uuid[])) or (l.agent_id is null and (select public.is_staff())))));

drop policy "read profiles" on public.profiles;
create policy "read profiles" on public.profiles for select to authenticated
  using (((select public.sees_all()) or id = (select auth.uid()) or id = any ((select public.my_team_member_ids())::uuid[])));

drop policy "read tasks" on public.tasks;
create policy "read tasks" on public.tasks for select to authenticated
  using (((select public.sees_all()) or agent_id = (select auth.uid()) or agent_id = any ((select public.my_team_member_ids())::uuid[])));

drop policy "update tasks" on public.tasks;
create policy "update tasks" on public.tasks for update to authenticated
  using (((select public.sees_all()) or agent_id = (select auth.uid()) or agent_id = any ((select public.my_team_member_ids())::uuid[])))
  with check (((select public.sees_all()) or agent_id = (select auth.uid()) or agent_id = any ((select public.my_team_member_ids())::uuid[])));

drop policy "staff create tasks" on public.tasks;
create policy "staff create tasks" on public.tasks for insert to authenticated
  with check ((select public.is_staff()) and ((select public.sees_all()) or agent_id = (select auth.uid()) or agent_id = any ((select public.my_team_member_ids())::uuid[])));

drop policy "staff delete tasks" on public.tasks;
create policy "staff delete tasks" on public.tasks for delete to authenticated
  using ((select public.is_staff()) and ((select public.sees_all()) or agent_id = (select auth.uid()) or agent_id = any ((select public.my_team_member_ids())::uuid[])));

drop policy "read targets" on public.daily_targets;
create policy "read targets" on public.daily_targets for select to authenticated
  using (((select public.sees_all()) or agent_id = (select auth.uid()) or agent_id = any ((select public.my_team_member_ids())::uuid[])));

drop policy "staff targets" on public.daily_targets;
create policy "staff targets" on public.daily_targets for all to authenticated
  using ((select public.is_staff()) and ((select public.sees_all()) or agent_id = (select auth.uid()) or agent_id = any ((select public.my_team_member_ids())::uuid[])))
  with check ((select public.is_staff()) and ((select public.sees_all()) or agent_id = (select auth.uid()) or agent_id = any ((select public.my_team_member_ids())::uuid[])));

drop policy "read breaks" on public.agent_breaks;
create policy "read breaks" on public.agent_breaks for select to authenticated
  using (((select public.sees_all()) or agent_id = (select auth.uid()) or agent_id = any ((select public.my_team_member_ids())::uuid[])));

drop policy "read assignments" on public.agent_companies;
create policy "read assignments" on public.agent_companies for select to authenticated
  using (((select public.sees_all()) or agent_id = (select auth.uid()) or agent_id = any ((select public.my_team_member_ids())::uuid[])));

drop policy "staff assign" on public.agent_companies;
create policy "staff assign" on public.agent_companies for insert to authenticated
  with check ((select public.is_staff()) and ((select public.sees_all()) or agent_id = (select auth.uid()) or agent_id = any ((select public.my_team_member_ids())::uuid[])));

drop policy "staff unassign" on public.agent_companies;
create policy "staff unassign" on public.agent_companies for delete to authenticated
  using ((select public.is_staff()) and ((select public.sees_all()) or agent_id = (select auth.uid()) or agent_id = any ((select public.my_team_member_ids())::uuid[])));

drop policy "read checkins" on public.geo_checkins;
create policy "read checkins" on public.geo_checkins for select to authenticated
  using (((select public.sees_all()) or user_id = (select auth.uid()) or user_id = any ((select public.my_team_member_ids())::uuid[])));

drop policy "staff send notifications" on public.notifications;
create policy "staff send notifications" on public.notifications for insert to authenticated
  with check ((select public.is_staff()) and ((select public.sees_all()) or user_id = (select auth.uid()) or user_id = any ((select public.my_team_member_ids())::uuid[])));

drop policy "read announcements" on public.company_announcements;
create policy "read announcements" on public.company_announcements for select to authenticated
  using ((select public.is_staff()) or exists (select 1 from public.agent_companies ac where ac.agent_id = (select auth.uid()) and ac.company_id = company_announcements.company_id));

drop policy "managers read audit" on public.audit_log;
create policy "managers read audit" on public.audit_log for select to authenticated
  using ((select public.is_manager()));
