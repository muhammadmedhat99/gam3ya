-- Super-admin user management: block / unblock accounts.
-- (Password reset and account recovery already exist: admin_reset_password,
-- admin_recover_account in the auth migration.)
--
--   * only the active super admin may call it with their own id as the actor
--   * the super admin account itself can't be blocked
--   * blocking revokes every session immediately; unblocking also clears any lock
--   * audited as user.blocked / user.unblocked

create or replace function public.admin_set_user_status(
  p_actor_user_id  uuid,
  p_target_user_id uuid,
  p_status         text,
  p_note           text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_target_is_admin boolean;
  v_previous text;
begin
  if not exists (
    select 1 from public.users where id = p_actor_user_id and is_super_admin and status = 'active'
  ) then
    raise exception 'actor is not the super admin' using errcode = '42501';
  end if;
  if p_status not in ('active', 'blocked') then
    raise exception 'status must be active or blocked' using errcode = '22023';
  end if;

  select is_super_admin, status into v_target_is_admin, v_previous
    from public.users where id = p_target_user_id for update;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if v_target_is_admin then
    raise exception 'the super admin cannot be blocked' using errcode = '55000';
  end if;
  if v_previous = p_status then
    return;
  end if;

  update public.users
     set status = p_status,
         failed_login_count = 0,
         locked_until = null
   where id = p_target_user_id;

  if p_status = 'blocked' then
    update public.user_sessions set revoked_at = now()
     where user_id = p_target_user_id and revoked_at is null;
  end if;

  insert into public.activity_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (p_actor_user_id,
          case when p_status = 'blocked' then 'user.blocked' else 'user.unblocked' end,
          'user', p_target_user_id,
          jsonb_build_object('as_super_admin', true, 'note', nullif(btrim(p_note), '')));
end;
$$;

revoke execute on function public.admin_set_user_status(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_user_status(uuid, uuid, text, text) to service_role;
