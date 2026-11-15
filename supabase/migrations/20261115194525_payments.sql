-- Admin-only collections: payment records, reversals, and derived balances.
--
-- BUSINESS_RULES.md §7 and DATABASE.md §3.11, §8:
--   * a member may pay an obligation in several partial payments
--   * an obligation is paid only when valid payments cover the full amount due
--   * overdue = due date passed (group's time zone) and something still outstanding
--   * status is DERIVED (view obligation_balances), never a stored flag
--   * payment records are never updated or deleted; a mistake is corrected by a
--     reversal entry that cancels one payment in full
--   * recording: owner/admin/collector (or super admin); reversing: owner/admin only
-- Same access model: service_role only, RLS on, no policies. Members can never
-- reach any of this, not even their own status.

-- ---------------------------------------------------------------------------
-- Authorization helper: who may record collections
-- ---------------------------------------------------------------------------

create or replace function public.can_collect(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.group_roles
     where group_id = p_group_id and user_id = p_user_id and role in ('owner', 'admin', 'collector')
  ) or exists (
    select 1 from public.users
     where id = p_user_id and is_super_admin and status = 'active'
  );
$$;

revoke execute on function public.can_collect(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_collect(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- payment_records: append-only ledger
-- ---------------------------------------------------------------------------

create table public.payment_records (
  id                   uuid primary key default gen_random_uuid(),
  obligation_id        uuid not null references public.member_obligations (id) on delete restrict,
  kind                 text not null check (kind in ('payment', 'reversal')),
  amount               numeric(12,2) not null check (amount > 0),
  paid_on              date not null,
  method               text check (method in ('cash', 'transfer')),
  note                 text check (note is null or char_length(note) <= 200),
  reversal_of_id       uuid references public.payment_records (id) on delete restrict,
  recorded_by_user_id  uuid not null references public.users (id) on delete restrict,
  idempotency_key      uuid unique,
  created_at           timestamptz not null default now(),
  constraint payment_records_shape check (
    (kind = 'payment' and reversal_of_id is null and method is not null)
    or (kind = 'reversal' and reversal_of_id is not null and method is null
        and note is not null and char_length(btrim(note)) > 0)
  )
);

comment on column public.payment_records.amount is
  'Always positive. A reversal row cancels the payment it points to; net paid = payments − reversals.';

create unique index payment_records_one_reversal on public.payment_records (reversal_of_id)
  where reversal_of_id is not null;
create index payment_records_obligation_idx on public.payment_records (obligation_id, paid_on);
create index payment_records_recorded_by_idx on public.payment_records (recorded_by_user_id);

create or replace function public.prevent_payment_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'payment records are append-only; record a reversal instead' using errcode = '42501';
end;
$$;

revoke execute on function public.prevent_payment_changes() from public, anon, authenticated;

create trigger payment_records_append_only
  before update or delete on public.payment_records
  for each row execute function public.prevent_payment_changes();

-- ---------------------------------------------------------------------------
-- obligation_balances: derived paid / outstanding / status
-- ---------------------------------------------------------------------------

create view public.obligation_balances
with (security_invoker = true)
as
select o.id                                   as obligation_id,
       o.cycle_id,
       o.member_id,
       c.group_id,
       c.cycle_number,
       o.amount_due,
       o.due_on,
       net.paid_total,
       greatest(o.amount_due - net.paid_total, 0)::numeric(12,2) as outstanding,
       case
         when o.amount_due - net.paid_total <= 0 then 'paid'
         when o.due_on < (now() at time zone g.timezone)::date then 'overdue'
         when net.paid_total > 0 then 'partially_paid'
         else 'unpaid'
       end                                    as status
  from public.member_obligations o
  join public.group_cycles c on c.id = o.cycle_id
  join public.groups g on g.id = c.group_id
  cross join lateral (
    select coalesce(sum(case when p.kind = 'payment' then p.amount else -p.amount end), 0)::numeric(12,2)
             as paid_total
      from public.payment_records p
     where p.obligation_id = o.id
  ) net;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on table public.payment_records from anon, authenticated;
revoke all on table public.obligation_balances from anon, authenticated;

grant select, insert on table public.payment_records to service_role;
grant select on table public.obligation_balances to service_role;

alter table public.payment_records enable row level security;

-- ---------------------------------------------------------------------------
-- record_payment
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

  select c.group_id, g.status, g.timezone, o.amount_due, o.member_id, c.cycle_number
    into v_group_id, v_group_status, v_timezone, v_amount_due, v_member_id, v_cycle_number
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

revoke execute on function public.record_payment(uuid, uuid, numeric, date, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_payment(uuid, uuid, numeric, date, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- reverse_payment: cancel one payment in full with an auditable reversal entry
-- ---------------------------------------------------------------------------

create or replace function public.reverse_payment(
  p_actor_user_id uuid,
  p_payment_id    uuid,
  p_reason        text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_payment public.payment_records%rowtype;
  v_group_id uuid;
  v_timezone text;
  v_reversal_id uuid;
begin
  select * into v_payment from public.payment_records where id = p_payment_id;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  -- Same per-obligation lock as record_payment; the unique index on
  -- reversal_of_id also guarantees a payment is reversed at most once.
  perform pg_advisory_xact_lock(hashtextextended('obligation:' || v_payment.obligation_id::text, 0));

  select c.group_id, g.timezone into v_group_id, v_timezone
    from public.member_obligations o
    join public.group_cycles c on c.id = o.cycle_id
    join public.groups g on g.id = c.group_id
   where o.id = v_payment.obligation_id;

  perform public.require_group_manager(v_group_id, p_actor_user_id);

  if v_payment.kind <> 'payment' then
    raise exception 'only payments can be reversed' using errcode = '22023';
  end if;
  if exists (select 1 from public.payment_records where reversal_of_id = p_payment_id) then
    raise exception 'payment already reversed' using errcode = '55000';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;

  insert into public.payment_records (
    obligation_id, kind, amount, paid_on, method, note, reversal_of_id, recorded_by_user_id
  )
  values (
    v_payment.obligation_id, 'reversal', v_payment.amount, (now() at time zone v_timezone)::date,
    null, btrim(p_reason), p_payment_id, p_actor_user_id
  )
  returning id into v_reversal_id;

  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_group_id, p_actor_user_id, 'payment.reversed', 'payment_record', v_reversal_id,
          jsonb_build_object('reversal_of', p_payment_id, 'amount', v_payment.amount));

  return v_reversal_id;
end;
$$;

revoke execute on function public.reverse_payment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reverse_payment(uuid, uuid, text) to service_role;
