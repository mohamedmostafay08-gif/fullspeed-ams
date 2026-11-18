-- Trigger-only functions are not API endpoints.
revoke execute on function public.block_blacklisted_lead(), public.rearm_lead_reminders() from anon, authenticated, public;

-- Pin search_path on the distance helper (linter 0011).
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'distance_m'
  loop
    execute format('alter function %s set search_path = public', f);
  end loop;
end;
$$;
