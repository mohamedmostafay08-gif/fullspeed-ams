-- Performance: indexes for the time-range scans and a single-pass streak calculation
-- (the per-agent, per-day loop issued ~360 queries per agent).

create index if not exists leads_created_at_idx on public.leads (created_at);
create index if not exists leads_hired_at_idx on public.leads (hired_at) where hired_at is not null;
create index if not exists leads_agent_hired_idx on public.leads (agent_id, hired_at) where hired_at is not null;
create index if not exists leads_created_by_idx on public.leads (created_by, created_at);
create index if not exists lead_activities_actor_idx on public.lead_activities (actor_id, created_at);
create index if not exists lead_activities_created_idx on public.lead_activities (created_at);
create index if not exists geo_checkins_user_created_idx on public.geo_checkins (user_id, created_at);

-- Streaks for every active agent (or one), from three grouped scans over the last 90 days.
create or replace function public.streaks_all(p_agent uuid default null)
returns table (agent_id uuid, streak integer)
language plpgsql stable security definer set search_path = public
as $$
declare
  today date := public.cairo_today();
  since timestamptz := public.cairo_day_start(today - 89);
  r record;
  cur uuid := null;
  s integer := 0;
  stopped boolean := false;
begin
  for r in
    with ag as (select id from public.profiles where role = 'agent' and is_active and (p_agent is null or id = p_agent)),
    l as (select x.agent_id a, (x.created_at at time zone 'Africa/Cairo')::date d, count(*) n
          from public.leads x where x.created_at >= since and x.agent_id in (select id from ag) group by 1, 2),
    h as (select x.agent_id a, (x.hired_at at time zone 'Africa/Cairo')::date d, count(*) n
          from public.leads x where x.hired_at >= since and x.agent_id in (select id from ag) group by 1, 2),
    act as (select x.actor_id a, (x.created_at at time zone 'Africa/Cairo')::date d
            from public.lead_activities x where x.created_at >= since and x.actor_id in (select id from ag) group by 1, 2),
    t as (select x.agent_id a, x.date d, sum(x.target_leads) tl, sum(x.target_hired) th
          from public.daily_targets x where x.date >= today - 89 and x.agent_id in (select id from ag) group by 1, 2),
    k as (select a, d from l union select a, d from h union select a, d from act)
    select k.a, k.d, coalesce(l.n, 0) ln, coalesce(h.n, 0) hn, coalesce(t.tl, 0) tl, coalesce(t.th, 0) th
    from k left join l using (a, d) left join h using (a, d) left join t using (a, d)
    order by k.a, k.d desc
  loop
    if cur is distinct from r.a then
      if cur is not null then agent_id := cur; streak := s; return next; end if;
      cur := r.a; s := 0; stopped := false;
    end if;
    continue when stopped;
    -- Days without any activity are skipped (days off); today may still be in progress.
    if (case when r.tl + r.th > 0 then r.ln >= r.tl and r.hn >= r.th else r.hn >= 1 end) then
      s := s + 1;
    elsif r.d <> today then
      stopped := true;
    end if;
  end loop;
  if cur is not null then agent_id := cur; streak := s; return next; end if;
end;
$$;

create or replace function public.agent_streak(p_agent uuid)
returns integer
language sql stable security definer set search_path = public
as $$ select coalesce((select streak from public.streaks_all(p_agent)), 0) $$;

create or replace function public.leaderboard(p_from date, p_to date)
returns table (agent_id uuid, full_name text, team_id uuid, leads integer, calls integer, interviews integer, hired integer, points integer, streak integer)
language sql stable security definer set search_path = public
as $$
  with r as (select public.cairo_day_start(p_from) s, public.cairo_day_start(least(p_to, p_from + 366) + 1) e),
  a as (select id, full_name, team_id from public.profiles where role = 'agent' and is_active),
  l as (select l.agent_id, count(*) n from public.leads l, r where l.created_at >= r.s and l.created_at < r.e group by 1),
  h as (select l.agent_id, count(*) n from public.leads l, r where l.hired_at >= r.s and l.hired_at < r.e group by 1),
  c as (select la.actor_id, count(*) n from public.lead_activities la, r
        where la.created_at >= r.s and la.created_at < r.e and la.note ~ '^(📞|📵|⏰|📅|✋|🎉)' group by 1),
  iv as (select l.agent_id, count(*) n from public.lead_activities la join public.leads l on l.id = la.lead_id, r
         where la.created_at >= r.s and la.created_at < r.e and la.to_status = 'interview' group by 1),
  st as (select * from public.streaks_all())
  select a.id, a.full_name, a.team_id,
         coalesce(l.n, 0)::int, coalesce(c.n, 0)::int, coalesce(iv.n, 0)::int, coalesce(h.n, 0)::int,
         (coalesce(l.n, 0) + coalesce(c.n, 0) + 3 * coalesce(iv.n, 0) + 10 * coalesce(h.n, 0))::int,
         coalesce(st.streak, 0)
  from a
  left join l on l.agent_id = a.id
  left join h on h.agent_id = a.id
  left join c on c.actor_id = a.id
  left join iv on iv.agent_id = a.id
  left join st on st.agent_id = a.id
  order by 8 desc, 7 desc, 2
$$;

-- Live board activity: one grouped scan instead of three sub-queries per agent.
create or replace function public.activity_today_all()
returns table (agent_id uuid, last_at timestamptz, last_note text, checkin_at timestamptz)
language sql stable security definer set search_path = public
as $$
  with since as (select public.cairo_day_start(public.cairo_today()) s),
  la as (
    select distinct on (x.actor_id) x.actor_id a, x.created_at at_, coalesce(x.note, x.to_status::text) note
    from public.lead_activities x, since where x.created_at >= since.s and x.actor_id is not null
    order by x.actor_id, x.created_at desc
  ),
  lc as (select x.created_by a, max(x.created_at) at_ from public.leads x, since where x.created_at >= since.s group by 1),
  gc as (select x.user_id a, max(x.created_at) at_ from public.geo_checkins x, since where x.created_at >= since.s group by 1)
  select p.id, nullif(greatest(coalesce(la.at_, '-infinity'), coalesce(lc.at_, '-infinity')), '-infinity'), la.note, gc.at_
  from public.profiles p
  left join la on la.a = p.id
  left join lc on lc.a = p.id
  left join gc on gc.a = p.id
  where p.role = 'agent' and p.is_active
$$;

-- Everything the app shell needs for a signed-in request, in one round trip.
create or replace function public.my_session()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'profile', to_jsonb(p) - 'created_at',
    'unread', (select count(*) from public.notifications n where n.user_id = p.id and not n.is_read),
    'location_ok', public.location_ok(),
    'location_name', (select w.name from public.work_locations w where w.id = p.location_id)
  )
  from public.profiles p where p.id = auth.uid()
$$;

revoke execute on function public.streaks_all(uuid), public.my_session() from anon, public;
grant execute on function public.streaks_all(uuid), public.my_session() to authenticated;
revoke execute on function public.activity_today_all() from anon, authenticated, public;
