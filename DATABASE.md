# Database Design --- Association Manager

## 1. Database Principles

Database: Supabase PostgreSQL. Supabase Auth is not used. Authentication
is implemented by the application using custom users with phone +
password (hashed), login-attempt rate limiting, and server-managed
sessions. No SMS OTP is used, so phone numbers are not verified.

Use: - UUID primary keys (`gen_random_uuid()`) - `timestamptz` for
instants - `date` for calendar dates - `numeric(12,2)` for EGP values,
or integer piastres consistently. Do not mix representations. - Foreign
keys and explicit delete behavior - SQL migrations as the schema source
of truth - Indexes for foreign keys and common filters - Check
constraints for positive amounts and valid states

All table names below are snake_case and plural.

## 2. Entity Relationship Overview

``` mermaid
erDiagram
  users ||--o{ user_sessions : has
  users ||--o{ group_members : linked_to
  users ||--o{ member_link_requests : requests
  group_members ||--o{ member_link_requests : target_of
  users ||--o{ groups : owns
  groups ||--o{ group_members : has
  groups ||--o{ group_slots : has
  group_members ||--o{ slot_allocations : owns
  group_slots ||--o{ slot_allocations : split_into
  groups ||--o{ group_cycles : has
  group_cycles ||--o{ member_obligations : snapshots
  group_members ||--o{ member_obligations : owes
  member_obligations ||--o{ payment_records : settled_by
  group_cycles ||--o{ payout_records : contains
  group_slots ||--o{ payout_records : receives_turn
  payout_records ||--o{ payout_allocations : split_into
  slot_allocations ||--o{ payout_allocations : entitlement
  users ||--o{ notifications : receives
  users ||--o{ activity_logs : performs
```

## 3. Tables

### 3.1 `users`

Application user accounts.

  Column                   Type          Rules
  ------------------------ ------------- ----------------------------
  `id`                     uuid          PK
  `full_name`              text          NOT NULL
  `phone_e164`             text          NOT NULL, UNIQUE
  `email`                  text          nullable, UNIQUE (lowercased)
  `password_hash`          text          NOT NULL (bcrypt, cost 12)
  `password_updated_at`    timestamptz   NOT NULL
  `must_change_password`   boolean       NOT NULL DEFAULT false
  `temp_password_expires_at` timestamptz nullable
  `failed_login_count`     integer       NOT NULL DEFAULT 0
  `locked_until`           timestamptz   nullable
  `is_super_admin`         boolean       NOT NULL DEFAULT false
  `avatar_url`             text          nullable
  `status`                 text          active, blocked
  `created_at`             timestamptz   NOT NULL
  `updated_at`             timestamptz   NOT NULL

`phone_e164` is the login identifier but is **not verified**. Never
treat it as proof of phone ownership. `password_hash` is server-only:
never select it into any response, log, or audit metadata. Reset
`failed_login_count` on successful login; set `locked_until` after
repeated failures.

`must_change_password` and `temp_password_expires_at` are set by a
password reset (see section 7). While `must_change_password` is true,
sessions are restricted to changing the password and logging out. Login
with the temporary password is refused once `temp_password_expires_at`
has passed.

`is_super_admin` marks the single platform owner. It is set only by the
`bootstrap_super_admin` database function, never through any app API,
and is unrelated to association roles in `group_roles`. Enforce at most
one super admin with a partial unique index:
`CREATE UNIQUE INDEX users_single_super_admin ON users ((true)) WHERE is_super_admin;`

`email` is optional contact information, not a login identifier and not
verified. It is used for the super admin; regular users may leave it
empty.

### 3.2 `login_attempts`

Records authentication attempts for rate limiting and abuse detection
(replaces the former `otp_challenges` table).

  Column         Type          Rules
  -------------- ------------- -------------------------------
  `id`           uuid          PK
  `phone_e164`   text          NOT NULL
  `ip_hash`      text          nullable (hash, not raw IP)
  `kind`         text          login, register
  `succeeded`    boolean       NOT NULL
  `created_at`   timestamptz   NOT NULL

Use it to rate-limit by phone and by IP. Never store the submitted
password. Clean up old rows on a schedule.

### 3.3 `user_sessions`

Server-managed sessions.

  Column           Type          Rules
  ---------------- ------------- ------------------
  `id`             uuid          PK
  `user_id`        uuid          FK users.id
  `token_hash`     text          NOT NULL, UNIQUE
  `expires_at`     timestamptz   NOT NULL
  `revoked_at`     timestamptz   nullable
  `created_at`     timestamptz   NOT NULL
  `last_seen_at`   timestamptz   nullable

Generate high-entropy random tokens. Store only token hashes. Send the
raw token only in an HttpOnly, Secure, SameSite cookie. Never expose
session tokens to client JavaScript.

### 3.4 `groups`

Association configuration.

  Column                 Type            Rules
  ---------------------- --------------- -------------------------------------
  `id`                   uuid            PK
  `name`                 text            NOT NULL
  `owner_user_id`        uuid            FK users.id
  `slot_amount`          numeric(12,2)   NOT NULL, \> 0
  `target_slot_count`    integer         NOT NULL, \> 0
  `frequency`            text            monthly, semi_monthly (every 15 days from start_date)
  `start_date`           date            NOT NULL
  `collection_due_day`   integer         nullable; validate by frequency
  `timezone`             text            NOT NULL DEFAULT 'Africa/Cairo'
  `status`               text            draft, active, completed, cancelled
  `created_at`           timestamptz     NOT NULL
  `updated_at`           timestamptz     NOT NULL

`target_slot_count` is a whole number. The association's planned gross
amount per cycle is `slot_amount * active slot count`.

### 3.5 `group_members`

A person's membership record inside one association. This is separate
from their application account.

  Column           Type          Rules
  ---------------- ------------- ------------------------------------
  `id`             uuid          PK
  `group_id`       uuid          FK groups.id
  `user_id`        uuid          nullable FK users.id
  `display_name`   text          NOT NULL
  `phone_e164`     text          nullable
  `status`         text          invited, active, inactive, removed
  `created_at`     timestamptz   NOT NULL
  `updated_at`     timestamptz   NOT NULL

Constraints: - Unique `(group_id, user_id)` when `user_id` is not
null. - Prevent duplicate membership records for the same normalized
phone in one group where appropriate. - Do not require a `user_id` when
an admin adds a person. - Set `user_id` only when an association admin
approves the link (through `member_link_requests`, or by explicitly
confirming the link when adding a phone that already has an account).
Never set it automatically because phones match.

### 3.6 `group_roles`

Association-specific roles.

  Column         Type          Rules
  -------------- ------------- -------------------------
  `id`           uuid          PK
  `group_id`     uuid          FK groups.id
  `user_id`      uuid          FK users.id
  `role`         text          owner, admin, collector
  `created_at`   timestamptz   NOT NULL

Unique `(group_id, user_id)`. A user's role is per association, not
global. The owner can be represented here as well as in
`groups.owner_user_id`; keep both consistent through a
transaction/trigger or choose one canonical source.

### 3.7 `group_slots`

Each row represents one full-name slot and owns one manual payout
position.

  Column           Type          Rules
  ---------------- ------------- -------------------------
  `id`             uuid          PK
  `group_id`       uuid          FK groups.id
  `slot_number`    integer       NOT NULL, \> 0
  `payout_order`   integer       NOT NULL, \> 0
  `status`         text          draft, active, inactive
  `created_at`     timestamptz   NOT NULL
  `updated_at`     timestamptz   NOT NULL

Active slots always have `slot_number = payout_order` ("اسم N" is the Nth turn): `renumber_slots()` runs after every reorder or slot-count change, so the people (allocations) move between names while the names stay 1..N. Inactive slots are numbered after the active ones.

Constraints: - Unique `(group_id, slot_number)`. - Unique
`(group_id, payout_order)` for active slots, implemented with a partial
unique index if appropriate. - Payout order is assigned to the slot,
never to an individual member.

### 3.8 `slot_allocations`

Defines how a slot value is split among its member owners.

  Column         Type            Rules
  -------------- --------------- ---------------------
  `id`           uuid            PK
  `slot_id`      uuid            FK group_slots.id
  `member_id`    uuid            FK group_members.id
  `amount`       numeric(12,2)   NOT NULL, \> 0
  `created_at`   timestamptz     NOT NULL
  `updated_at`   timestamptz     NOT NULL

Constraints: - Unique `(slot_id, member_id)`; update the existing
allocation instead of creating duplicates. - Validate that the member
belongs to the same group as the slot. Use a trigger or transactional
service because this crosses tables. - Before a slot becomes active, sum
of allocations must equal `groups.slot_amount`. - A member can have
allocations in multiple slots. - Changes after activation must be
audited and must not rewrite historical obligations/payouts.

### 3.9 `group_cycles`

One recurring collection/payout period.

  Column           Type          Rules
  ---------------- ------------- -----------------------------------
  `id`             uuid          PK
  `group_id`       uuid          FK groups.id
  `cycle_number`   integer       NOT NULL, \> 0
  `starts_on`      date          NOT NULL
  `due_on`         date          NOT NULL
  `ends_on`        date          NOT NULL
  `status`         text          scheduled, closed, cancelled
  `created_at`     timestamptz   NOT NULL

Unique `(group_id, cycle_number)`. All cycles are generated once, by
`activate_group`, using `group_schedule()` (identical to
`src/lib/schedule.ts`). Which cycle is running is derived from dates in
the group's time zone; `status` only records closure, so it never goes
stale. Payout records are created when a payout is recorded, using the
payout order at that time, so future turns can still be reordered after
the group starts (turns whose cycle has started are locked).

### 3.10 `member_obligations`

Snapshots the amount each member is expected to contribute in a cycle.
This table prevents later allocation edits from changing historical
dues.

  Column         Type            Rules
  -------------- --------------- ---------------------
  `id`           uuid            PK
  `cycle_id`     uuid            FK group_cycles.id
  `member_id`    uuid            FK group_members.id
  `amount_due`   numeric(12,2)   NOT NULL, \>= 0
  `due_on`       date            NOT NULL
  `created_at`   timestamptz     NOT NULL

Unique `(cycle_id, member_id)`. At cycle creation, calculate the
member's due amount from the sum of their active slot allocations. If
the business later decides contributions are based on a different
formula, change this rule explicitly.

### 3.11 `payment_records`

Admin-only, append-only collection ledger. Supports partial payments.

  Column                  Type            Rules
  ----------------------- --------------- --------------------------------------------
  `id`                    uuid            PK
  `obligation_id`         uuid            FK member_obligations.id
  `kind`                  text            payment, reversal
  `amount`                numeric(12,2)   NOT NULL, \> 0 (always positive)
  `paid_on`               date            NOT NULL, not in the future (group tz)
  `method`                text            cash, transfer (payments only)
  `note`                  text            nullable; required reason for reversals
  `reversal_of_id`        uuid            nullable FK payment_records.id, unique
  `recorded_by_user_id`   uuid            FK users.id
  `idempotency_key`       uuid            nullable, unique (retried submits)
  `created_at`            timestamptz     NOT NULL

Rows are never updated or deleted (trigger). A reversal cancels exactly one
payment in full; net paid = payments − reversals. Recording
(`record_payment`) is for owner/admin/collector and refuses amounts above
the outstanding balance; reversing (`reverse_payment`) is owner/admin
only. Both serialize per obligation with an advisory lock.

`obligation_balances` (view, `security_invoker`, service_role only) derives
`paid_total`, `outstanding` and `status` (paid / partially_paid / unpaid /
overdue) from the ledger and the due date in the group's time zone, so no
status flag can drift.

### 3.12 `payout_records`

One per cycle: the slot whose turn it is and the cycle's pot. Created (once,
idempotently) by `ensure_payout` the first time an owner/admin records a
payout for a cycle that has started, using the payout order at that time.

  Column                 Type            Rules
  ---------------------- --------------- ---------------------------------
  `id`                   uuid            PK
  `group_id`             uuid            FK groups.id
  `cycle_id`             uuid            FK group_cycles.id, UNIQUE
  `slot_id`              uuid            FK group_slots.id, UNIQUE
  `expected_amount`      numeric(12,2)   pot = sum of the cycle's obligations
  `created_by_user_id`   uuid            FK users.id
  `created_at`           timestamptz     NOT NULL

### 3.13 `payout_allocations` and `payout_disbursements`

`payout_allocations` snapshots each owner's entitlement:
`expected_amount = trunc(pot × share_amount / slot_amount, 2)`, leftover
piasters to the largest share (ties: earliest created, then member id) —
identical to `splitPot` in `src/lib/money.ts`. Example: pot 10,000, slot
750/250 → 7,500 / 2,500.

`payout_disbursements` is the append-only ledger of money handed to each
owner (kind payment | reversal, amount > 0, paid_on, method, note,
reversal_of_id, recorded_by_user_id, idempotency_key). Partial
disbursements are allowed, never more than what's left. Corrections are
reversal rows.

`payout_allocation_balances` (view, `security_invoker`, service_role only)
derives `paid_total`, `outstanding` and `status` (pending /
partially_paid / paid). All payout tables are immutable (triggers) and
owner/admin only.

### 3.14 `notifications`

In-app notification inbox.

  Column         Type          Rules
  -------------- ------------- -------------------------------------------
  `id`           uuid          PK
  `user_id`      uuid          FK users.id
  `group_id`     uuid          nullable FK groups.id
  `type`         text          NOT NULL (link_request, link_approved, …)
  `title`        text          NOT NULL
  `body`         text          NOT NULL
  `data`         jsonb         NOT NULL DEFAULT '{}' (e.g. in-app `href`)
  `dedupe_key`   text          nullable; unique per user (daily reminders)
  `read_at`      timestamptz   nullable
  `created_at`   timestamptz   NOT NULL

Event notifications are created by an AFTER INSERT trigger on
`activity_logs` (`notify_from_activity`), so they're atomic with the
audited action. Time-based ones come from `notify_daily()` (turn in 3
days → owners of that slot; collection due tomorrow and overdue the day
after → owners/admins/collectors only), scheduled daily with pg_cron.
Member-facing notifications never contain payment status; a rejected
link request has no `group_id` and doesn't name the association.

### 3.15 `push_subscriptions`

Web Push endpoints per user/device.

  Column         Type          Rules
  -------------- ------------- ------------------
  `id`           uuid          PK
  `user_id`      uuid          FK users.id
  `endpoint`     text          NOT NULL, UNIQUE
  `p256dh_key`   text          NOT NULL
  `auth_key`     text          NOT NULL
  `created_at`   timestamptz   NOT NULL
  `updated_at`   timestamptz   NOT NULL

Protect subscription data and send pushes only from trusted server-side
code.

### 3.16 `activity_logs`

Append-only audit trail for sensitive actions.

  Column            Type          Rules
  ----------------- ------------- -----------------------
  `id`              uuid          PK
  `group_id`        uuid          nullable FK groups.id
  `actor_user_id`   uuid          nullable FK users.id
  `action`          text          NOT NULL
  `entity_type`     text          NOT NULL
  `entity_id`       uuid          nullable
  `metadata`        jsonb         NOT NULL DEFAULT '{}'
  `created_at`      timestamptz   NOT NULL

Never store passwords, password hashes, session tokens, secrets, or
unnecessary personal data in metadata.

### 3.17 `member_link_requests`

Pending requests to link a registered user account to an existing,
unlinked `group_members` record with the same phone. Required because
phone numbers are not verified.

  Column                  Type          Rules
  ----------------------- ------------- ----------------------------------------
  `id`                    uuid          PK
  `group_id`              uuid          FK groups.id
  `member_id`             uuid          FK group_members.id
  `user_id`               uuid          FK users.id
  `status`                text          pending, approved, rejected, cancelled
  `reviewed_by_user_id`   uuid          nullable FK users.id
  `reviewed_at`           timestamptz   nullable
  `created_at`            timestamptz   NOT NULL
  `updated_at`            timestamptz   NOT NULL

Rules: - Created by the server at registration for each unlinked
`group_members` row whose `phone_e164` matches the new user. - At most
one `pending` request per `member_id` (partial unique index). -
`member_id` must belong to `group_id` (trigger or transactional
service). - Only an owner/admin of `group_id` can approve or reject. -
Approving sets `group_members.user_id` and the request status in the
same transaction, and fails if the member record was already linked. -
While pending or rejected, the user has no access to the group's data.
- Never hard-delete; keep rows as history.

## 4. Important Relationships and Rules

-   One user can belong to many associations.
-   One user can have different roles in different associations.
-   A group member may exist without a user account.
-   A slot belongs to one group.
-   A slot has one or more allocations.
-   An allocation belongs to one slot and one member in the same group.
-   One member can own allocations in multiple slots.
-   A cycle snapshots member obligations.
-   Payment records settle member obligations and are admin-only.
-   A payout belongs to one cycle and one slot.
-   A payout snapshots the slot's allocations into payout allocations.
-   Each payout allocation represents the amount payable to one
    allocation owner.

## 5. Authorization and RLS Strategy

Supabase Auth is not used, so `auth.uid()` is not automatically
available as the application identity.

Before enabling browser access to private tables, implement a secure
custom-session authorization bridge. Options: 1. Keep all database
access server-side and use the Supabase service-role key only on the
server, with explicit authorization checks in every server service. 2.
Implement a carefully verified custom JWT/session integration for
PostgreSQL/RLS, ensuring clients cannot forge identity claims.

For the MVP, prefer server-side access for all sensitive tables. Never
expose the service-role key in client bundles.

Authorization requirements: - Unauthenticated users cannot access
private data. - Members can access only associations where they have an
active membership linked to their `user_id`. A pending or rejected
`member_link_requests` row grants no access. - A user with
`must_change_password = true` can only change their password or log
out; every other service denies them. - Only the user with
`is_super_admin = true` can reach the super-admin panel, reset
passwords, block users, or read across all associations. Check the flag
from the database on every request, never from the client or a cached
claim. - Members cannot query `payment_records`,
`member_obligations` financial fields, admin reports, or overdue
lists. - Admins can access financial data only for associations where
they have the appropriate role. - Collectors receive only the limited
permissions defined by business rules. - UI visibility is not
authorization; enforce access in server services and database policy
boundaries. - Test access with direct requests, not only through the UI.

## 6. Indexes

Create indexes for: - `users(phone_e164)` unique - `users(lower(email))`
unique where email is not null - `users((true))` unique where
`is_super_admin` (single super admin) -
`login_attempts(phone_e164, created_at)` -
`login_attempts(ip_hash, created_at)` -
`member_link_requests(member_id)` unique where `status = 'pending'` -
`member_link_requests(group_id, status)` -
`member_link_requests(user_id)` -
`user_sessions(user_id, expires_at)` -
`group_members(group_id, status)` - `group_members(user_id)` -
`group_members(phone_e164)` - `group_roles(group_id, user_id)` unique -
`group_slots(group_id, payout_order)` - `slot_allocations(slot_id)` -
`slot_allocations(member_id)` - `group_cycles(group_id, cycle_number)`
unique - `member_obligations(cycle_id, member_id)` unique -
`payment_records(obligation_id, paid_at)` -
`payout_records(cycle_id, slot_id)` unique -
`payout_allocations(payout_id)` -
`notifications(user_id, created_at DESC)` -
`notifications(user_id, read_at)` -
`activity_logs(group_id, created_at DESC)`

Use partial indexes where appropriate for active/unrevoked records.

## 7. Transactions and Database Functions

Use database transactions/RPC or equivalent atomic server-side
operations for: - Registering a user and creating pending link requests
for matching unlinked group-member records. - Verifying a password and
creating a session. - Approving a link request (set
`group_members.user_id` + request status together). - Changing a
password and revoking other sessions. - Resetting a password via
`admin_reset_password(target_user_id uuid, actor_user_id uuid)`: uses
`pgcrypto` `crypt('123456789', gen_salt('bf', 12))`, sets
`must_change_password = true`, `temp_password_expires_at = now() +
interval '24 hours'`, revokes all of the user's sessions, and writes an
`activity_logs` row, all in one transaction. The panel calls it through
the server after checking `is_super_admin`. Calling it from the
database console uses a null actor, recorded as a database reset.
Restrict execution to the service role. - Bootstrapping the super admin
via `bootstrap_super_admin(phone_e164 text, email text, full_name
text)`: run once from the database console with the values of
`SUPER_ADMIN_PHONE` and `SUPER_ADMIN_EMAIL`. It fails if a super admin
already exists or the phone already has an account. It creates the user
with the temporary password, `must_change_password = true`, a 24-hour
expiry, and `is_super_admin = true`, and writes an `activity_logs` row.
Revoke execution from every role except the database owner. Never call
it from application code. - Recovering an account for the real phone
owner via `admin_recover_account(target_user_id uuid, new_full_name
text, new_email text, actor_user_id uuid, note text)`: performs the
same steps as `admin_reset_password`, replaces `full_name` and `email`
with the real owner's, and writes an `account_recovered` row to
`activity_logs` with the note and the previous name, all in one
transaction. Leaves `member_link_requests`, memberships, and roles
unchanged; the super admin handles those first (see
`BUSINESS_RULES.md` section 10). Same execution restrictions as
`admin_reset_password`. -
Activating a group only after all required slots are valid. - Creating a
cycle and its member-obligation snapshots. - Recording/reversing
payments and recalculating derived balances. - Creating a payout and
snapshotting its payout allocations. - Recording payout completion. -
Changing payout order without creating duplicate positions.

Never split a financial mutation into multiple independent client
requests that can leave partial state.

## 8. Derived Financial Calculations

For an obligation:

`valid_paid_total = sum(valid payment records, excluding reversed entries)`

`outstanding_amount = max(amount_due - valid_paid_total, 0)`

Status: - `paid` when outstanding amount is zero. - `overdue` when due
date has passed and outstanding amount is greater than zero. -
`partially_paid` when some valid payment exists and due date has not
passed. - `unpaid` when no valid payment exists and due date has not
passed.

For a member's cycle due:

`amount_due = sum(active slot allocation amounts for that member at cycle snapshot time)`

For a slot payout:

`payout_expected_amount = sum(member obligations for the cycle)` (the
cycle's pot)

For each payout allocation:

`member_payout_expected_amount = payout_expected_amount × (slot allocation amount / group slot_amount)`

Rounding: round each share down to 0.01, then add the leftover to the
largest allocation (ties: earliest `created_at`), so allocations sum
exactly to the pot. Compute it in SQL with `numeric`.

All calculations must use exact numeric values. Do not use JavaScript
`number` arithmetic for financial totals where precision matters; use
database numeric calculations or a decimal library.

## 9. Migration Order

Suggested initial migration sequence: 1. Extensions and shared
updated-at helper (if needed) 2. `users` 3. `login_attempts` 4.
`user_sessions` 5. `groups` 6. `group_members` 7. `group_roles` 8.
`member_link_requests` 9. `group_slots` 10. `slot_allocations` 11.
`group_cycles` 12. `member_obligations` 13. `payment_records` 14.
`payout_records` 15. `payout_allocations` 16. `notifications` 17.
`push_subscriptions` 18. `activity_logs` 19. Constraints, indexes,
triggers, policies, and transactional functions

## 10. Decisions (confirmed 2026-11-15)

-   **Payout amount:** the slot receives the cycle's whole pot, split by
    share (`allocation / slot_amount`). 750/250 of a 10 × 1,000 group →
    7,500 / 2,500.
-   **Payout turns:** each slot is paid exactly once; cycles = active
    slots; cycle N pays payout position N. One person may own several
    slots and is then paid once per slot.
-   **Semi-monthly:** every 15 days exactly from `start_date`.
-   **Visibility:** members can see each slot's owners and their
    allocation amounts. Payment status stays admin-only.
-   **Activation:** every slot must be fully allocated before the group
    becomes active.
-   **Admins:** the owner is always an admin; additional admins and
    collectors are allowed through `group_roles`.
-   **Contribution:** a member's due per cycle is the sum of their
    allocations across active slots.
