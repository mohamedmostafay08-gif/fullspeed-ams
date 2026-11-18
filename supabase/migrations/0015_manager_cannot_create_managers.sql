-- Only an admin creates or promotes managers (and admins). A manager may edit team leaders
-- and agents, may never give anyone the manager/admin role, and may edit only their own
-- manager profile (without changing its role).
drop policy "manager profiles" on public.profiles;
create policy "manager profiles" on public.profiles for update to authenticated
  using (public.my_role() = 'manager' and (role in ('team_leader', 'agent') or id = auth.uid()))
  with check (
    public.my_role() = 'manager'
    and (role in ('team_leader', 'agent') or (id = auth.uid() and role = 'manager'))
  );
