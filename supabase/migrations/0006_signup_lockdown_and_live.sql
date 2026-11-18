-- Self-registered accounts start disabled; only admins (or the create-admin script) activate people.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, is_active)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'phone',
    false
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- Live dashboards: broadcast lead and task changes (RLS still decides who receives what).
alter publication supabase_realtime add table public.leads;
alter publication supabase_realtime add table public.tasks;
