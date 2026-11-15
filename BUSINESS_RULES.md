# Business Rules --- Association Manager

## 1. Purpose and Scope

The application manages rotating savings associations (جمعيات) as a
record-keeping tool. It records obligations, collections, payout turns,
and payout allocations. It does not hold, transfer, or process money.

Currency for the initial release: EGP.

## 2. Domain Terminology

### Association (`Group`)

A group of participants following an agreed contribution and payout
schedule.

### Member (`Group Member`)

A person participating in one association. A member record can exist
before that person creates an application account.

### Slot (`Group Slot` / الاسم)

One full-name unit in the association. It has a configured value, such
as EGP 1,000, and one manual payout position.

A slot is not a person. A slot can be owned by one or multiple members.

### Allocation (`Slot Allocation` / الحصة)

The portion of a slot owned by a member.

Examples for a slot worth EGP 1,000: - Mohamed: EGP 1,000 - Ahmed: EGP
500 + Hassan: EGP 500 - Ibrahim: EGP 750 + Osama: EGP 250

A member may own allocations in multiple slots.

### Cycle

One recurring collection/payout period (monthly, every 15 days, or
another supported cadence).

### Collection / Payment

A record that a member paid some or all of their due contribution for a
cycle. Payment records are private to admins/authorized collectors.

### Payout

The amount distributed when a slot reaches its payout turn. The payout
is split among that slot's allocation owners according to their
allocation amounts.

## 3. Association Setup

An association includes: - Name - Owner/admin - Full-name slot value -
Target number of slots - Frequency (monthly, or every 15 days counted
exactly from the start date: 1 Jan, 16 Jan, 31 Jan…) -
Start date - Collection due date / deadline rule - Time zone (default
`Africa/Cairo`) - Status (draft, active, completed, cancelled)

The target number of slots is a whole number. Example: 10 or 15 slots.

The association's planned gross collection per cycle is:

`slot_amount × active_slot_count`

This is the planned amount only. Actual cash collected may be lower when
members are overdue.

## 4. Slots and Allocations

1.  Each slot belongs to exactly one association.
2.  Each slot has a unique slot number within its association.
3.  Each slot has exactly one payout-order position within an active
    payout schedule.
4.  Payout order is configured manually by an admin.
5.  A slot can have one or more allocations.
6.  Each allocation belongs to exactly one slot and one group member.
7.  Allocation amount must be greater than zero.
8.  The sum of allocations for a fully configured slot must equal the
    association's slot amount.
9.  A slot is not ready for activation if its allocation total is below
    or above the slot amount.
10. A member may own multiple allocations in the same association,
    including allocations across different slots.
11. The same member should not be duplicated as separate group members
    within the same association; reuse the existing group-member record.
12. Changes to allocations after the association starts must be
    controlled and audited. Do not silently rewrite historical cycle
    obligations or payouts.

### Example

Slot value: EGP 1,000

  Member      Allocation
  --------- ------------
  Ibrahim            750
  Osama              250
  Total            1,000

When this slot's turn arrives in a 10-slot association (pot EGP 10,000):
- Ibrahim's payout entitlement is EGP 7,500 (75%). - Osama's payout
entitlement is EGP 2,500 (25%). - The application records two
payout-allocation records, one for each member. - Do not assign the
entire pot to either person. See section 8.

## 5. Manual Payout Order

-   Admins control payout order manually.
-   Payout order belongs to a slot, not a member.
-   Each active slot has one unique order position.
-   Members may view the payout order.
-   Only admins can change the order.
-   Order changes must be audited and should not rewrite completed
    historical payouts.
-   A payout turn can be pending, due, partially recorded, paid, or
    cancelled, according to the final payout workflow.
-   Each slot is paid **exactly once** over the association's life.
    The number of cycles equals the number of active slots, and cycle N
    pays the slot at payout position N.
-   A person who owns several slots (e.g. slot 1 and slot 10) pays for
    each slot every cycle and is paid once per slot (cycle 1 and cycle
    10).

## 6. Cycles and Contributions

A cycle is generated for each scheduled period.

Each cycle should snapshot the contribution obligations that apply
during that period. This is important because future allocation changes
must not rewrite historical obligations.

For each member and cycle, calculate the member's due amount from their
allocations across active slots:

`member_due_for_cycle = sum(member allocation amounts across active slots)`

This rule assumes that each allocation represents the member's
contribution obligation per cycle. If the product later adopts a
different contribution model, update this rule and the schema before
implementation.

The sum of member due amounts for a cycle should equal the planned total
contribution across active slots.

## 7. Payment Recording and Overdue Rules

Payment status and payment details are admin-only.

Admins/authorized collectors can: - Record a payment against a member's
due obligation for a cycle. - Record multiple payments against one
obligation. - Correct a mistaken record using an auditable
reversal/adjustment. - View outstanding balances and overdue members.

Rules: 1. A member may pay in one or multiple transactions. 2. A partial
payment reduces the outstanding balance but does not settle the
obligation. 3. An obligation is fully paid only when total valid
payments are greater than or equal to the amount due. 4. If the due date
has passed and the obligation is not fully paid, it is overdue. 5. The
overdue flag remains until the outstanding balance reaches zero. 6. Do
not mark a partially paid obligation as paid. 7. A payment record must
include amount, payment timestamp/date, recorder, and relevant
cycle/member obligation. 8. Financial records must not be physically
deleted. Use reversal/adjustment entries. 9. Members must not see
payment status, amount paid, outstanding amount, overdue flags, payment
dates, or payment history. 10. Admin-only privacy must be enforced in
server queries and database access controls.

Suggested derived statuses: - `unpaid`: no valid payment recorded and
due date has not passed. - `partially_paid`: some valid payment
recorded, balance remains, due date has not passed. - `paid`:
outstanding balance is zero. - `overdue`: due date passed and
outstanding balance is greater than zero.

The status should be derived from due amount, valid payment totals, and
due date where practical. Avoid a manually maintained boolean that can
become inconsistent.

## 8. Payout Calculation

For the slot whose turn it is (payout position N in cycle N):

`pot = sum(member obligations for the cycle)` (planned: `slot_amount ×
active_slot_count`)

For each allocation in that slot:

`member_payout_amount = pot × allocation amount / slot_amount`

Example: 10 slots × EGP 1,000, so pot = EGP 10,000. Slot 3: Ibrahim 750
+ Osama 250.

Payout records: - Ibrahim: EGP 7,500 - Osama: EGP 2,500

The sum of payout allocation records must equal the pot exactly.
Rounding: compute each share rounded down to the piaster, then add any
leftover piasters to the largest allocation (ties: the earliest
created). The calculation runs in the database with `numeric`.

The application records the expected entitlement and the actual payout
status/date separately. Do not claim that money was transferred; the
system only records what the admin says happened.

A payout is complete only when all allocation owners for that slot have
been recorded as paid, unless an explicit admin exception/adjustment is
introduced and audited.

## 9. Visibility and Roles

### Super Admin (platform owner)

A single platform-level role held only by the app owner. It is not an
association role and is never granted through registration or any app
screen (see `AGENTS.md` section 4, "Super admin").

Can: - View all associations, members, slots, cycles, and payout
records - View financial data (payment records, balances, overdue
status) in any association - Act with full owner/admin permissions in
any association, including approving/rejecting link requests - View all
users, block/unblock accounts, and reset passwords - Resolve phone
disputes (e.g. someone registered with a phone they don't own) after
manual identity checks - View the platform-wide activity log

Cannot: - Hard-delete financial records (reversal/adjustment only) -
See passwords or session tokens (only hashes are stored) - Grant
super-admin to anyone else

Every super-admin action is audited and marked as a super-admin action.

### Owner / Admin

Can: - Edit association settings - Add/edit/deactivate members -
Configure slots and allocations - Set manual payout order -
Generate/manage cycles - View all collection/payment details - Record
and correct payment records - View overdue obligations - Record
payouts - View reports and activity logs - Manage other
admins/collectors if that feature is enabled

### Collector (optional MVP role)

Can: - View relevant member identities and obligations - Record
collections - View collection status needed for their work

Cannot: - Change association settings - Change slot allocations or
payout order - Manage admins - View unrelated account/security
information

### Member

Can: - View associations they belong to - View association name and
general schedule - View member display names - View slots, slot
allocations, and payout order according to association visibility
settings - View their own profile

Cannot: - View any member's payment status - View collection records,
amounts paid, due balances, or overdue flags - View payment history or
admin-only financial reports - Record or edit payments - Change payout
order or association settings

The member's own payment status is also hidden in the initial product
scope because the requirement is that payment status is admin-only.

## 10. Membership and Account Linking

-   Admin can add a member using display name and phone number even if
    the person has no account.
-   Store phone numbers in normalized international format (E.164), with
    Egypt country code handled by the phone input.
-   A member record may have a nullable `user_id`.
-   Authentication is phone + password; phone numbers are **not
    verified** (no OTP). Anyone could register with a phone number they
    do not own, so a matching phone alone must never grant access to an
    association.

### Registering with a phone that is already in an association

If a person registers with a phone number that an admin previously
added to one or more associations (unlinked `group_members` records):

1.  Registration completes normally (name, phone, password) and the user
    is logged in.
2.  For each matching unlinked member record, the system creates a
    **pending link request** (`member_link_requests`). No `user_id` is
    written to the member record yet.
3.  The user does **not** see those associations, their members, slots,
    or payout order while the request is pending. At most, the user
    sees a neutral notice such as "في طلبات انضمام مستنية موافقة
    الأدمن" without the association's details.
4.  Admins of each association are notified and see the request with the
    account's registered full name and phone next to the member record's
    display name, so they can confirm it is the same person.
5.  On **approval**, the member record is linked to the user
    (`user_id` set) atomically, and the association becomes visible to
    the user according to normal member rules.
6.  On **rejection**, nothing is linked. The member record stays
    unlinked, and the user keeps no access to that association.
7.  Approval/rejection is per association: approving in one association
    does not affect others.
8.  Approving and rejecting are admin-only actions, audited in the
    activity log.

### Admin adds a phone that already has an account

If an admin adds a member whose phone matches an existing user account,
the admin sees the account's registered name and must explicitly confirm
linking. That explicit confirmation counts as approval. If the admin
does not confirm, the member is created unlinked.

### General rules

-   Do not link accounts to member records based on phone input alone;
    every link requires admin approval.
-   A phone number can belong to only one user account. If someone tries
    to register with a phone that already has an account, registration
    is rejected.
-   One user may belong to many associations.
-   A user can be an admin in one association and a member in another.
-   Do not assume a global role determines their role in every
    association.

### Password reset

There is no self-service "forgot password" in the MVP (no OTP).

1.  The user contacts the super admin (app owner) outside the app.
2.  The super admin confirms the person's identity manually, then resets
    the password from the super-admin panel or the database.
3.  The password becomes the temporary default `123456789`, valid for 24
    hours, and all of the user's sessions are revoked.
4.  On the next login with the temporary password, the user must set a
    new password before they can see anything else in the app.
5.  If 24 hours pass without logging in, the temporary password stops
    working and the user needs another reset.
6.  Association owners/admins cannot reset member passwords.
7.  Every reset is recorded in the activity log.

### Phone registered by someone else (account recovery)

Because phones are not verified, someone may register with a phone
number they do not own. The real owner then cannot register, since a
phone can belong to only one account. Recovery is manual:

1.  The real owner contacts the super admin outside the app.
2.  The super admin confirms the person's identity and ownership of the
    phone manually (e.g. calling or messaging that number).
3.  Before handing the account over, the super admin reviews what the
    account currently has:
    -   Associations it owns or administers, or memberships the real
        owner does not belong to: transfer ownership, remove roles, or
        deactivate memberships as appropriate. These steps are audited
        and never delete financial records.
    -   Memberships linked through the phone, and pending link requests:
        these belong to the phone, so they stay and move to the real
        owner.
4.  The super admin recovers the account: the password is reset to the
    temporary default (24 hours, forced change on next login), all
    sessions are revoked so the other person is logged out, and the
    account's name and email are replaced with the real owner's.
5.  The super admin gives the temporary password to the real owner, who
    logs in and sets their own password.
6.  The recovery is recorded in the activity log with the reason and the
    previous name.

## 11. Notifications

MVP notification types: - Invitation to join an association - New
account link request (admin-facing) - Link request approved/rejected
(user-facing; a rejection must not reveal association details) - Upcoming
contribution deadline (admin-facing if it includes collection details) -
Admin reminder for overdue obligations - Upcoming payout turn - Payout
recorded - General association announcement

Privacy: - Never include other members' payment status or overdue
details in member notifications. - Avoid sensitive financial details in
lock-screen push content. - In-app and push notifications must respect
the same authorization rules as the underlying data.

## 12. Audit and Corrections

Audit sensitive actions: - Member added/edited/deactivated - Account
link request approved/rejected - Password changed or reset by the
super admin (no password data in metadata) - Any action performed by
the super admin - User blocked/unblocked - Slot
created/changed - Allocation created/changed - Payout order changed -
Cycle generated/edited - Payment recorded/reversed/adjusted - Payout
recorded/reversed/adjusted - Admin/collector role changed

Each audit event should capture actor, association, action, timestamp,
and safe metadata. Do not store passwords, password hashes, session
tokens, or secrets in audit metadata.

## 13. Financial Invariants

The system must enforce: - All monetary values are non-negative;
allocations and payment entries must be positive. - Slot allocation
total equals slot value before activation. - Payout allocation total
equals the slot payout total. - A payment belongs to a valid member
obligation and cycle. - A member cannot access admin-only payment
data. - Completed historical cycles and payouts are not silently
recalculated after configuration changes. - All financial writes are
transactional and auditable. - Use exact decimal arithmetic or integer
minor units, never JavaScript floating-point arithmetic for financial
calculations.
