-- Company logos bucket (public read, admin write)
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

create policy "admin upload logos" on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and public.is_admin());
create policy "admin update logos" on storage.objects for update to authenticated
  using (bucket_id = 'logos' and public.is_admin());
create policy "admin delete logos" on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and public.is_admin());

-- Duplicate check across all agents without exposing other agents' leads
create or replace function public.lead_phone_taken(p_company uuid, p_phone text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.leads where company_id = p_company and phone = p_phone)
$$;

revoke execute on function public.lead_phone_taken(uuid, text) from anon, public;
grant execute on function public.lead_phone_taken(uuid, text) to authenticated;

-- Period totals per agent × company (keeps result sets small for dashboards)
create or replace function public.performance_summary(p_from date, p_to date)
returns table (
  agent_id uuid, company_id uuid,
  leads_count bigint, hired_count bigint,
  target_leads bigint, target_hired bigint
)
language sql stable security invoker set search_path = public
as $$
  select agent_id, company_id, sum(leads_count)::bigint, sum(hired_count)::bigint,
         sum(target_leads)::bigint, sum(target_hired)::bigint
  from public.performance_report(p_from, p_to)
  group by agent_id, company_id
$$;

-- Status breakdown for leads created in a window (respects the caller's RLS)
create or replace function public.lead_status_counts(p_start timestamptz, p_end timestamptz)
returns table (status public.lead_status, total bigint)
language sql stable security invoker set search_path = public
as $$
  select status, count(*) from public.leads
  where created_at >= p_start and created_at < p_end
  group by status
$$;
