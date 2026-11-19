-- Deleting an association (owner only, draft or completed).
--
-- Financial records are never deleted (AGENTS.md rule 11), so "delete" is a soft
-- delete: the group gets deleted_at and disappears from the app for everyone, while
-- its members, obligations, payments, payouts and audit trail stay in the database.
--   * only the owner (or super admin) can delete; only draft or completed groups
--   * pending link requests are cancelled
--   * a deleted group is frozen: is_group_manager / can_collect return false for it,
--     so every function that checks them (members, shares, order, roles, payments,
--     payouts, link requests, settings) refuses to touch it
--   * members are notified (no link, the group is gone from their lists)

alter table public.groups
  add column deleted_at timestamptz,
  add column deleted_by_user_id uuid references public.users (id) on delete restrict;

create index groups_not_deleted_idx on public.groups (id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Freeze deleted groups through the shared authorization helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_group_manager(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.groups where id = p_group_id and deleted_at is null)
     and (
       exists (
         select 1 from public.group_roles
          where group_id = p_group_id and user_id = p_user_id and role in ('owner', 'admin')
       ) or exists (
         select 1 from public.users where id = p_user_id and is_super_admin and status = 'active'
       )
     );
$$;

create or replace function public.can_collect(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.groups where id = p_group_id and deleted_at is null)
     and (
       exists (
         select 1 from public.group_roles
          where group_id = p_group_id and user_id = p_user_id and role in ('owner', 'admin', 'collector')
       ) or exists (
         select 1 from public.users where id = p_user_id and is_super_admin and status = 'active'
       )
     );
$$;

create or replace function public.is_group_owner(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.groups where id = p_group_id and deleted_at is null)
     and (
       exists (
         select 1 from public.group_roles where group_id = p_group_id and user_id = p_user_id and role = 'owner'
       ) or exists (
         select 1 from public.users where id = p_user_id and is_super_admin and status = 'active'
       )
     );
$$;

-- ---------------------------------------------------------------------------
-- delete_group
-- ---------------------------------------------------------------------------

create or replace function public.delete_group(
  p_actor_user_id uuid,
  p_group_id      uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_deleted timestamptz;
begin
  select status, deleted_at into v_status, v_deleted from public.groups where id = p_group_id for update;
  if not found or v_deleted is not null then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  if p_actor_user_id is null or not public.is_group_owner(p_group_id, p_actor_user_id) then
    raise exception 'only the owner can delete the group' using errcode = '42501';
  end if;

  if v_status not in ('draft', 'completed') then
    raise exception 'only a draft or completed group can be deleted' using errcode = '55000';
  end if;

  update public.member_link_requests
     set status = 'cancelled', reviewed_by_user_id = p_actor_user_id, reviewed_at = now()
   where group_id = p_group_id and status = 'pending';

  update public.groups
     set deleted_at = now(), deleted_by_user_id = p_actor_user_id
   where id = p_group_id;

  -- Logged before nothing else changes, so the notification trigger can still name it.
  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_group_id, p_actor_user_id, 'group.deleted', 'group', p_group_id,
          jsonb_build_object('status_at_delete', v_status));
end;
$$;

revoke execute on function public.delete_group(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_group(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Notify members when a group is deleted (notify_from_activity + 'group.deleted')
-- ---------------------------------------------------------------------------

create or replace function public.notify_from_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_group text;
  v_href text;
  v_user uuid;
  v_name text;
begin
  if new.group_id is not null then
    select name into v_group from public.groups where id = new.group_id;
    v_href := '/groups/' || new.group_id;
  end if;
  v_group := coalesce(v_group, 'الجمعية');

  case new.action
    when 'link_request.created' then
      select u.full_name into v_name
        from public.member_link_requests r join public.users u on u.id = r.user_id
       where r.id = new.entity_id;
      insert into public.notifications (user_id, group_id, type, title, body, data)
      select s.user_id, new.group_id, 'link_request', 'طلب ربط جديد',
             coalesce(v_name, 'حد') || ' سجّل برقم إنت ضايفه في ' || v_group || '. راجع الطلب ووافق لو هو نفس الشخص.',
             jsonb_build_object('href', v_href || '/requests')
        from public.group_staff(new.group_id, false) s;

    when 'link_request.approved' then
      insert into public.notifications (user_id, group_id, type, title, body, data)
      values ((new.metadata->>'user_id')::uuid, new.group_id, 'link_approved', 'اتوافق على ربط حسابك',
              'بقيت تشوف ' || v_group || ' في جمعياتك.', jsonb_build_object('href', v_href));

    when 'link_request.rejected' then
      -- Deliberately no group_id and no association name.
      insert into public.notifications (user_id, group_id, type, title, body, data)
      values ((new.metadata->>'user_id')::uuid, null, 'link_rejected', 'طلب ربط اترفض',
              'أدمن جمعية مأكدش إن الرقم ده بتاعك. لو ده غلط، كلّمه.', '{}'::jsonb);

    when 'member.added' then
      if coalesce((new.metadata->>'linked')::boolean, false) then
        select user_id into v_user from public.group_members where id = new.entity_id;
        if v_user is not null and v_user is distinct from new.actor_user_id then
          insert into public.notifications (user_id, group_id, type, title, body, data)
          values (v_user, new.group_id, 'member_added', 'اتضفت لجمعية',
                  'اتضفت في ' || v_group || '. هتلاقيها في جمعياتك.', jsonb_build_object('href', v_href));
        end if;
      end if;

    when 'group.activated' then
      insert into public.notifications (user_id, group_id, type, title, body, data)
      select a.user_id, new.group_id, 'group_started', 'الجمعية بدأت',
             v_group || ' بدأت. هتلاقي نصيبك وترتيب القبض في صفحتها.', jsonb_build_object('href', v_href)
        from public.group_audience(new.group_id) a
       where a.user_id is distinct from new.actor_user_id;

    when 'payout.recorded' then
      select user_id into v_user from public.group_members where id = (new.metadata->>'member_id')::uuid;
      if v_user is not null and v_user is distinct from new.actor_user_id then
        insert into public.notifications (user_id, group_id, type, title, body, data)
        values (v_user, new.group_id, 'payout_recorded', 'اتسجل قبضك',
                'الأدمن سجّل إنك استلمت قبضك من ' || v_group || '.', jsonb_build_object('href', v_href));
      end if;

    when 'group.completed' then
      insert into public.notifications (user_id, group_id, type, title, body, data)
      select a.user_id, new.group_id, 'group_completed', 'الجمعية خلصت',
             v_group || ' خلصت. كل الأدوار قبضت.', jsonb_build_object('href', v_href)
        from public.group_audience(new.group_id) a
       where a.user_id is distinct from new.actor_user_id;

    when 'role.set' then
      if new.entity_id is distinct from new.actor_user_id then
        insert into public.notifications (user_id, group_id, type, title, body, data)
        values (new.entity_id, new.group_id, 'role_set', 'دورك في الجمعية اتغيّر',
                'بقيت ' || case new.metadata->>'role' when 'admin' then 'أدمن' else 'محصّل' end
                || ' في ' || v_group || '.', jsonb_build_object('href', v_href));
      end if;

    when 'group.deleted' then
      -- No link: the association is no longer visible.
      insert into public.notifications (user_id, group_id, type, title, body, data)
      select a.user_id, null, 'group_deleted', 'جمعية اتمسحت',
             v_group || ' اتمسحت ومبقتش ظاهرة في جمعياتك.', '{}'::jsonb
        from public.group_audience(new.group_id) a
       where a.user_id is distinct from new.actor_user_id;

    else
      null;
  end case;

  return null;
end;
$$;

revoke execute on function public.notify_from_activity() from public, anon, authenticated;
