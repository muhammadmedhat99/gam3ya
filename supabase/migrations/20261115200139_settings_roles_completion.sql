-- Group settings, roles, and completion.
--
--   * update_group_settings: name anytime; amount / slot count / schedule in draft only.
--     Shrinking the slot count deactivates the highest-numbered slots and is refused
--     if any of them still has shares; growing reactivates or appends slots.
--   * set_group_role / remove_group_role: only the owner manages admins; owners and
--     admins manage collectors; the owner can't be changed or removed. Roles go to
--     members of the group with a linked account.
--   * complete_group: admin closes an active group once its last cycle has started.
--   * record_payout_disbursement now also completes the group automatically when the
--     last cycle's payout is fully handed over.
-- Same access model: service_role only; every function re-checks the actor.

-- ---------------------------------------------------------------------------
-- Helper: owner (or super admin)
-- ---------------------------------------------------------------------------

create or replace function public.is_group_owner(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.group_roles where group_id = p_group_id and user_id = p_user_id and role = 'owner'
  ) or exists (
    select 1 from public.users where id = p_user_id and is_super_admin and status = 'active'
  );
$$;

revoke execute on function public.is_group_owner(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_group_owner(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- update_group_settings
-- ---------------------------------------------------------------------------

create or replace function public.update_group_settings(
  p_actor_user_id      uuid,
  p_group_id           uuid,
  p_name               text,
  p_slot_amount        numeric,
  p_target_slot_count  integer,
  p_frequency          text,
  p_start_date         date,
  p_collection_due_day integer
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_current integer;
  v_max_order integer;
  v_max_number integer;
  v_to_add integer;
  v_reactivate integer;
begin
  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  perform public.require_group_manager(p_group_id, p_actor_user_id);

  if v_group.status in ('completed', 'cancelled') then
    raise exception 'group is closed' using errcode = '55000';
  end if;

  -- After the start only the name may change (protect_group_config enforces it too).
  if v_group.status <> 'draft' then
    if p_slot_amount is distinct from v_group.slot_amount
       or p_target_slot_count is distinct from v_group.target_slot_count
       or p_frequency is distinct from v_group.frequency
       or p_start_date is distinct from v_group.start_date
       or p_collection_due_day is distinct from v_group.collection_due_day then
      raise exception 'group settings are locked after the group starts' using errcode = '55000';
    end if;
    update public.groups set name = btrim(p_name) where id = p_group_id;
  else
    if p_slot_amount <> round(p_slot_amount, 2) then
      raise exception 'amount has more than 2 decimals' using errcode = '22023';
    end if;

    update public.groups
       set name = btrim(p_name),
           slot_amount = p_slot_amount,
           target_slot_count = p_target_slot_count,
           frequency = p_frequency,
           start_date = p_start_date,
           collection_due_day = p_collection_due_day
     where id = p_group_id;

    perform 1 from public.group_slots where group_id = p_group_id for update;
    select count(*) into v_current from public.group_slots where group_id = p_group_id and status <> 'inactive';

    if p_target_slot_count < v_current then
      if exists (
        select 1 from public.slot_allocations a
         where a.slot_id in (
           select id from public.group_slots
            where group_id = p_group_id and status <> 'inactive'
            order by slot_number desc
            limit v_current - p_target_slot_count
         )
      ) then
        raise exception 'slots to remove still have shares' using errcode = '23514';
      end if;

      update public.group_slots set status = 'inactive'
       where id in (
         select id from public.group_slots
          where group_id = p_group_id and status <> 'inactive'
          order by slot_number desc
          limit v_current - p_target_slot_count
       );

    elsif p_target_slot_count > v_current then
      v_to_add := p_target_slot_count - v_current;
      select coalesce(max(payout_order), 0) into v_max_order
        from public.group_slots where group_id = p_group_id and status <> 'inactive';

      -- Reuse inactive slots first (lowest numbers), then append new ones.
      with revived as (
        select id, row_number() over (order by slot_number) as rn
          from public.group_slots
         where group_id = p_group_id and status = 'inactive'
         order by slot_number
         limit v_to_add
      )
      update public.group_slots s
         set status = 'draft', payout_order = v_max_order + r.rn
        from revived r
       where s.id = r.id;
      get diagnostics v_reactivate = row_count;

      select coalesce(max(slot_number), 0) into v_max_number from public.group_slots where group_id = p_group_id;

      insert into public.group_slots (group_id, slot_number, payout_order)
      select p_group_id, v_max_number + n, v_max_order + v_reactivate + n
        from generate_series(1, v_to_add - v_reactivate) as n;
    end if;

    -- Keep payout positions exactly 1..N in their current relative order.
    update public.group_slots set payout_order = payout_order + 1000000
     where group_id = p_group_id and status <> 'inactive';
    with ordered as (
      select id, row_number() over (order by payout_order) as rn
        from public.group_slots where group_id = p_group_id and status <> 'inactive'
    )
    update public.group_slots s set payout_order = o.rn from ordered o where s.id = o.id;
  end if;

  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_group_id, p_actor_user_id, 'group.settings_changed', 'group', p_group_id,
          jsonb_build_object(
            'before', jsonb_build_object('name', v_group.name, 'slot_amount', v_group.slot_amount,
                                         'slots', v_group.target_slot_count, 'frequency', v_group.frequency,
                                         'start_date', v_group.start_date, 'due_day', v_group.collection_due_day),
            'after', jsonb_build_object('name', btrim(p_name), 'slot_amount', p_slot_amount,
                                        'slots', p_target_slot_count, 'frequency', p_frequency,
                                        'start_date', p_start_date, 'due_day', p_collection_due_day)
          ));
end;
$$;

revoke execute on function public.update_group_settings(uuid, uuid, text, numeric, integer, text, date, integer)
  from public, anon, authenticated;
grant execute on function public.update_group_settings(uuid, uuid, text, numeric, integer, text, date, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

create or replace function public.set_group_role(
  p_actor_user_id uuid,
  p_group_id      uuid,
  p_user_id       uuid,
  p_role          text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_current text;
begin
  if p_role not in ('admin', 'collector') then
    raise exception 'role must be admin or collector' using errcode = '22023';
  end if;

  perform public.require_group_manager(p_group_id, p_actor_user_id);

  select role into v_current from public.group_roles where group_id = p_group_id and user_id = p_user_id;
  if v_current = 'owner' then
    raise exception 'the owner role cannot be changed' using errcode = '55000';
  end if;
  if (p_role = 'admin' or v_current = 'admin') and not public.is_group_owner(p_group_id, p_actor_user_id) then
    raise exception 'only the owner manages admins' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.group_members
     where group_id = p_group_id and user_id = p_user_id and status = 'active'
  ) then
    raise exception 'roles go to members with a linked account' using errcode = '23514';
  end if;

  insert into public.group_roles (group_id, user_id, role)
  values (p_group_id, p_user_id, p_role)
  on conflict (group_id, user_id) do update set role = excluded.role;

  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_group_id, p_actor_user_id, 'role.set', 'user', p_user_id,
          jsonb_build_object('role', p_role, 'previous', v_current));
end;
$$;

revoke execute on function public.set_group_role(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_group_role(uuid, uuid, uuid, text) to service_role;

create or replace function public.remove_group_role(
  p_actor_user_id uuid,
  p_group_id      uuid,
  p_user_id       uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_current text;
begin
  perform public.require_group_manager(p_group_id, p_actor_user_id);

  select role into v_current from public.group_roles where group_id = p_group_id and user_id = p_user_id;
  if not found then
    raise exception 'role not found' using errcode = 'P0002';
  end if;
  if v_current = 'owner' then
    raise exception 'the owner role cannot be removed' using errcode = '55000';
  end if;
  if v_current = 'admin' and not public.is_group_owner(p_group_id, p_actor_user_id) then
    raise exception 'only the owner manages admins' using errcode = '42501';
  end if;

  delete from public.group_roles where group_id = p_group_id and user_id = p_user_id;

  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_group_id, p_actor_user_id, 'role.removed', 'user', p_user_id, jsonb_build_object('role', v_current));
end;
$$;

revoke execute on function public.remove_group_role(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_group_role(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- complete_group: manual close once the last cycle has started
-- ---------------------------------------------------------------------------

create or replace function public.complete_group(
  p_actor_user_id uuid,
  p_group_id      uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_timezone text;
  v_last_start date;
begin
  select status, timezone into v_status, v_timezone from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  perform public.require_group_manager(p_group_id, p_actor_user_id);

  if v_status <> 'active' then
    raise exception 'only an active group can be completed' using errcode = '55000';
  end if;

  select max(starts_on) into v_last_start from public.group_cycles where group_id = p_group_id;
  if v_last_start is null or v_last_start > (now() at time zone v_timezone)::date then
    raise exception 'the last cycle has not started yet' using errcode = '55000';
  end if;

  update public.groups set status = 'completed' where id = p_group_id;

  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_group_id, p_actor_user_id, 'group.completed', 'group', p_group_id, jsonb_build_object('auto', false));
end;
$$;

revoke execute on function public.complete_group(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_group(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- record_payout_disbursement (replaces the previous version): same rules, plus
-- automatic completion when the last cycle's payout is fully handed over.
-- ---------------------------------------------------------------------------

create or replace function public.record_payout_disbursement(
  p_actor_user_id         uuid,
  p_payout_allocation_id  uuid,
  p_amount                numeric,
  p_paid_on               date,
  p_method                text,
  p_note                  text default null,
  p_idempotency_key       uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_existing uuid;
  v_group_id uuid;
  v_timezone text;
  v_expected numeric(12,2);
  v_member_id uuid;
  v_payout_id uuid;
  v_cycle_number integer;
  v_last_cycle integer;
  v_paid numeric(12,2);
  v_id uuid;
begin
  if p_idempotency_key is not null then
    select id into v_existing from public.payout_disbursements
     where idempotency_key = p_idempotency_key and payout_allocation_id = p_payout_allocation_id
       and recorded_by_user_id = p_actor_user_id;
    if found then
      return v_existing;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('payout-allocation:' || p_payout_allocation_id::text, 0));

  select pr.group_id, g.timezone, pa.expected_amount, pa.member_id, pr.id, c.cycle_number
    into v_group_id, v_timezone, v_expected, v_member_id, v_payout_id, v_cycle_number
    from public.payout_allocations pa
    join public.payout_records pr on pr.id = pa.payout_id
    join public.group_cycles c on c.id = pr.cycle_id
    join public.groups g on g.id = pr.group_id
   where pa.id = p_payout_allocation_id;
  if not found then
    raise exception 'payout allocation not found' using errcode = 'P0002';
  end if;

  perform public.require_group_manager(v_group_id, p_actor_user_id);

  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'amount must be positive with at most 2 decimals' using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone v_timezone)::date then
    raise exception 'payout date is in the future' using errcode = '22023';
  end if;

  select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0)
    into v_paid from public.payout_disbursements where payout_allocation_id = p_payout_allocation_id;
  if p_amount > v_expected - v_paid then
    raise exception 'amount exceeds what is left to pay out' using errcode = '23514';
  end if;

  insert into public.payout_disbursements (
    payout_allocation_id, kind, amount, paid_on, method, note, recorded_by_user_id, idempotency_key
  )
  values (
    p_payout_allocation_id, 'payment', p_amount, p_paid_on, p_method, nullif(btrim(p_note), ''),
    p_actor_user_id, p_idempotency_key
  )
  returning id into v_id;

  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_group_id, p_actor_user_id, 'payout.recorded', 'payout_disbursement', v_id,
          jsonb_build_object('member_id', v_member_id, 'amount', p_amount));

  -- Last cycle fully paid out → the group is completed.
  select max(cycle_number) into v_last_cycle from public.group_cycles where group_id = v_group_id;
  if v_cycle_number = v_last_cycle and not exists (
    select 1 from public.payout_allocation_balances where payout_id = v_payout_id and status <> 'paid'
  ) then
    update public.groups set status = 'completed' where id = v_group_id and status = 'active';
    if found then
      insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
      values (v_group_id, p_actor_user_id, 'group.completed', 'group', v_group_id, jsonb_build_object('auto', true));
    end if;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.record_payout_disbursement(uuid, uuid, numeric, date, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_payout_disbursement(uuid, uuid, numeric, date, text, text, uuid)
  to service_role;
