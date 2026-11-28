-- 0062 · Interviews board: did the captain come?
--   leads.interview_result: attended / no_show / rescheduled, with when it was marked and how many times they didn't come.
--   mark_interview(): one call per button (runs as the user, so RLS decides who may).
--     attended    → status «documents» (if still «interview»).
--     no_show     → back to the agent as a call due now, to book a new time; the lead is NOT rejected.
--     rescheduled → new interview time, status «interview».
--   interview_stats(): per company, how many came and how many didn't in a period (numbers only).
-- Additive only. Safe to run twice.

alter table public.leads add column if not exists interview_result text;
alter table public.leads add column if not exists interview_result_at timestamptz;
alter table public.leads add column if not exists no_show_count smallint not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_interview_result_check') then
    alter table public.leads add constraint leads_interview_result_check check (interview_result is null or interview_result in ('attended', 'no_show', 'rescheduled'));
  end if;
end $$;
create index if not exists leads_interview_at_idx on public.leads (interview_at) where interview_at is not null;

-- A new interview time set any other way clears the old result, so the board asks again.
create or replace function public.leads_interview_result_reset()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.interview_at is distinct from old.interview_at and new.interview_result is not distinct from old.interview_result then
    new.interview_result := null;
    new.interview_result_at := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.leads_interview_result_reset() from anon, authenticated, public;
drop trigger if exists leads_interview_result_reset on public.leads;
create trigger leads_interview_result_reset before update on public.leads
  for each row execute function public.leads_interview_result_reset();

create or replace function public.mark_interview(p_lead uuid, p_result text, p_at timestamptz default null)
returns text
language plpgsql set search_path = public
as $$
declare
  l record;
  n integer;
  note text;
  was text;
begin
  select id, status, interview_at, interview_place into l from public.leads where id = p_lead;
  if not found then return 'not_found'; end if;
  if l.status in ('hired', 'rejected') then return 'closed'; end if;
  was := coalesce(to_char(l.interview_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI'), '—');

  if p_result = 'attended' then
    update public.leads
    set interview_result = 'attended', interview_result_at = now(),
        status = case when status = 'interview' then 'documents'::public.lead_status else status end,
        last_contact_at = now()
    where id = p_lead;
    note := '✅ حضر المقابلة (' || was || ')';
  elsif p_result = 'no_show' then
    update public.leads
    set interview_result = 'no_show', interview_result_at = now(), no_show_count = no_show_count + 1,
        status = case when status = 'interview' then 'contacted'::public.lead_status else status end,
        callback_at = now(), interview_reminded_at = null
    where id = p_lead;
    note := '🚫 مجاش المقابلة (' || was || ') — كلّمه وحدد معاد تاني';
  elsif p_result = 'rescheduled' then
    if p_at is null or p_at < now() - interval '5 minutes' then return 'bad_time'; end if;
    update public.leads
    set interview_result = 'rescheduled', interview_result_at = now(), interview_at = p_at, interview_reminded_at = null,
        status = 'interview', callback_at = null
    where id = p_lead;
    note := '📅 المقابلة اتأجلت لـ ' || to_char(p_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI');
  else
    return 'bad_result';
  end if;
  get diagnostics n = row_count;
  if n = 0 then return 'not_allowed'; end if;
  perform public.log_lead_note(p_lead, note);
  return 'ok';
end;
$$;
revoke execute on function public.mark_interview(uuid, text, timestamptz) from anon, public;
grant execute on function public.mark_interview(uuid, text, timestamptz) to authenticated;

-- Per company in a period (Cairo days): interviews held, attended, didn't come (from the log, so repeat no-shows count),
-- and still waiting for a result. Team leaders see their team; managers and performance see all.
create or replace function public.interview_stats(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  t0 timestamptz := public.cairo_day_start(p_from);
  t1 timestamptz := public.cairo_day_start(p_to + 1);
  everyone boolean := public.sees_all();
  team uuid[];
begin
  if not public.is_staff() and not everyone then raise exception 'not allowed' using errcode = '42501'; end if;
  if not everyone then team := public.my_team_member_ids() || auth.uid(); end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.held desc, x.company)
    from (
      select c.id as company_id, c.name as company,
             count(*) filter (where e.kind = 'attended')::int as attended,
             count(*) filter (where e.kind = 'no_show')::int as no_show,
             count(*) filter (where e.kind = 'waiting')::int as waiting,
             count(*) filter (where e.kind in ('attended', 'no_show'))::int as held
      from (
        select l.company_id, 'attended'::text as kind from public.leads l
        where l.interview_result = 'attended' and l.interview_result_at >= t0 and l.interview_result_at < t1
          and (everyone or l.agent_id = any (team))
        union all
        select l.company_id, 'no_show' from public.lead_activities a join public.leads l on l.id = a.lead_id
        where a.note like '🚫 مجاش المقابلة%' and a.created_at >= t0 and a.created_at < t1
          and (everyone or l.agent_id = any (team))
        union all
        select l.company_id, 'waiting' from public.leads l
        where l.status = 'interview' and l.interview_at >= t0 and l.interview_at < least(t1, now()) and coalesce(l.interview_result, 'rescheduled') = 'rescheduled'
          and (everyone or l.agent_id = any (team))
      ) e
      join public.companies c on c.id = e.company_id
      group by c.id, c.name
    ) x
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.interview_stats(date, date) from anon, public;
grant execute on function public.interview_stats(date, date) to authenticated;
