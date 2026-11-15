-- Cycles, member obligations, and starting (activating) a group.
--
-- BUSINESS_RULES.md §5–6, DATABASE.md §3.9–3.10 and §10:
--   * cycles = active slots; cycle N pays the slot at payout position N
--   * monthly cycles, or every 15 days counted from start_date
--   * each cycle snapshots what every member owes (sum of their allocations),
--     so later changes can never rewrite history
--   * a group starts only when every slot is fully allocated
--   * payout records are created when a payout is recorded (payments migration),
--     using the payout order at that time
-- Same access model as before: service_role only, RLS on, no policies.

-- ---------------------------------------------------------------------------
-- Schedule (must match src/lib/schedule.ts buildSchedule)
-- ---------------------------------------------------------------------------

create or replace function public.group_schedule(
  p_start_date date,
  p_frequency  text,
  p_due_day    integer,
  p_cycles     integer
)
returns table (cycle_number integer, starts_on date, due_on date, ends_on date)
language sql
immutable
set search_path = ''
as $$
  with s as (
    select n,
           case when p_frequency = 'monthly'
                then (p_start_date + make_interval(months => n - 1))::date
                else p_start_date + 15 * (n - 1) end as starts_on,
           case when p_frequency = 'monthly'
                then (p_start_date + make_interval(months => n))::date
                else p_start_date + 15 * n end as next_start
      from generate_series(1, p_cycles) as n
  )
  select n,
         starts_on,
         case
           when p_frequency = 'semi_monthly' then starts_on + p_due_day
           -- monthly: the first p_due_day on or after the cycle start
           when make_date(extract(year from starts_on)::int, extract(month from starts_on)::int, p_due_day) >= starts_on
             then make_date(extract(year from starts_on)::int, extract(month from starts_on)::int, p_due_day)
           else (make_date(extract(year from starts_on)::int, extract(month from starts_on)::int, p_due_day)
                 + interval '1 month')::date
         end,
         next_start - 1
    from s
   order by n;
$$;

revoke execute on function public.group_schedule(date, text, integer, integer) from public, anon, authenticated;
grant execute on function public.group_schedule(date, text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- group_cycles
-- ---------------------------------------------------------------------------

create table public.group_cycles (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id) on delete restrict,
  cycle_number  integer not null check (cycle_number > 0),
  starts_on     date not null,
  due_on        date not null,
  ends_on       date not null,
  -- Which cycle is running is derived from dates; status only records closure.
  status        text not null default 'scheduled' check (status in ('scheduled', 'closed', 'cancelled')),
  created_at    timestamptz not null default now(),
  unique (group_id, cycle_number),
  check (due_on >= starts_on),
  check (ends_on >= starts_on)
);

create index group_cycles_group_dates_idx on public.group_cycles (group_id, starts_on);

-- ---------------------------------------------------------------------------
-- member_obligations: immutable snapshot of what each member owes per cycle
-- ---------------------------------------------------------------------------

create table public.member_obligations (
  id          uuid primary key default gen_random_uuid(),
  cycle_id    uuid not null references public.group_cycles (id) on delete restrict,
  member_id   uuid not null references public.group_members (id) on delete restrict,
  amount_due  numeric(12,2) not null check (amount_due >= 0),
  due_on      date not null,
  created_at  timestamptz not null default now(),
  unique (cycle_id, member_id)
);

create index member_obligations_member_idx on public.member_obligations (member_id);

create or replace function public.prevent_obligation_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'member obligations are an immutable snapshot; use adjustments' using errcode = '42501';
end;
$$;

revoke execute on function public.prevent_obligation_changes() from public, anon, authenticated;

create trigger member_obligations_immutable
  before update or delete on public.member_obligations
  for each row execute function public.prevent_obligation_changes();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on table public.group_cycles, public.member_obligations from anon, authenticated;

grant select, insert, update on table public.group_cycles to service_role;
grant select, insert on table public.member_obligations to service_role;

alter table public.group_cycles enable row level security;
alter table public.member_obligations enable row level security;

-- ---------------------------------------------------------------------------
-- activate_group: draft → active, generating cycles and obligation snapshots
-- ---------------------------------------------------------------------------

create or replace function public.activate_group(
  p_actor_user_id uuid,
  p_group_id      uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_slots integer;
  v_unbalanced integer;
  v_pot numeric(12,2);
begin
  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  perform public.require_group_manager(p_group_id, p_actor_user_id);

  if v_group.status <> 'draft' then
    raise exception 'group already started' using errcode = '55000';
  end if;

  perform 1 from public.group_slots where group_id = p_group_id for update;

  select count(*) into v_slots
    from public.group_slots where group_id = p_group_id and status <> 'inactive';
  if v_slots < 2 then
    raise exception 'a group needs at least 2 slots' using errcode = '22023';
  end if;

  -- Payout positions must be exactly 1..N.
  if exists (
    select 1 from public.group_slots
     where group_id = p_group_id and status <> 'inactive'
       and (payout_order < 1 or payout_order > v_slots)
  ) then
    raise exception 'payout order must be 1..N' using errcode = '22023';
  end if;

  select count(*) into v_unbalanced
    from (
      select s.id
        from public.group_slots s
        left join public.slot_allocations a on a.slot_id = s.id
       where s.group_id = p_group_id and s.status <> 'inactive'
       group by s.id
      having coalesce(sum(a.amount), 0) <> v_group.slot_amount
    ) x;
  if v_unbalanced > 0 then
    raise exception 'every slot must be fully allocated' using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.slot_allocations a
      join public.group_slots s on s.id = a.slot_id
      join public.group_members m on m.id = a.member_id
     where s.group_id = p_group_id and s.status <> 'inactive' and m.status <> 'active'
  ) then
    raise exception 'an allocation belongs to an inactive member' using errcode = '23514';
  end if;

  insert into public.group_cycles (group_id, cycle_number, starts_on, due_on, ends_on)
  select p_group_id, sch.cycle_number, sch.starts_on, sch.due_on, sch.ends_on
    from public.group_schedule(v_group.start_date, v_group.frequency, v_group.collection_due_day, v_slots) sch;

  insert into public.member_obligations (cycle_id, member_id, amount_due, due_on)
  select c.id, owed.member_id, owed.amount, c.due_on
    from public.group_cycles c
   cross join (
     select a.member_id, sum(a.amount) as amount
       from public.slot_allocations a
       join public.group_slots s on s.id = a.slot_id
      where s.group_id = p_group_id and s.status <> 'inactive'
      group by a.member_id
   ) owed
   where c.group_id = p_group_id;

  update public.group_slots set status = 'active'
   where group_id = p_group_id and status = 'draft';

  update public.groups set status = 'active' where id = p_group_id;

  v_pot := v_group.slot_amount * v_slots;

  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_group_id, p_actor_user_id, 'group.activated', 'group', p_group_id,
          jsonb_build_object('cycles', v_slots, 'pot_per_cycle', v_pot));
end;
$$;

revoke execute on function public.activate_group(uuid, uuid) from public, anon, authenticated;
grant execute on function public.activate_group(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- reorder_payouts (replaces the draft-only version): once the group is active,
-- every turn whose cycle has already started is fixed in place.
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

  update public.group_slots set payout_order = payout_order + 1000000
   where group_id = p_group_id and status <> 'inactive';

  update public.group_slots s
     set payout_order = o.ord
    from unnest(p_slot_ids) with ordinality as o(slot_id, ord)
   where s.id = o.slot_id;

  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_group_id, p_actor_user_id, 'group.payout_order_changed', 'group', p_group_id,
          jsonb_build_object(
            'before', v_before,
            'after', (select jsonb_agg(slot_number order by payout_order)
                        from public.group_slots where group_id = p_group_id and status <> 'inactive'),
            'locked_turns', v_locked
          ));
end;
$$;

revoke execute on function public.reorder_payouts(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_payouts(uuid, uuid, uuid[]) to service_role;
