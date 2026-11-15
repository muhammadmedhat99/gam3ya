-- Auth foundation: users, login attempts, sessions, activity log,
-- super-admin bootstrap, password reset and account recovery.
--
-- Access model (see DATABASE.md section 5): every table here is reached
-- only by trusted server code using the service_role / secret key.
-- anon and authenticated get no privileges at all, and RLS is enabled with
-- no policies as defense in depth (service_role bypasses RLS).

-- ---------------------------------------------------------------------------
-- Default privileges: nothing new in public is reachable by anon/authenticated
-- ---------------------------------------------------------------------------

alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared helper: updated_at
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

create table public.users (
  id                        uuid primary key default gen_random_uuid(),
  full_name                 text not null
                            check (char_length(btrim(full_name)) between 2 and 100),
  phone_e164                text not null unique
                            check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email                     text
                            check (email is null or (email = lower(email) and email like '%_@_%')),
  password_hash             text not null,
  password_updated_at       timestamptz not null default now(),
  must_change_password      boolean not null default false,
  temp_password_expires_at  timestamptz,
  failed_login_count        integer not null default 0 check (failed_login_count >= 0),
  locked_until              timestamptz,
  is_super_admin            boolean not null default false,
  avatar_url                text,
  status                    text not null default 'active'
                            check (status in ('active', 'blocked')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint users_temp_password_has_expiry
    check (not must_change_password or temp_password_expires_at is not null)
);

comment on column public.users.phone_e164 is
  'Login identifier. NOT verified (no OTP). Never treat as proof of phone ownership.';
comment on column public.users.password_hash is
  'bcrypt hash. Server-only; never return to clients or write to logs.';
comment on column public.users.is_super_admin is
  'Single platform owner. Only settable by the postgres role (bootstrap_super_admin).';

create unique index users_email_unique on public.users (email) where email is not null;
create unique index users_single_super_admin on public.users ((true)) where is_super_admin;

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- is_super_admin can only be set or changed by the database owner (console /
-- bootstrap function), never by the app's service_role connection.
create or replace function public.protect_super_admin_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'postgres' then
    if tg_op = 'INSERT' and new.is_super_admin then
      raise exception 'is_super_admin can only be set by the database owner'
        using errcode = '42501';
    elsif tg_op = 'UPDATE' and new.is_super_admin is distinct from old.is_super_admin then
      raise exception 'is_super_admin can only be changed by the database owner'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.protect_super_admin_flag() from public, anon, authenticated;

create trigger users_protect_super_admin_flag
  before insert or update on public.users
  for each row execute function public.protect_super_admin_flag();

-- ---------------------------------------------------------------------------
-- login_attempts (rate limiting)
-- ---------------------------------------------------------------------------

create table public.login_attempts (
  id          uuid primary key default gen_random_uuid(),
  phone_e164  text not null,
  ip_hash     text,
  kind        text not null check (kind in ('login', 'register')),
  succeeded   boolean not null,
  created_at  timestamptz not null default now()
);

create index login_attempts_phone_created_idx on public.login_attempts (phone_e164, created_at desc);
create index login_attempts_ip_created_idx on public.login_attempts (ip_hash, created_at desc)
  where ip_hash is not null;

-- ---------------------------------------------------------------------------
-- user_sessions
-- ---------------------------------------------------------------------------

create table public.user_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete restrict,
  token_hash    text not null unique,
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

create index user_sessions_user_active_idx on public.user_sessions (user_id, expires_at)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- activity_logs (append-only audit trail)
-- group_id FK to groups is added in the groups migration.
-- ---------------------------------------------------------------------------

create table public.activity_logs (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid,
  actor_user_id  uuid references public.users (id) on delete restrict,
  action         text not null,
  entity_type    text not null,
  entity_id      uuid,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index activity_logs_group_created_idx on public.activity_logs (group_id, created_at desc)
  where group_id is not null;
create index activity_logs_actor_idx on public.activity_logs (actor_user_id)
  where actor_user_id is not null;
create index activity_logs_created_idx on public.activity_logs (created_at desc);

-- Append-only: block UPDATE and DELETE for every role.
create or replace function public.prevent_activity_log_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'activity_logs is append-only' using errcode = '42501';
end;
$$;

revoke execute on function public.prevent_activity_log_changes() from public, anon, authenticated;

create trigger activity_logs_append_only
  before update or delete on public.activity_logs
  for each row execute function public.prevent_activity_log_changes();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on table public.users, public.login_attempts, public.user_sessions, public.activity_logs
  from anon, authenticated;

grant select, insert, update on table public.users to service_role;
grant select, insert, delete on table public.login_attempts to service_role;
grant select, insert, update on table public.user_sessions to service_role;
grant select, insert on table public.activity_logs to service_role;

alter table public.users enable row level security;
alter table public.login_attempts enable row level security;
alter table public.user_sessions enable row level security;
alter table public.activity_logs enable row level security;

-- ---------------------------------------------------------------------------
-- Temporary password (shared by reset, recovery and bootstrap)
-- ---------------------------------------------------------------------------

create or replace function public.temp_password_hash()
returns text
language sql
volatile
set search_path = ''
as $$
  select extensions.crypt('123456789', extensions.gen_salt('bf', 12));
$$;

-- service_role needs it because admin_reset_password (security invoker) calls it.
revoke execute on function public.temp_password_hash() from public, anon, authenticated;
grant execute on function public.temp_password_hash() to service_role;

-- ---------------------------------------------------------------------------
-- admin_reset_password
-- Called by the server (service_role) from the super-admin panel with the
-- actor's id, or from the database console with a null actor.
-- ---------------------------------------------------------------------------

create or replace function public.admin_reset_password(
  p_target_user_id uuid,
  p_actor_user_id  uuid default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_actor_user_id is not null and not exists (
    select 1 from public.users
    where id = p_actor_user_id and is_super_admin and status = 'active'
  ) then
    raise exception 'actor is not the super admin' using errcode = '42501';
  end if;

  update public.users
     set password_hash            = public.temp_password_hash(),
         password_updated_at      = now(),
         must_change_password     = true,
         temp_password_expires_at = now() + interval '24 hours',
         failed_login_count       = 0,
         locked_until             = null
   where id = p_target_user_id;

  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  update public.user_sessions
     set revoked_at = now()
   where user_id = p_target_user_id and revoked_at is null;

  insert into public.activity_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor_user_id,
    'user.password_reset',
    'user',
    p_target_user_id,
    jsonb_build_object(
      'as_super_admin', p_actor_user_id is not null,
      'via', case when p_actor_user_id is null then 'database' else 'panel' end
    )
  );
end;
$$;

revoke execute on function public.admin_reset_password(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_reset_password(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- admin_recover_account
-- Hands an account over to the real phone owner (BUSINESS_RULES.md section 10).
-- Memberships, roles and link requests are reviewed by the super admin first
-- and are intentionally left untouched here.
-- ---------------------------------------------------------------------------

create or replace function public.admin_recover_account(
  p_target_user_id uuid,
  p_new_full_name  text,
  p_new_email      text,
  p_actor_user_id  uuid,
  p_note           text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_previous_name text;
begin
  if p_note is null or char_length(btrim(p_note)) = 0 then
    raise exception 'a recovery note is required' using errcode = '22023';
  end if;

  select full_name into v_previous_name
    from public.users
   where id = p_target_user_id
   for update;

  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  perform public.admin_reset_password(p_target_user_id, p_actor_user_id);

  update public.users
     set full_name = btrim(p_new_full_name),
         email     = nullif(lower(btrim(p_new_email)), '')
   where id = p_target_user_id;

  insert into public.activity_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor_user_id,
    'user.account_recovered',
    'user',
    p_target_user_id,
    jsonb_build_object(
      'as_super_admin', p_actor_user_id is not null,
      'via', case when p_actor_user_id is null then 'database' else 'panel' end,
      'previous_name', v_previous_name,
      'note', btrim(p_note)
    )
  );
end;
$$;

revoke execute on function public.admin_recover_account(uuid, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_recover_account(uuid, text, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- bootstrap_super_admin
-- Run ONCE from the Supabase SQL editor (as postgres) with the values of
-- SUPER_ADMIN_PHONE and SUPER_ADMIN_EMAIL. Never called by the app.
--   select public.bootstrap_super_admin('+20XXXXXXXXXX', 'you@example.com', 'Your Name');
-- Then log in with the temporary password 123456789 within 24 hours.
-- ---------------------------------------------------------------------------

create or replace function public.bootstrap_super_admin(
  p_phone_e164 text,
  p_email      text,
  p_full_name  text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if exists (select 1 from public.users where is_super_admin) then
    raise exception 'a super admin already exists' using errcode = '23505';
  end if;

  if exists (select 1 from public.users where phone_e164 = p_phone_e164) then
    raise exception 'this phone already has an account; resolve it manually first'
      using errcode = '23505';
  end if;

  insert into public.users (
    full_name, phone_e164, email, password_hash,
    must_change_password, temp_password_expires_at, is_super_admin
  )
  values (
    btrim(p_full_name), p_phone_e164, nullif(lower(btrim(p_email)), ''),
    public.temp_password_hash(),
    true, now() + interval '24 hours', true
  )
  returning id into v_user_id;

  insert into public.activity_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (null, 'user.super_admin_bootstrapped', 'user', v_user_id,
          jsonb_build_object('via', 'database'));

  return v_user_id;
end;
$$;

revoke execute on function public.bootstrap_super_admin(text, text, text)
  from public, anon, authenticated, service_role;
