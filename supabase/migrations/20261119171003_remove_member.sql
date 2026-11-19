-- Removing a member (BUSINESS_RULES.md §10, decided 2026-11-19).
--
--   * draft: the member leaves; their shares are removed ("ناقص") or handed to a
--     replacement member.
--   * started group, only if the member has paid nothing and none of their names
--     has had its turn yet:
--       - replaced: a replacement member takes all their shares and every unpaid
--         due (pays and receives in their place). Required when a name is shared.
--       - shrunk: their (fully owned) names are removed, later turns move up one
--         place each, the group has fewer names, and the last cycles are cancelled.
--   * dues are an immutable snapshot, so changes are recorded as auditable
--     obligation_adjustments (+/−); the effective due = amount_due + adjustments.
--   * the member keeps their row (status 'removed'), loses access and any admin/
--     collector role; only the owner may remove someone who is an admin.
-- Same access model: service_role only, RLS on, no policies.

-- ---------------------------------------------------------------------------
-- obligation_adjustments: append-only corrections to an obligation
-- ---------------------------------------------------------------------------

create table public.obligation_adjustments (
  id                  uuid primary key default gen_random_uuid(),
  obligation_id       uuid not null references public.member_obligations (id) on delete restrict,
  amount_delta        numeric(12,2) not null check (amount_delta <> 0),
  reason              text not null check (char_length(btrim(reason)) > 0),
  created_by_user_id  uuid not null references public.users (id) on delete restrict,
  created_at          timestamptz not null default now()
);

create index obligation_adjustments_obligation_idx on public.obligation_adjustments (obligation_id);

create trigger obligation_adjustments_immutable
  before update or delete on public.obligation_adjustments
  for each row execute function public.prevent_obligation_changes();

revoke all on table public.obligation_adjustments from anon, authenticated;
grant select, insert on table public.obligation_adjustments to service_role;
alter table public.obligation_adjustments enable row level security;

-- ---------------------------------------------------------------------------
-- obligation_balances: effective due, cancelled cycles excluded, 'cancelled' status
-- (same columns and order as before)
-- ---------------------------------------------------------------------------

create or replace view public.obligation_balances
with (security_invoker = true)
as
select o.id                                   as obligation_id,
       o.cycle_id,
       o.member_id,
       c.group_id,
       c.cycle_number,
       eff.amount_due,
       o.due_on,
       net.paid_total,
       greatest(eff.amount_due - net.paid_total, 0)::numeric(12,2) as outstanding,
       case
         when eff.amount_due = 0 and o.amount_due > 0 then 'cancelled'
         when eff.amount_due - net.paid_total <= 0 then 'paid'
         when o.due_on < (now() at time zone g.timezone)::date then 'overdue'
         when net.paid_total > 0 then 'partially_paid'
         else 'unpaid'
       end                                    as status
  from public.member_obligations o
  join public.group_cycles c on c.id = o.cycle_id
  join public.groups g on g.id = c.group_id
  cross join lateral (
    select (o.amount_due + coalesce(sum(ad.amount_delta), 0))::numeric(12,2) as amount_due
      from public.obligation_adjustments ad
     where ad.obligation_id = o.id
  ) eff
  cross join lateral (
    select coalesce(sum(case when p.kind = 'payment' then p.amount else -p.amount end), 0)::numeric(12,2)
             as paid_total
      from public.payment_records p
     where p.obligation_id = o.id
  ) net
 where c.status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- Triggers: allow remove_group_member (only) to touch a started group's shares
-- ---------------------------------------------------------------------------

create or replace function public.check_slot_allocation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_slot_group uuid;
  v_group_status text;
  v_member_group uuid;
  v_member_status text;
begin
  select s.group_id, g.status into v_slot_group, v_group_status
    from public.group_slots s join public.groups g on g.id = s.group_id
   where s.id = coalesce(new.slot_id, old.slot_id);

  -- remove_group_member may move/keep allocations of a started group (transaction-local flag).
  if v_group_status <> 'draft' and coalesce(current_setting('gam3ya.unlock_allocations', true), '') <> 'on' then
    raise exception 'allocations are locked after the group starts' using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  select group_id, status into v_member_group, v_member_status
    from public.group_members where id = new.member_id;

  if v_member_group is distinct from v_slot_group then
    raise exception 'member and slot belong to different groups' using errcode = '23514';
  end if;
  if v_member_status <> 'active' then
    raise exception 'member is not active' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.protect_group_config()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (
       new.slot_amount is distinct from old.slot_amount
    or (new.target_slot_count is distinct from old.target_slot_count
        and coalesce(current_setting('gam3ya.unlock_allocations', true), '') <> 'on')
    or new.frequency is distinct from old.frequency
    or new.start_date is distinct from old.start_date
    or new.collection_due_day is distinct from old.collection_due_day
    or new.owner_user_id is distinct from old.owner_user_id
  ) then
    raise exception 'group settings are locked after the group starts' using errcode = '55000';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- remove_group_member
-- ---------------------------------------------------------------------------

create or replace function public.remove_group_member(
  p_actor_user_id          uuid,
  p_member_id              uuid,
  p_replacement_member_id  uuid default null,
  p_reason                 text default null
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_member public.group_members%rowtype;
  v_group public.groups%rowtype;
  v_mode text;
  v_paid numeric(12,2);
  v_started integer;
  v_total integer;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'خروج عضو');
  r record;
begin
  select * into v_member from public.group_members where id = p_member_id for update;
  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  select * into v_group from public.groups where id = v_member.group_id for update;

  perform public.require_group_manager(v_group.id, p_actor_user_id);

  if v_member.status <> 'active' then
    raise exception 'member is not active' using errcode = '55000';
  end if;
  if v_group.status not in ('draft', 'active') then
    raise exception 'group is closed' using errcode = '55000';
  end if;
  if v_member.user_id is not null
     and exists (select 1 from public.group_roles
                  where group_id = v_group.id and user_id = v_member.user_id and role = 'admin')
     and not public.is_group_owner(v_group.id, p_actor_user_id) then
    raise exception 'only the owner can remove an admin' using errcode = '42501';
  end if;
  if p_replacement_member_id is not null and (
       p_replacement_member_id = p_member_id
       or not exists (select 1 from public.group_members
                       where id = p_replacement_member_id and group_id = v_group.id and status = 'active')
     ) then
    raise exception 'replacement must be another active member of the group' using errcode = '22023';
  end if;

  perform 1 from public.group_slots where group_id = v_group.id for update;

  if v_group.status = 'active' then
    select coalesce(sum(case when p.kind = 'payment' then p.amount else -p.amount end), 0) into v_paid
      from public.payment_records p
      join public.member_obligations o on o.id = p.obligation_id
     where o.member_id = p_member_id;
    if v_paid > 0 then
      raise exception 'member has already paid' using errcode = '55000';
    end if;

    select count(*) into v_started
      from public.group_cycles
     where group_id = v_group.id and status <> 'cancelled'
       and starts_on <= (now() at time zone v_group.timezone)::date;
    if exists (
      select 1 from public.slot_allocations a join public.group_slots s on s.id = a.slot_id
       where a.member_id = p_member_id and s.status <> 'inactive' and s.payout_order <= v_started
    ) then
      raise exception 'member turn already came' using errcode = '55000';
    end if;

    if p_replacement_member_id is null and exists (
      select 1 from public.slot_allocations a join public.group_slots s on s.id = a.slot_id
       where a.member_id = p_member_id and s.status <> 'inactive'
         and exists (select 1 from public.slot_allocations b where b.slot_id = a.slot_id and b.member_id <> p_member_id)
    ) then
      raise exception 'a shared slot needs a replacement' using errcode = '23514';
    end if;

    perform set_config('gam3ya.unlock_allocations', 'on', true);
  end if;

  -- 1) Shares
  if p_replacement_member_id is not null then
    -- Merge into the replacement's existing share of the same name, then hand over the rest.
    update public.slot_allocations b set amount = b.amount + a.amount
      from public.slot_allocations a
     where a.member_id = p_member_id and b.member_id = p_replacement_member_id and b.slot_id = a.slot_id;
    delete from public.slot_allocations a
     where a.member_id = p_member_id
       and exists (select 1 from public.slot_allocations b
                    where b.slot_id = a.slot_id and b.member_id = p_replacement_member_id);
    update public.slot_allocations set member_id = p_replacement_member_id where member_id = p_member_id;
    v_mode := 'replaced';
  elsif v_group.status = 'draft' then
    delete from public.slot_allocations where member_id = p_member_id;
    v_mode := 'removed';
  else
    v_mode := 'shrunk';
  end if;

  -- 2) Dues of a started group (snapshot rows stay; adjustments record the change)
  if v_group.status = 'active' then
    for r in
      select o.id, o.cycle_id, o.due_on,
             (o.amount_due + coalesce((select sum(ad.amount_delta) from public.obligation_adjustments ad
                                        where ad.obligation_id = o.id), 0))::numeric(12,2) as eff
        from public.member_obligations o
        join public.group_cycles c on c.id = o.cycle_id
       where o.member_id = p_member_id and c.status <> 'cancelled'
    loop
      continue when r.eff = 0;
      insert into public.obligation_adjustments (obligation_id, amount_delta, reason, created_by_user_id)
      values (r.id, -r.eff, v_reason, p_actor_user_id);

      if v_mode = 'replaced' then
        if exists (select 1 from public.member_obligations
                    where cycle_id = r.cycle_id and member_id = p_replacement_member_id) then
          insert into public.obligation_adjustments (obligation_id, amount_delta, reason, created_by_user_id)
          select id, r.eff, v_reason, p_actor_user_id
            from public.member_obligations
           where cycle_id = r.cycle_id and member_id = p_replacement_member_id;
        else
          insert into public.member_obligations (cycle_id, member_id, amount_due, due_on)
          values (r.cycle_id, p_replacement_member_id, r.eff, r.due_on);
        end if;
      end if;
    end loop;

    if v_mode = 'shrunk' then
      update public.group_slots s set status = 'inactive'
       where s.group_id = v_group.id and s.status <> 'inactive'
         and exists (select 1 from public.slot_allocations a where a.slot_id = s.id and a.member_id = p_member_id);

      -- Later turns move up one place each; names stay 1..N.
      update public.group_slots set payout_order = payout_order + 1000000
       where group_id = v_group.id and status <> 'inactive';
      with ordered as (
        select id, row_number() over (order by payout_order) as rn
          from public.group_slots where group_id = v_group.id and status <> 'inactive'
      )
      update public.group_slots s set payout_order = o.rn from ordered o where s.id = o.id;
      perform public.renumber_slots(v_group.id);

      select count(*) into v_total from public.group_slots where group_id = v_group.id and status <> 'inactive';
      if v_total < 2 then
        raise exception 'a group needs at least 2 names; use a replacement' using errcode = '23514';
      end if;
      update public.group_cycles set status = 'cancelled'
       where group_id = v_group.id and cycle_number > v_total and status <> 'cancelled';
      update public.groups set target_slot_count = v_total where id = v_group.id;
    end if;
  end if;

  -- 3) Membership, roles, pending requests
  update public.group_members set status = 'removed' where id = p_member_id;
  if v_member.user_id is not null then
    delete from public.group_roles
     where group_id = v_group.id and user_id = v_member.user_id and role in ('admin', 'collector');
  end if;
  update public.member_link_requests
     set status = 'cancelled', reviewed_by_user_id = p_actor_user_id, reviewed_at = now()
   where member_id = p_member_id and status = 'pending';

  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_group.id, p_actor_user_id, 'member.removed', 'group_member', p_member_id,
          jsonb_build_object('mode', v_mode, 'replacement_member_id', p_replacement_member_id, 'reason', v_reason));

  return v_mode;
end;
$$;

revoke execute on function public.remove_group_member(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.remove_group_member(uuid, uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Financial functions now use the effective due and skip cancelled cycles
-- ---------------------------------------------------------------------------

create or replace function public.record_payment(
  p_actor_user_id    uuid,
  p_obligation_id    uuid,
  p_amount           numeric,
  p_paid_on          date,
  p_method           text,
  p_note             text default null,
  p_idempotency_key  uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_existing uuid;
  v_group_id uuid;
  v_group_status text;
  v_timezone text;
  v_amount_due numeric(12,2);
  v_member_id uuid;
  v_cycle_number integer;
  v_paid numeric(12,2);
  v_payment_id uuid;
  v_cycle_status text;
begin
  -- A retried submit returns the payment it already created.
  if p_idempotency_key is not null then
    select id into v_existing from public.payment_records
     where idempotency_key = p_idempotency_key and obligation_id = p_obligation_id
       and recorded_by_user_id = p_actor_user_id;
    if found then
      return v_existing;
    end if;
  end if;

  -- Serialize payments on the same obligation (FOR UPDATE would need UPDATE
  -- privilege, which service_role deliberately doesn't have on this snapshot).
  perform pg_advisory_xact_lock(hashtextextended('obligation:' || p_obligation_id::text, 0));

  select c.group_id, g.status, g.timezone, (o.amount_due + coalesce((select sum(ad.amount_delta) from public.obligation_adjustments ad where ad.obligation_id = o.id), 0)), o.member_id, c.cycle_number, c.status
    into v_group_id, v_group_status, v_timezone, v_amount_due, v_member_id, v_cycle_number, v_cycle_status
    from public.member_obligations o
    join public.group_cycles c on c.id = o.cycle_id
    join public.groups g on g.id = c.group_id
   where o.id = p_obligation_id;
  if not found then
    raise exception 'obligation not found' using errcode = 'P0002';
  end if;

  if p_actor_user_id is null or not public.can_collect(v_group_id, p_actor_user_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_cycle_status = 'cancelled' then
    raise exception 'this cycle was cancelled' using errcode = '55000';
  end if;
  if v_group_status not in ('active', 'completed') then
    raise exception 'group is not active' using errcode = '55000';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'amount must be positive with at most 2 decimals' using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone v_timezone)::date then
    raise exception 'payment date is in the future' using errcode = '22023';
  end if;

  select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0)
    into v_paid from public.payment_records where obligation_id = p_obligation_id;

  if p_amount > v_amount_due - v_paid then
    raise exception 'amount exceeds outstanding' using errcode = '23514';
  end if;

  insert into public.payment_records (
    obligation_id, kind, amount, paid_on, method, note, recorded_by_user_id, idempotency_key
  )
  values (
    p_obligation_id, 'payment', p_amount, p_paid_on, p_method, nullif(btrim(p_note), ''),
    p_actor_user_id, p_idempotency_key
  )
  returning id into v_payment_id;

  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_group_id, p_actor_user_id, 'payment.recorded', 'payment_record', v_payment_id,
          jsonb_build_object('member_id', v_member_id, 'cycle', v_cycle_number, 'amount', p_amount));

  return v_payment_id;
end;
$$;

create or replace function public.ensure_payout(
  p_actor_user_id uuid,
  p_cycle_id      uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_status text;
  v_timezone text;
  v_slot_amount numeric(12,2);
  v_cycle_number integer;
  v_starts_on date;
  v_slot_id uuid;
  v_pot numeric(12,2);
  v_payout_id uuid;
  v_cycle_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended('payout-cycle:' || p_cycle_id::text, 0));

  select c.group_id, g.status, g.timezone, g.slot_amount, c.cycle_number, c.starts_on, c.status
    into v_group_id, v_status, v_timezone, v_slot_amount, v_cycle_number, v_starts_on, v_cycle_status
    from public.group_cycles c join public.groups g on g.id = c.group_id
   where c.id = p_cycle_id;
  if not found then
    raise exception 'cycle not found' using errcode = 'P0002';
  end if;

  perform public.require_group_manager(v_group_id, p_actor_user_id);

  select id into v_payout_id from public.payout_records where cycle_id = p_cycle_id;
  if found then
    return v_payout_id;
  end if;

  if v_cycle_status = 'cancelled' then
    raise exception 'this cycle was cancelled' using errcode = '55000';
  end if;
  if v_status not in ('active', 'completed') then
    raise exception 'group is not active' using errcode = '55000';
  end if;
  if v_starts_on > (now() at time zone v_timezone)::date then
    raise exception 'this cycle has not started yet' using errcode = '55000';
  end if;

  select id into v_slot_id
    from public.group_slots
   where group_id = v_group_id and status <> 'inactive' and payout_order = v_cycle_number;
  if not found then
    raise exception 'no slot at this payout position' using errcode = 'P0002';
  end if;

  select sum((o.amount_due + coalesce((select sum(ad.amount_delta) from public.obligation_adjustments ad where ad.obligation_id = o.id), 0))) into v_pot from public.member_obligations o where o.cycle_id = p_cycle_id;

  insert into public.payout_records (group_id, cycle_id, slot_id, expected_amount, created_by_user_id)
  values (v_group_id, p_cycle_id, v_slot_id, v_pot, p_actor_user_id)
  returning id into v_payout_id;

  with alloc as (
    select a.id, a.member_id, a.amount,
           trunc(v_pot * a.amount / v_slot_amount, 2) as share,
           row_number() over (order by a.amount desc, a.created_at asc, a.member_id asc) as rk
      from public.slot_allocations a
     where a.slot_id = v_slot_id
  ),
  leftover as (
    select v_pot - sum(share) as amount from alloc
  )
  insert into public.payout_allocations (payout_id, slot_allocation_id, member_id, share_amount, expected_amount)
  select v_payout_id, alloc.id, alloc.member_id, alloc.amount,
         alloc.share + case when alloc.rk = 1 then leftover.amount else 0 end
    from alloc cross join leftover;

  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_group_id, p_actor_user_id, 'payout.opened', 'payout_record', v_payout_id,
          jsonb_build_object('cycle', v_cycle_number, 'slot_id', v_slot_id, 'pot', v_pot));

  return v_payout_id;
end;
$$;

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
  select max(cycle_number) into v_last_cycle from public.group_cycles where group_id = v_group_id and status <> 'cancelled';
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

  select max(starts_on) into v_last_start from public.group_cycles where group_id = p_group_id and status <> 'cancelled';
  if v_last_start is null or v_last_start > (now() at time zone v_timezone)::date then
    raise exception 'the last cycle has not started yet' using errcode = '55000';
  end if;

  update public.groups set status = 'completed' where id = p_group_id;

  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_group_id, p_actor_user_id, 'group.completed', 'group', p_group_id, jsonb_build_object('auto', false));
end;
$$;

create or replace function public.notify_daily()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_rows integer;
begin
  -- 1) "دورك قرّب": the owners of the slot whose cycle starts in 3 days.
  insert into public.notifications (user_id, group_id, type, title, body, data, dedupe_key)
  select gm.user_id, g.id, 'turn_soon', 'دورك قرّب',
         g.name || ': دور اسم ' || s.slot_number || ' في القبض، آخر ميعاد ' || to_char(c.due_on, 'FMDD/FMMM/YYYY') || '.',
         jsonb_build_object('href', '/groups/' || g.id),
         'turn_soon:' || c.id
    from public.groups g
    join public.group_cycles c on c.group_id = g.id
    join public.group_slots s on s.group_id = g.id and s.status <> 'inactive' and s.payout_order = c.cycle_number
    join public.slot_allocations a on a.slot_id = s.id
    join public.group_members gm on gm.id = a.member_id and gm.user_id is not null and gm.status = 'active'
   where g.status = 'active'
     and c.status <> 'cancelled'
     and c.starts_on = (now() at time zone g.timezone)::date + 3
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  -- 2) Staff: collection due tomorrow.
  insert into public.notifications (user_id, group_id, type, title, body, data, dedupe_key)
  select st.user_id, g.id, 'due_tomorrow', 'آخر ميعاد التحصيل بكرة',
         g.name || ': الدورة ' || c.cycle_number || '. راجع مين لسه مدفعش.',
         jsonb_build_object('href', '/groups/' || g.id || '/collection'),
         'due_tomorrow:' || c.id
    from public.groups g
    join public.group_cycles c on c.group_id = g.id
    cross join lateral public.group_staff(g.id, true) st
   where g.status = 'active'
     and c.status <> 'cancelled'
     and c.due_on = (now() at time zone g.timezone)::date + 1
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  -- 3) Staff: overdue the day after the deadline (admin-only detail).
  insert into public.notifications (user_id, group_id, type, title, body, data, dedupe_key)
  select st.user_id, od.group_id, 'overdue', 'في متأخرين',
         od.name || ': ' || od.n || ' متأخرين في الدورة ' || od.cycle_number || '.',
         jsonb_build_object('href', '/groups/' || od.group_id || '/collection?cycle=' || od.cycle_number),
         'overdue:' || od.cycle_id
    from (
      select g.id as group_id, g.name, c.id as cycle_id, c.cycle_number, count(*) as n
        from public.groups g
        join public.group_cycles c on c.group_id = g.id
        join public.obligation_balances b on b.cycle_id = c.id and b.status = 'overdue'
       where g.status = 'active'
         and c.due_on = (now() at time zone g.timezone)::date - 1
       group by g.id, g.name, c.id, c.cycle_number
    ) od
    cross join lateral public.group_staff(od.group_id, true) st
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Notifications: removed member, and the replacement who got their shares
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

    when 'member.removed' then
      select user_id into v_user from public.group_members where id = new.entity_id;
      if v_user is not null and v_user is distinct from new.actor_user_id then
        insert into public.notifications (user_id, group_id, type, title, body, data)
        values (v_user, null, 'member_removed', 'اتشلت من جمعية',
                'الأدمن شالك من ' || v_group || '. لو ده غلط، كلّمه.', '{}'::jsonb);
      end if;
      if new.metadata->>'replacement_member_id' is not null then
        select user_id into v_user from public.group_members where id = (new.metadata->>'replacement_member_id')::uuid;
        if v_user is not null and v_user is distinct from new.actor_user_id then
          insert into public.notifications (user_id, group_id, type, title, body, data)
          values (v_user, new.group_id, 'shares_transferred', 'بقيت مكان حد في الجمعية',
                  'اتنقلتلك حصص في ' || v_group || '. هتلاقي نصيبك وميعاد دورك في صفحتها.', jsonb_build_object('href', v_href));
        end if;
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
