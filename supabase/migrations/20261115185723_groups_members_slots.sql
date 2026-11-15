-- Groups (associations), members, roles, link requests, slots and allocations.
-- Same access model as the auth migration: service_role only, RLS on, no
-- policies. Multi-step changes go through the functions at the bottom so they
-- are atomic and audited.
--
-- Rules implemented here (BUSINESS_RULES.md §3–5, §10; DATABASE.md §10):
--   * a slot is not a person; allocations split it among members
--   * slot allocations must sum to the slot amount exactly (or be empty in draft)
--   * configuration (amount, slots, schedule, allocations) is editable in draft only
--   * a phone match never links an account by itself: admin approval is required

-- ---------------------------------------------------------------------------
-- groups
-- ---------------------------------------------------------------------------

create table public.groups (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(btrim(name)) between 2 and 80),
  owner_user_id       uuid not null references public.users (id) on delete restrict,
  slot_amount         numeric(12,2) not null check (slot_amount > 0),
  target_slot_count   integer not null check (target_slot_count between 2 and 100),
  frequency           text not null check (frequency in ('monthly', 'semi_monthly')),
  start_date          date not null,
  -- monthly: day of month (1–28) the cycle's collection is due.
  -- semi_monthly: days after the cycle start (0–14) the collection is due.
  collection_due_day  integer not null,
  timezone            text not null default 'Africa/Cairo',
  status              text not null default 'draft'
                      check (status in ('draft', 'active', 'completed', 'cancelled')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint groups_due_day_matches_frequency check (
    (frequency = 'monthly' and collection_due_day between 1 and 28)
    or (frequency = 'semi_monthly' and collection_due_day between 0 and 14)
  )
);

create index groups_owner_idx on public.groups (owner_user_id);

create trigger groups_set_updated_at
  before update on public.groups
  for each row execute function public.set_updated_at();

-- Schedule and money settings are frozen once the group leaves draft.
create or replace function public.protect_group_config()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (
       new.slot_amount is distinct from old.slot_amount
    or new.target_slot_count is distinct from old.target_slot_count
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

revoke execute on function public.protect_group_config() from public, anon, authenticated;

create trigger groups_protect_config
  before update on public.groups
  for each row execute function public.protect_group_config();

alter table public.activity_logs
  add constraint activity_logs_group_id_fkey
  foreign key (group_id) references public.groups (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- group_members
-- ---------------------------------------------------------------------------

create table public.group_members (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id) on delete restrict,
  user_id       uuid references public.users (id) on delete restrict,
  display_name  text not null check (char_length(btrim(display_name)) between 1 and 60),
  phone_e164    text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status        text not null default 'active'
                check (status in ('invited', 'active', 'inactive', 'removed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.group_members.user_id is
  'Set only after admin approval (member_link_requests) or explicit admin confirmation. Never from a phone match alone.';

create unique index group_members_group_user_unique on public.group_members (group_id, user_id)
  where user_id is not null;
create unique index group_members_group_phone_unique on public.group_members (group_id, phone_e164)
  where phone_e164 is not null and status <> 'removed';
create index group_members_group_status_idx on public.group_members (group_id, status);
create index group_members_user_idx on public.group_members (user_id) where user_id is not null;
create index group_members_phone_idx on public.group_members (phone_e164) where phone_e164 is not null;

create trigger group_members_set_updated_at
  before update on public.group_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- group_roles
-- ---------------------------------------------------------------------------

create table public.group_roles (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id) on delete restrict,
  user_id     uuid not null references public.users (id) on delete restrict,
  role        text not null check (role in ('owner', 'admin', 'collector')),
  created_at  timestamptz not null default now(),
  unique (group_id, user_id)
);

create unique index group_roles_single_owner on public.group_roles (group_id) where role = 'owner';
create index group_roles_user_idx on public.group_roles (user_id);

-- ---------------------------------------------------------------------------
-- member_link_requests
-- ---------------------------------------------------------------------------

create table public.member_link_requests (
  id                   uuid primary key default gen_random_uuid(),
  group_id             uuid not null references public.groups (id) on delete restrict,
  member_id            uuid not null references public.group_members (id) on delete restrict,
  user_id              uuid not null references public.users (id) on delete restrict,
  status               text not null default 'pending'
                       check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by_user_id  uuid references public.users (id) on delete restrict,
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index member_link_requests_one_pending on public.member_link_requests (member_id)
  where status = 'pending';
create index member_link_requests_group_status_idx on public.member_link_requests (group_id, status);
create index member_link_requests_user_idx on public.member_link_requests (user_id);

create trigger member_link_requests_set_updated_at
  before update on public.member_link_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- group_slots
-- ---------------------------------------------------------------------------

create table public.group_slots (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id) on delete restrict,
  slot_number   integer not null check (slot_number > 0),
  payout_order  integer not null check (payout_order > 0),
  status        text not null default 'draft' check (status in ('draft', 'active', 'inactive')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (group_id, slot_number)
);

create unique index group_slots_payout_order_unique on public.group_slots (group_id, payout_order)
  where status <> 'inactive';

create trigger group_slots_set_updated_at
  before update on public.group_slots
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- slot_allocations
-- ---------------------------------------------------------------------------

create table public.slot_allocations (
  id          uuid primary key default gen_random_uuid(),
  slot_id     uuid not null references public.group_slots (id) on delete restrict,
  member_id   uuid not null references public.group_members (id) on delete restrict,
  amount      numeric(12,2) not null check (amount > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (slot_id, member_id)
);

create index slot_allocations_member_idx on public.slot_allocations (member_id);

create trigger slot_allocations_set_updated_at
  before update on public.slot_allocations
  for each row execute function public.set_updated_at();

-- Member and slot must belong to the same group, and allocations change only in draft.
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

  if v_group_status <> 'draft' then
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

revoke execute on function public.check_slot_allocation() from public, anon, authenticated;

create trigger slot_allocations_check
  before insert or update or delete on public.slot_allocations
  for each row execute function public.check_slot_allocation();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on table public.groups, public.group_members, public.group_roles,
  public.member_link_requests, public.group_slots, public.slot_allocations
  from anon, authenticated;

grant select, insert, update on table public.groups to service_role;
grant select, insert, update on table public.group_members to service_role;
grant select, insert, update, delete on table public.group_roles to service_role;
grant select, insert, update on table public.member_link_requests to service_role;
grant select, insert, update on table public.group_slots to service_role;
-- delete: allocations are draft configuration, not financial records (locked after start).
grant select, insert, update, delete on table public.slot_allocations to service_role;

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_roles enable row level security;
alter table public.member_link_requests enable row level security;
alter table public.group_slots enable row level security;
alter table public.slot_allocations enable row level security;

-- ---------------------------------------------------------------------------
-- Authorization helper
-- ---------------------------------------------------------------------------

-- Owner/admin of the group, or the platform super admin.
create or replace function public.is_group_manager(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.group_roles
     where group_id = p_group_id and user_id = p_user_id and role in ('owner', 'admin')
  ) or exists (
    select 1 from public.users
     where id = p_user_id and is_super_admin and status = 'active'
  );
$$;

revoke execute on function public.is_group_manager(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_group_manager(uuid, uuid) to service_role;

create or replace function public.require_group_manager(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_user_id is null or not public.is_group_manager(p_group_id, p_user_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.require_group_manager(uuid, uuid) from public, anon, authenticated;
grant execute on function public.require_group_manager(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- create_group: draft group + owner role + N empty slots in order 1..N
-- ---------------------------------------------------------------------------

create or replace function public.create_group(
  p_actor_user_id      uuid,
  p_name               text,
  p_slot_amount        numeric,
  p_target_slot_count  integer,
  p_frequency          text,
  p_start_date         date,
  p_collection_due_day integer
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_group_id uuid;
begin
  if not exists (select 1 from public.users where id = p_actor_user_id and status = 'active') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_slot_amount <> round(p_slot_amount, 2) then
    raise exception 'amount has more than 2 decimals' using errcode = '22023';
  end if;

  insert into public.groups (
    name, owner_user_id, slot_amount, target_slot_count,
    frequency, start_date, collection_due_day
  )
  values (
    btrim(p_name), p_actor_user_id, p_slot_amount, p_target_slot_count,
    p_frequency, p_start_date, p_collection_due_day
  )
  returning id into v_group_id;

  insert into public.group_roles (group_id, user_id, role)
  values (v_group_id, p_actor_user_id, 'owner');

  insert into public.group_slots (group_id, slot_number, payout_order)
  select v_group_id, n, n from generate_series(1, p_target_slot_count) as n;

  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_group_id, p_actor_user_id, 'group.created', 'group', v_group_id,
          jsonb_build_object('slot_amount', p_slot_amount, 'slots', p_target_slot_count,
                             'frequency', p_frequency));

  return v_group_id;
end;
$$;

revoke execute on function public.create_group(uuid, text, numeric, integer, text, date, integer)
  from public, anon, authenticated;
grant execute on function public.create_group(uuid, text, numeric, integer, text, date, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- add_group_member
-- If the phone already has an account, the admin must confirm the link
-- (p_confirm_link = true); that confirmation counts as approval.
-- Without confirmation such a phone is refused ('phone_has_account').
-- ---------------------------------------------------------------------------

create or replace function public.add_group_member(
  p_actor_user_id  uuid,
  p_group_id       uuid,
  p_display_name   text,
  p_phone_e164     text,
  p_confirm_link   boolean default false
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_existing_user uuid;
begin
  perform public.require_group_manager(p_group_id, p_actor_user_id);

  if exists (select 1 from public.groups where id = p_group_id and status in ('completed', 'cancelled')) then
    raise exception 'group is closed' using errcode = '55000';
  end if;

  if p_phone_e164 is not null then
    select id into v_existing_user from public.users where phone_e164 = p_phone_e164;
  end if;

  if v_existing_user is not null and not p_confirm_link then
    raise exception 'phone_has_account' using errcode = 'P0001';
  end if;

  insert into public.group_members (group_id, user_id, display_name, phone_e164)
  values (p_group_id, v_existing_user, btrim(p_display_name), p_phone_e164)
  returning id into v_member_id;

  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_group_id, p_actor_user_id, 'member.added', 'group_member', v_member_id,
          jsonb_build_object('linked', v_existing_user is not null));

  return v_member_id;
end;
$$;

revoke execute on function public.add_group_member(uuid, uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.add_group_member(uuid, uuid, text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- register_user: create the account and, atomically, a pending link request
-- for every unlinked active member record with the same phone.
-- ---------------------------------------------------------------------------

create or replace function public.register_user(
  p_full_name     text,
  p_phone_e164    text,
  p_password_hash text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  insert into public.users (full_name, phone_e164, password_hash)
  values (btrim(p_full_name), p_phone_e164, p_password_hash)
  returning id into v_user_id;

  with created as (
    insert into public.member_link_requests (group_id, member_id, user_id)
    select gm.group_id, gm.id, v_user_id
      from public.group_members gm
      join public.groups g on g.id = gm.group_id
     where gm.phone_e164 = p_phone_e164
       and gm.user_id is null
       and gm.status = 'active'
       and g.status in ('draft', 'active')
    on conflict do nothing
    returning id, group_id, member_id
  )
  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  select group_id, v_user_id, 'link_request.created', 'member_link_request', id,
         jsonb_build_object('member_id', member_id)
    from created;

  return v_user_id;
end;
$$;

revoke execute on function public.register_user(text, text, text) from public, anon, authenticated;
grant execute on function public.register_user(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- review_link_request: approve (link) or reject. Owner/admin of the group only.
-- ---------------------------------------------------------------------------

create or replace function public.review_link_request(
  p_actor_user_id uuid,
  p_request_id    uuid,
  p_approve       boolean
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_req public.member_link_requests%rowtype;
begin
  select * into v_req from public.member_link_requests where id = p_request_id for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  perform public.require_group_manager(v_req.group_id, p_actor_user_id);

  if v_req.status <> 'pending' then
    raise exception 'request already reviewed' using errcode = '55000';
  end if;

  if p_approve then
    perform 1 from public.group_members where id = v_req.member_id for update;

    if exists (select 1 from public.group_members where id = v_req.member_id and user_id is not null) then
      raise exception 'member is already linked' using errcode = '23505';
    end if;
    if exists (select 1 from public.group_members
                where group_id = v_req.group_id and user_id = v_req.user_id) then
      raise exception 'user is already a member of this group' using errcode = '23505';
    end if;

    update public.group_members set user_id = v_req.user_id where id = v_req.member_id;
  end if;

  update public.member_link_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by_user_id = p_actor_user_id,
         reviewed_at = now()
   where id = p_request_id;

  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_req.group_id, p_actor_user_id,
          case when p_approve then 'link_request.approved' else 'link_request.rejected' end,
          'member_link_request', p_request_id,
          jsonb_build_object('member_id', v_req.member_id, 'user_id', v_req.user_id));
end;
$$;

revoke execute on function public.review_link_request(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.review_link_request(uuid, uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- set_slot_allocations: replace a slot's owners in one step (draft only).
-- p_allocations: [{"member_id": "...", "amount": "750.00"}, ...]
-- The total must equal the group's slot amount exactly, or the list is empty.
-- ---------------------------------------------------------------------------

create or replace function public.set_slot_allocations(
  p_actor_user_id uuid,
  p_slot_id       uuid,
  p_allocations   jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_slot_amount numeric(12,2);
  v_status text;
  v_count integer;
  v_distinct integer;
  v_total numeric;
  v_before jsonb;
begin
  select s.group_id, g.slot_amount, g.status into v_group_id, v_slot_amount, v_status
    from public.group_slots s join public.groups g on g.id = s.group_id
   where s.id = p_slot_id
   for update of s;
  if not found then
    raise exception 'slot not found' using errcode = 'P0002';
  end if;

  perform public.require_group_manager(v_group_id, p_actor_user_id);

  if v_status <> 'draft' then
    raise exception 'allocations are locked after the group starts' using errcode = '55000';
  end if;
  if jsonb_typeof(p_allocations) is distinct from 'array' then
    raise exception 'allocations must be an array' using errcode = '22023';
  end if;

  select count(*), count(distinct a.member_id), coalesce(sum(a.amount), 0)
    into v_count, v_distinct, v_total
    from jsonb_to_recordset(p_allocations) as a(member_id uuid, amount numeric);

  if exists (select 1 from jsonb_to_recordset(p_allocations) as a(member_id uuid, amount numeric)
              where a.member_id is null or a.amount is null or a.amount <= 0
                 or a.amount <> round(a.amount, 2)) then
    raise exception 'each allocation needs a member and a positive amount' using errcode = '22023';
  end if;
  if v_distinct <> v_count then
    raise exception 'a member appears twice in the same slot' using errcode = '22023';
  end if;
  if v_count > 0 and v_total <> v_slot_amount then
    raise exception 'allocation total must equal the slot amount' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('member_id', member_id, 'amount', amount)
                            order by created_at), '[]'::jsonb)
    into v_before from public.slot_allocations where slot_id = p_slot_id;

  delete from public.slot_allocations
   where slot_id = p_slot_id
     and member_id not in (
       select a.member_id from jsonb_to_recordset(p_allocations) as a(member_id uuid, amount numeric)
     );

  insert into public.slot_allocations (slot_id, member_id, amount)
  select p_slot_id, a.member_id, a.amount
    from jsonb_to_recordset(p_allocations) as a(member_id uuid, amount numeric)
  on conflict (slot_id, member_id) do update set amount = excluded.amount
  where public.slot_allocations.amount is distinct from excluded.amount;

  insert into public.activity_logs (group_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_group_id, p_actor_user_id, 'slot.allocations_changed', 'group_slot', p_slot_id,
          jsonb_build_object('before', v_before, 'after', p_allocations));
end;
$$;

revoke execute on function public.set_slot_allocations(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_slot_allocations(uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- reorder_payouts: set the full payout order of a group's (non-inactive) slots.
-- p_slot_ids lists every such slot once, first payout first.
-- (The cycles migration will restrict changes to turns that haven't happened.)
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
  v_expected integer;
  v_before jsonb;
begin
  perform public.require_group_manager(p_group_id, p_actor_user_id);

  if exists (select 1 from public.groups where id = p_group_id and status in ('completed', 'cancelled')) then
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

  select jsonb_agg(slot_number order by payout_order) into v_before
    from public.group_slots where group_id = p_group_id and status <> 'inactive';

  -- Move out of the way first so the unique (group_id, payout_order) index never collides.
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
                        from public.group_slots where group_id = p_group_id and status <> 'inactive')
          ));
end;
$$;

revoke execute on function public.reorder_payouts(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_payouts(uuid, uuid, uuid[]) to service_role;
