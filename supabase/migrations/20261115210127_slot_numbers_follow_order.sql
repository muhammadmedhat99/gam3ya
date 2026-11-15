-- Slot numbers follow the payout order: "اسم N" is the Nth turn.
--
-- Before: a slot kept its number forever and reordering moved "اسم 1" to position 5,
-- so the list read 2, 3, 4, 5, 1, 6… Admins think of the names as the turns, with the
-- PEOPLE moving between them. Now, after any reorder or slot-count change, active slots
-- are renumbered so slot_number = payout_order (1..N); their allocations (the people)
-- travel with them. Inactive slots are numbered after the active ones.
-- Turns whose cycle has started are locked by reorder_payouts, so their numbers never change.
-- History is unaffected: obligations, payments and payouts reference slot ids, not numbers.

-- ---------------------------------------------------------------------------
-- renumber_slots
-- ---------------------------------------------------------------------------

create or replace function public.renumber_slots(p_group_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_active integer;
begin
  select count(*) into v_active from public.group_slots where group_id = p_group_id and status <> 'inactive';

  -- Move out of the way first so unique (group_id, slot_number) never collides.
  update public.group_slots set slot_number = slot_number + 1000000 where group_id = p_group_id;

  with numbered as (
    select id, payout_order as n
      from public.group_slots where group_id = p_group_id and status <> 'inactive'
    union all
    select id, v_active + row_number() over (order by slot_number) as n
      from public.group_slots where group_id = p_group_id and status = 'inactive'
  )
  update public.group_slots s set slot_number = numbered.n from numbered where s.id = numbered.id;
end;
$$;

revoke execute on function public.renumber_slots(uuid) from public, anon, authenticated;
grant execute on function public.renumber_slots(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- reorder_payouts: same rules as before, then renumber. The audit log records the
-- order as the names were numbered before the change ("after": [3,1,2] = old name 3
-- is now first).
-- ---------------------------------------------------------------------------

create or replace function public.reorder_payouts(
  p_actor_user_id uuid,
  p_group_id      uuid,
  p_slot_ids      uuid[]
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_timezone text;
  v_expected integer;
  v_locked integer := 0;
  v_before jsonb;
  v_after jsonb;
begin
  perform public.require_group_manager(p_group_id, p_actor_user_id);

  select status, timezone into v_status, v_timezone from public.groups where id = p_group_id;
  if v_status in ('completed', 'cancelled') then
    raise exception 'group is closed' using errcode = '55000';
  end if;

  perform 1 from public.group_slots where group_id = p_group_id for update;

  select count(*) into v_expected
    from public.group_slots where group_id = p_group_id and status <> 'inactive';

  if coalesce(array_length(p_slot_ids, 1), 0) <> v_expected
     or (select count(distinct x) from unnest(p_slot_ids) x) <> v_expected
     or exists (
       select 1 from unnest(p_slot_ids) x
        where not exists (select 1 from public.group_slots s
                           where s.id = x and s.group_id = p_group_id and s.status <> 'inactive')
     ) then
    raise exception 'the new order must list every slot exactly once' using errcode = '22023';
  end if;

  if v_status = 'active' then
    select count(*) into v_locked
      from public.group_cycles
     where group_id = p_group_id
       and starts_on <= (now() at time zone v_timezone)::date;

    if exists (
      select 1
        from unnest(p_slot_ids) with ordinality as o(slot_id, ord)
        join public.group_slots s on s.id = o.slot_id
       where (o.ord <= v_locked or s.payout_order <= v_locked)
         and s.payout_order <> o.ord
    ) then
      raise exception 'past and current turns are locked' using errcode = '55000';
    end if;
  end if;

  select jsonb_agg(slot_number order by payout_order) into v_before
    from public.group_slots where group_id = p_group_id and status <> 'inactive';
  select jsonb_agg(s.slot_number order by o.ord) into v_after
    from unnest(p_slot_ids) with ordinality as o(slot_id, ord)
    join public.group_slots s on s.id = o.slot_id;

  update public.group_slots set payout_order = payout_order + 1000000
   where group_id = p_group_id and status <> 'inactive';

  update public.group_slots s
     set payout_order = o.ord
    from unnest(p_slot_ids) with ordinality as o(slot_id, ord)
   where s.id = o.slot_id;

  perform public.renumber_slots(p_group_id);

  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_group_id, p_actor_user_id, 'group.payout_order_changed', 'group', p_group_id,
          jsonb_build_object('before', v_before, 'after', v_after, 'locked_turns', v_locked));
end;
$$;

revoke execute on function public.reorder_payouts(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_payouts(uuid, uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- update_group_settings (same as before + renumber after resizing in draft)
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

    perform public.renumber_slots(p_group_id);
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
-- Bring existing groups in line once.
-- ---------------------------------------------------------------------------

select public.renumber_slots(id) from public.groups;
