-- Activity log: credit server-side writes to the person who asked for them instead of "System".
-- Server code using the service role sends the signed-in user's id in an `x-actor-id` header;
-- it's trusted only for service-role requests (a browser can't send that role). A passkey
-- belongs to — and is registered by — its own user. (New accounts are credited by the app
-- right after the auth server creates them.)

create or replace function public.audit_actor(p_table text, p_op text, p_row jsonb)
returns uuid
language plpgsql stable security definer set search_path = public
as $$
declare
  v text;
begin
  if auth.uid() is not null then
    return auth.uid();
  end if;
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    return null;
  end if;
  v := coalesce(current_setting('request.headers', true), '{}')::jsonb ->> 'x-actor-id';
  if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v::uuid;
  end if;
  if p_table = 'passkeys' then
    return (p_row ->> 'user_id')::uuid;
  end if;
  return null;
end;
$$;
revoke execute on function public.audit_actor(text, text, jsonb) from anon, authenticated, public;

create or replace function public.audit_row()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  ignored text[] := array['updated_at', 'callback_reminded_at', 'interview_reminded_at', 'last_contact_at', 'attempts'];
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  nw jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  j jsonb := coalesce(nw, o);
  diff jsonb;
  k text;
  actor uuid;
begin
  if tg_op = 'UPDATE' then
    diff := '{}';
    for k in select jsonb_object_keys(nw) loop
      if not (k = any (ignored)) and (o -> k) is distinct from (nw -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(o -> k, nw -> k));
      end if;
    end loop;
    if diff = '{}' then return new; end if;
  else
    diff := j - ignored;
  end if;

  actor := public.audit_actor(tg_table_name, tg_op, j);
  insert into public.audit_log (actor_id, actor_name, table_name, row_id, action, changes)
  values (actor, (select full_name from public.profiles where id = actor), tg_table_name,
          coalesce(j ->> 'id', concat_ws(':', j ->> 'agent_id', j ->> 'company_id')),
          lower(tg_op), diff);
  return coalesce(new, old);
end;
$$;

-- Fix the entries already logged as "System":
-- a passkey was registered by its owner …
update public.audit_log a
set actor_id = (a.changes ->> 'user_id')::uuid,
    actor_name = (select full_name from public.profiles where id = (a.changes ->> 'user_id')::uuid)
where a.table_name = 'passkeys' and a.actor_id is null
  and exists (select 1 from public.profiles p where p.id::text = a.changes ->> 'user_id');

-- … and a new account was set up by whoever edited it right after creating it.
with fix as (
  select a.id,
         (select x.actor_id from public.audit_log x
          where x.table_name = 'profiles' and x.row_id = a.row_id and x.action = 'update' and x.actor_id is not null
            and x.at between a.at and a.at + interval '5 minutes'
          order by x.at limit 1) as actor_id
  from public.audit_log a
  where a.table_name = 'profiles' and a.action = 'insert' and a.actor_id is null
)
update public.audit_log a
set actor_id = fix.actor_id, actor_name = (select full_name from public.profiles where id = fix.actor_id)
from fix
where a.id = fix.id and fix.actor_id is not null;
