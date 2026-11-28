-- Assign companies to many agents in one save (the «توزيع الشركات» page), and from the agent page.
-- One call syncs each listed agent's companies to exactly the given set, all or nothing.
--   • Admin / manager: any agent. A company the agent's team doesn't have yet is added to the team first
--     (so the team rule from 0026 never blocks them).
--   • Team leader: agents in their own team only, and only the team's companies.
-- p_changes: [{"agent_id": "<uuid>", "company_ids": ["<uuid>", …]}, …]
-- Errors carry a code the app turns into Arabic: not_allowed, agent_not_found, agent_not_visible,
-- company_not_found, company_not_in_team:<company name>.

create or replace function public.set_agent_companies(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_role public.user_role := public.my_role();
  v_manager boolean := coalesce(public.my_role() in ('admin', 'manager'), false);
  v_team_members uuid[] := public.my_team_member_ids();
  v_item jsonb;
  v_agent uuid;
  v_agent_team uuid;
  v_wanted uuid[];
  v_bad text;
  v_added int := 0;
  v_removed int := 0;
  v_team_added int := 0;
  v_n int;
begin
  if v_me is null or v_role is null or v_role not in ('admin', 'manager', 'team_leader') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'bad_input' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_changes) loop
    v_agent := (v_item ->> 'agent_id')::uuid;
    select p.team_id into v_agent_team from public.profiles p where p.id = v_agent;
    if not found then
      raise exception 'agent_not_found' using errcode = 'P0002';
    end if;
    if not v_manager and not (v_agent = any (v_team_members)) then
      raise exception 'agent_not_visible' using errcode = '42501';
    end if;

    select coalesce(array_agg(distinct x::uuid), '{}')
      into v_wanted
      from jsonb_array_elements_text(coalesce(v_item -> 'company_ids', '[]'::jsonb)) x;

    if exists (select 1 from unnest(v_wanted) w where not exists (select 1 from public.companies c where c.id = w)) then
      raise exception 'company_not_found' using errcode = 'P0002';
    end if;

    if v_agent_team is not null then
      if v_manager then
        insert into public.team_companies (team_id, company_id, assigned_by)
        select v_agent_team, w, v_me from unnest(v_wanted) w
        on conflict do nothing;
        get diagnostics v_n = row_count;
        v_team_added := v_team_added + v_n;
      else
        select c.name into v_bad
          from unnest(v_wanted) w join public.companies c on c.id = w
          where not exists (select 1 from public.team_companies tc where tc.team_id = v_agent_team and tc.company_id = w)
          limit 1;
        if v_bad is not null then
          raise exception 'company_not_in_team:%', v_bad using errcode = '23514';
        end if;
      end if;
    end if;

    delete from public.agent_companies ac
      where ac.agent_id = v_agent and not (ac.company_id = any (v_wanted));
    get diagnostics v_n = row_count;
    v_removed := v_removed + v_n;

    insert into public.agent_companies (agent_id, company_id, assigned_by)
      select v_agent, w, v_me from unnest(v_wanted) w
      on conflict do nothing;
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  end loop;

  return jsonb_build_object('added', v_added, 'removed', v_removed, 'team_added', v_team_added);
end;
$$;

revoke execute on function public.set_agent_companies(jsonb) from anon, public;
grant execute on function public.set_agent_companies(jsonb) to authenticated;
