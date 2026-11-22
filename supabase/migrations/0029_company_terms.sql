-- Pay and work terms per company (salary, order price, working hours, plus any other terms),
-- editable by the admin and managers and shown to agents while they talk to captains.
alter table public.companies
  add column if not exists salary text,
  add column if not exists order_price text,
  add column if not exists working_hours text,
  add column if not exists terms jsonb not null default '[]'::jsonb;
alter table public.companies drop constraint if exists terms_is_array;
alter table public.companies add constraint terms_is_array check (jsonb_typeof(terms) = 'array');

-- Companies are otherwise admin-only to edit; managers may change just these fields.
create or replace function public.save_company_terms(p_id uuid, p_salary text, p_order_price text, p_hours text, p_terms jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_manager() then raise exception 'managers_only' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_terms, '[]')) <> 'array' or jsonb_array_length(coalesce(p_terms, '[]')) > 20 then
    raise exception 'bad_terms' using errcode = '22023';
  end if;
  update public.companies
  set salary = nullif(left(btrim(p_salary), 120), ''),
      order_price = nullif(left(btrim(p_order_price), 120), ''),
      working_hours = nullif(left(btrim(p_hours), 120), ''),
      terms = coalesce(p_terms, '[]')
  where id = p_id;
end;
$$;
revoke execute on function public.save_company_terms(uuid, text, text, text, jsonb) from anon, public;
grant execute on function public.save_company_terms(uuid, text, text, text, jsonb) to authenticated;
