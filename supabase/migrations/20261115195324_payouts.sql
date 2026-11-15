-- Payouts: the slot whose turn it is receives the cycle's pot, split by share.
--
-- BUSINESS_RULES.md §5, §8 and DATABASE.md §3.12–3.13, §8, §10:
--   * cycle N pays the slot at payout position N, once
--   * pot = sum of the cycle's member obligations (slot amount × slots)
--   * each owner gets pot × allocation / slot_amount, rounded down to the
--     piaster; leftover piasters go to the largest allocation (ties: earliest
--     created, then member id) — identical to src/lib/money.ts splitPot
--   * the payout and its per-owner split are an immutable snapshot taken the
--     first time an admin records a payout for that cycle
--   * money handed over is an append-only ledger (payout_disbursements);
--     mistakes are corrected with reversal entries
--   * payout status is derived (view payout_allocation_balances)
--   * owner/admin only (not collectors); the cycle must have started
-- Same access model: service_role only, RLS on, no policies.

-- ---------------------------------------------------------------------------
-- payout_records: one per cycle, snapshot of whose turn it is and the pot
-- ---------------------------------------------------------------------------

create table public.payout_records (
  id                  uuid primary key default gen_random_uuid(),
  group_id            uuid not null references public.groups (id) on delete restrict,
  cycle_id            uuid not null unique references public.group_cycles (id) on delete restrict,
  slot_id             uuid not null unique references public.group_slots (id) on delete restrict,
  expected_amount     numeric(12,2) not null check (expected_amount > 0),
  created_by_user_id  uuid not null references public.users (id) on delete restrict,
  created_at          timestamptz not null default now()
);

create index payout_records_group_idx on public.payout_records (group_id);

-- ---------------------------------------------------------------------------
-- payout_allocations: each owner's entitlement for that payout (snapshot)
-- ---------------------------------------------------------------------------

create table public.payout_allocations (
  id                  uuid primary key default gen_random_uuid(),
  payout_id           uuid not null references public.payout_records (id) on delete restrict,
  slot_allocation_id  uuid not null references public.slot_allocations (id) on delete restrict,
  member_id           uuid not null references public.group_members (id) on delete restrict,
  share_amount        numeric(12,2) not null check (share_amount > 0),
  expected_amount     numeric(12,2) not null check (expected_amount > 0),
  created_at          timestamptz not null default now(),
  unique (payout_id, member_id)
);

create index payout_allocations_member_idx on public.payout_allocations (member_id);

-- ---------------------------------------------------------------------------
-- payout_disbursements: append-only ledger of money handed to each owner
-- ---------------------------------------------------------------------------

create table public.payout_disbursements (
  id                    uuid primary key default gen_random_uuid(),
  payout_allocation_id  uuid not null references public.payout_allocations (id) on delete restrict,
  kind                  text not null check (kind in ('payment', 'reversal')),
  amount                numeric(12,2) not null check (amount > 0),
  paid_on               date not null,
  method                text check (method in ('cash', 'transfer')),
  note                  text check (note is null or char_length(note) <= 200),
  reversal_of_id        uuid references public.payout_disbursements (id) on delete restrict,
  recorded_by_user_id   uuid not null references public.users (id) on delete restrict,
  idempotency_key       uuid unique,
  created_at            timestamptz not null default now(),
  constraint payout_disbursements_shape check (
    (kind = 'payment' and reversal_of_id is null and method is not null)
    or (kind = 'reversal' and reversal_of_id is not null and method is null
        and note is not null and char_length(btrim(note)) > 0)
  )
);

create unique index payout_disbursements_one_reversal on public.payout_disbursements (reversal_of_id)
  where reversal_of_id is not null;
create index payout_disbursements_allocation_idx on public.payout_disbursements (payout_allocation_id, paid_on);

-- Snapshots and ledger are immutable.
create or replace function public.prevent_payout_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'payout records are immutable; record a reversal instead' using errcode = '42501';
end;
$$;

revoke execute on function public.prevent_payout_changes() from public, anon, authenticated;

create trigger payout_records_immutable
  before update or delete on public.payout_records
  for each row execute function public.prevent_payout_changes();
create trigger payout_allocations_immutable
  before update or delete on public.payout_allocations
  for each row execute function public.prevent_payout_changes();
create trigger payout_disbursements_append_only
  before update or delete on public.payout_disbursements
  for each row execute function public.prevent_payout_changes();

-- ---------------------------------------------------------------------------
-- payout_allocation_balances: derived received / remaining / status
-- ---------------------------------------------------------------------------

create view public.payout_allocation_balances
with (security_invoker = true)
as
select pa.id                                   as payout_allocation_id,
       pa.payout_id,
       pr.group_id,
       pr.cycle_id,
       pa.member_id,
       pa.share_amount,
       pa.expected_amount,
       net.paid_total,
       greatest(pa.expected_amount - net.paid_total, 0)::numeric(12,2) as outstanding,
       case
         when pa.expected_amount - net.paid_total <= 0 then 'paid'
         when net.paid_total > 0 then 'partially_paid'
         else 'pending'
       end                                     as status
  from public.payout_allocations pa
  join public.payout_records pr on pr.id = pa.payout_id
  cross join lateral (
    select coalesce(sum(case when d.kind = 'payment' then d.amount else -d.amount end), 0)::numeric(12,2)
             as paid_total
      from public.payout_disbursements d
     where d.payout_allocation_id = pa.id
  ) net;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on table public.payout_records, public.payout_allocations, public.payout_disbursements
  from anon, authenticated;
revoke all on table public.payout_allocation_balances from anon, authenticated;

grant select, insert on table public.payout_records to service_role;
grant select, insert on table public.payout_allocations to service_role;
grant select, insert on table public.payout_disbursements to service_role;
grant select on table public.payout_allocation_balances to service_role;

alter table public.payout_records enable row level security;
alter table public.payout_allocations enable row level security;
alter table public.payout_disbursements enable row level security;

-- ---------------------------------------------------------------------------
-- ensure_payout: create (once) the payout snapshot for a started cycle
-- ---------------------------------------------------------------------------

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
begin
  perform pg_advisory_xact_lock(hashtextextended('payout-cycle:' || p_cycle_id::text, 0));

  select c.group_id, g.status, g.timezone, g.slot_amount, c.cycle_number, c.starts_on
    into v_group_id, v_status, v_timezone, v_slot_amount, v_cycle_number, v_starts_on
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

  select sum(amount_due) into v_pot from public.member_obligations where cycle_id = p_cycle_id;

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

revoke execute on function public.ensure_payout(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_payout(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- record_payout_disbursement: money handed to one owner (partial allowed)
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

  select pr.group_id, g.timezone, pa.expected_amount, pa.member_id
    into v_group_id, v_timezone, v_expected, v_member_id
    from public.payout_allocations pa
    join public.payout_records pr on pr.id = pa.payout_id
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

  return v_id;
end;
$$;

revoke execute on function public.record_payout_disbursement(uuid, uuid, numeric, date, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_payout_disbursement(uuid, uuid, numeric, date, text, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- reverse_payout_disbursement
-- ---------------------------------------------------------------------------

create or replace function public.reverse_payout_disbursement(
  p_actor_user_id    uuid,
  p_disbursement_id  uuid,
  p_reason           text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_d public.payout_disbursements%rowtype;
  v_group_id uuid;
  v_timezone text;
  v_id uuid;
begin
  select * into v_d from public.payout_disbursements where id = p_disbursement_id;
  if not found then
    raise exception 'disbursement not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('payout-allocation:' || v_d.payout_allocation_id::text, 0));

  select pr.group_id, g.timezone into v_group_id, v_timezone
    from public.payout_allocations pa
    join public.payout_records pr on pr.id = pa.payout_id
    join public.groups g on g.id = pr.group_id
   where pa.id = v_d.payout_allocation_id;

  perform public.require_group_manager(v_group_id, p_actor_user_id);

  if v_d.kind <> 'payment' then
    raise exception 'only payments can be reversed' using errcode = '22023';
  end if;
  if exists (select 1 from public.payout_disbursements where reversal_of_id = p_disbursement_id) then
    raise exception 'disbursement already reversed' using errcode = '55000';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;

  insert into public.payout_disbursements (
    payout_allocation_id, kind, amount, paid_on, method, note, reversal_of_id, recorded_by_user_id
  )
  values (
    v_d.payout_allocation_id, 'reversal', v_d.amount, (now() at time zone v_timezone)::date,
    null, btrim(p_reason), p_disbursement_id, p_actor_user_id
  )
  returning id into v_id;

  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_group_id, p_actor_user_id, 'payout.reversed', 'payout_disbursement', v_id,
          jsonb_build_object('reversal_of', p_disbursement_id, 'amount', v_d.amount));

  return v_id;
end;
$$;

revoke execute on function public.reverse_payout_disbursement(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reverse_payout_disbursement(uuid, uuid, text) to service_role;
