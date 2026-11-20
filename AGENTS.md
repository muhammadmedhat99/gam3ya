# Project Agent Instructions --- Association Manager

## 1. Product Overview

Build a mobile-first, Arabic-first Progressive Web App (PWA) for
managing informal rotating savings associations (جمعيات).

The product helps association owners/admins: - Create and manage
associations. - Add participants, including people who do not yet have
an app account. - Divide each full-name slot into monetary allocations
owned by one or more participants. - Define a manual payout order for
slots. - Record collections and payouts. - Track overdue obligations
privately as an admin-only financial workflow. - Let members view
association information and payout order without exposing payment status
or payment history.

This is a tracking and record-keeping product only. It does not move
money, initiate bank transfers, or process electronic payments.

## 2. Non-Negotiable Product Rules

1.  A `slot` represents one full name in the association, not
    necessarily one human.
2.  Each slot has a configured full-name value, for example EGP 1,000.
3.  A slot can be split across multiple members. Example: Ibrahim owns
    EGP 750 and Osama owns EGP 250 of the same EGP 1,000 slot.
4.  A member can own allocations in more than one slot.
5.  The sum of allocations in a slot must equal the slot amount before
    the slot is considered fully allocated/ready.
6.  Payout order is set and controlled manually by an association admin.
    It belongs to the slot, not an individual member.
7.  When a slot's payout turn arrives, the slot receives the cycle's
    whole pot, split among its owners by share
    (`allocation / slot amount`). Example: 10 slots × EGP 1,000 = EGP
    10,000 pot; a 750/250 slot pays Ibrahim EGP 7,500 and Osama EGP
    2,500. Never pay the whole pot to one owner of a shared slot. Each
    slot is paid exactly once; cycle N pays the slot at payout position
    N, so a person holding two slots is paid twice.
8.  Payment status, payment records, payment dates, outstanding
    balances, and collection details are visible to admins/authorized
    collectors only (plus the platform super admin). Ordinary members
    must not see whether any member paid or is overdue.
9.  Members can view association details, member display names, slot
    composition/values where allowed by the product rules, and payout
    order. They cannot view payment status or payment history.
10. Overdue amounts remain outstanding until fully paid. A member may
    make multiple partial payments, but the obligation remains
    unpaid/overdue until the full due amount is covered. The product
    should not mark a partial payment as fully paid.
11. Do not delete financial records. Corrections must be represented by
    auditable reversal/adjustment records.
12. Do not assume all participants contribute equal amounts or that one
    participant owns exactly one slot.

## 3. Required Technology

-   Next.js 16 App Router
-   React 19
-   TypeScript (strict mode)
-   Tailwind CSS
-   HeroUI for interface components
-   Supabase PostgreSQL as the database
-   Supabase JavaScript client (`@supabase/supabase-js`)
-   SQL migrations for schema changes
-   Zod for input validation
-   React Hook Form for complex forms
-   PWA manifest + service worker
-   Web Push for supported installed devices, with explicit permission
-   Supabase Cron / scheduled server-side jobs for reminders when
    required
-   Vercel deployment

Do not add Prisma. Do not use Supabase Auth. Do not add a payment
gateway in the MVP.

## 4. Authentication and Session Security

The application uses a custom **phone + password** authentication system
backed by its own database tables. SMS OTP is intentionally not used in
the MVP (cost). Because of that, **the phone number is never verified**:
a registered phone number is only a username, not proof that the user
owns that phone.

Registration flow: 1. User submits full name, phone number (normalized
to E.164), and password. 2. Server validates input with Zod and enforces
the password policy (minimum 8 characters; reject very common
passwords). 3. If the phone already belongs to a user account,
registration is rejected. 4. Server hashes the password with bcrypt (cost 12),
which stays compatible with PostgreSQL `pgcrypto` `crypt()` so the
database reset function can produce valid hashes, and creates the user. 5. If the phone matches existing unlinked
`group_members` records (the person was added to an association before
registering), registration still completes normally, but the server only
creates **pending link requests**. The user does not see those
associations until an admin of each association approves the request
(see `BUSINESS_RULES.md` section 10). 6. Create a session as described
below.

Login flow: 1. User submits phone number and password. 2. Server
verifies the password hash using a constant-time comparison. 3. Return a
generic error ("رقم الموبايل أو كلمة السر غير صحيحة") on any failure.
4. Rate-limit attempts per phone and per IP, and temporarily lock an
account after repeated failures. 5. On success, create a session.

Sessions: 1. Generate a high-entropy random session token. Store only
its hash in the database. 2. Set the session token in an HttpOnly,
Secure, SameSite cookie. 3. Rotate/revoke sessions on logout, password
change (revoke all other sessions), suspicious activity, and relevant
account security events.

Never: - Authenticate a user merely because they typed a phone number. -
Treat a registered phone number as verified, or link a user to an
association member record without admin approval. - Store plaintext
passwords or session tokens, or log/audit passwords or password
hashes. - trust a `user_id`, `role`, `group_id`, or admin flag sent by
the client. - use localStorage for long-lived authentication tokens.

Keep password verification and session creation on trusted server-side
code.

Password reset (no OTP): 1. Only the **super admin**
(`users.is_super_admin`) can reset a password, from the super-admin
panel or directly in the database via the `admin_reset_password`
function. Association owners/admins cannot reset passwords, because that
would let them log in as their members. 2. A reset sets the password to
the temporary default `123456789`, sets `must_change_password = true`,
sets `temp_password_expires_at` to 24 hours later, and revokes all of
the user's sessions. 3. Logging in with the temporary password after it
expires is refused; the user must ask for another reset. 4. A session
created while `must_change_password` is true is restricted: the server
allows only the change-password screen/action and logout, and denies
every other service. 5. The new password must satisfy the password
policy and must not be `123456789`. Changing it clears
`must_change_password` and `temp_password_expires_at`. 6. Every reset
is audited (actor, target user, timestamp).

The temporary default is the only place `123456789` is accepted; the
normal password policy rejects it everywhere else.

### Super admin

The app has exactly one platform-level **super admin**: the app owner.
It is separate from association roles (`group_roles`).

-   Identity: the owner's phone number and email are provided only
    through server-side environment variables `SUPER_ADMIN_PHONE`
    (E.164) and `SUPER_ADMIN_EMAIL`. Never hardcode them in source,
    migrations, seed files, or docs.
-   Bootstrap: the super-admin account is created once by running the
    `bootstrap_super_admin` database function from the database console
    (see `DATABASE.md` section 7). It creates the user with the
    temporary password, forces a password change, and sets
    `is_super_admin = true`.
-   Registering through the app with the super admin's phone never
    grants super-admin rights, because phones are not verified. No app
    API, Server Action, or client input can set or clear
    `is_super_admin`.
-   The database allows at most one super admin (partial unique index).
-   Capabilities: see `BUSINESS_RULES.md` section 9. In short: full read
    access across all associations including financial data, user
    management (block/unblock, reset password, resolve phone
    disputes), and acting as an admin in any association.
-   Every super-admin action is written to `activity_logs` with
    `metadata.as_super_admin = true`.
-   Super admin still cannot hard-delete financial records; corrections
    use the same reversal/adjustment records as everyone else.

## 5. Architecture and Code Organization

Prefer a feature-oriented structure, for example:

``` text
src/
  app/
    (auth)/
    (app)/
    api/
  components/
    ui/
    layout/
  features/
    auth/
    dashboard/
    groups/
    members/
    slots/
    cycles/
    collections/
    payouts/
    notifications/
  lib/
    supabase/
    auth/
    permissions/
    validation/
    dates/
    money/
  server/
    actions/
    services/
    repositories/
  types/
supabase/
  migrations/
  seed.sql
public/
  manifest.webmanifest
```

Adapt the structure when needed, but keep business logic out of
presentation components.

### Server/client boundaries

-   Read private data through server-side services that enforce
    authorization.
-   Use Server Actions for authenticated mutations where appropriate.
-   Use Route Handlers for webhooks, push subscriptions, and external
    integrations.
-   Never expose the Supabase service-role key to the client.
-   Never rely on hidden UI elements as access control.
-   Validate every mutation with Zod on the server.
-   Use database constraints and transactions/RPC for financial
    operations that must be atomic.

## 6. Database and Authorization

-   Use PostgreSQL UUID primary keys.
-   Store monetary values as `numeric(12,2)` or integer minor units
    consistently; never use floating-point types for money.
-   Store timestamps as `timestamptz`; store association-local dates as
    `date` where they represent calendar dates.
-   Add foreign keys, unique constraints, check constraints, and
    indexes.
-   Use SQL migrations as the source of truth.
-   Enable and test RLS on exposed tables.
-   Since authentication is custom, establish a trusted database
    authorization strategy before exposing direct client access. Prefer
    server-only database access for sensitive tables, or a carefully
    designed verified-session/RLS integration. Do not assume
    `auth.uid()` exists for custom users.
-   A member must never be able to query another member's payment status
    through a direct API request.
-   Admin-only financial privacy must be enforced at the
    database/service layer, not only by omitting fields from the UI.
-   Keep session signing/secrets, password hashes, and service-role keys
    server-only.

### Hosted Supabase, environment, and migrations

-   The project uses a **hosted** Supabase project only (no local
    Supabase/Docker).
-   Env vars (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`,
    `SUPABASE_SECRET_KEY` (server-only `sb_secret_` key used by
    `src/lib/supabase/admin.ts`), `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
    (unused: the browser never queries Supabase), `SUPER_ADMIN_PHONE`,
    `SUPER_ADMIN_EMAIL`.
-   Every table in `public` gets: RLS enabled with no policies, all
    privileges revoked from `anon`/`authenticated`, and explicit grants to
    `service_role` only. Every function revokes `execute` from
    `public`/`anon`/`authenticated`.
-   Migrations live in `supabase/migrations/` and are applied by pasting
    them into the Dashboard SQL Editor in order. Record each one in
    `supabase/APPLIED.md`, then run
    `node --env-file=.env.local scripts/check-db.mts`.
-   Every migration must pass `npm test`, which runs all migrations in
    PGlite (`tests/db/harness.ts`) before it is pasted into the hosted
    project. Add DB tests for new permission boundaries.

## 7. UX and Localization

-   Arabic is the default language.
-   All primary screens must support RTL correctly.
-   Mobile-first layouts; desktop is an enhancement, not the baseline.
-   Use clear, familiar Egyptian Arabic labels where appropriate.
-   Display EGP amounts consistently.
-   Use accessible contrast, large touch targets, readable Arabic
    typography, and clear empty/loading/error states.
-   Provide a bottom navigation on mobile.
-   PWA must have a valid manifest, icons, installable experience, and
    offline fallback.
-   Do not allow offline financial mutations in the MVP.
-   Ask for notification permission only after explaining the benefit
    and receiving a user gesture.

### Design source

-   Screens and the design system come from the Claude Design canvas
    "جمعيتي — نظام التصميم والشاشات" (link in `docs/design/README.md`).
    Each screen is an artboard named like `Login.dc.html`, with its
    states as separate artboards (`-Error`, `-Loading`, `-Empty`).
-   Tokens live in `src/app/globals.css` (`@theme` + HeroUI variable
    mapping). Use token classes (`bg-brand-600`, `text-title-1`,
    `text-muted`, `bg-paid-soft`…), never raw hex values in components.
-   Payment-status colors (`paid`, `partial`, `unpaid`, `overdue`) are
    for admin screens only.

## 8. Core Screens

-   Login (phone + password) and registration
-   Pending-approval state for associations awaiting admin approval
-   Dashboard
-   My associations
-   Create/edit association
-   Association overview
-   Members
-   Admin: account link requests (approve/reject)
-   Slots and slot allocations
-   Manual payout-order management
-   Cycles
-   Admin-only collections and payment records
-   Admin-only financial reports
-   Payout records
-   In-app notifications
-   Profile and security/session management
-   Forced change-password screen (after a reset)
-   Super-admin panel: all associations and users, find user by phone,
    reset password, recover an account for the real phone owner,
    block/unblock users, platform activity log

For ordinary members, hide and server-deny financial collection screens
and all payment-status data.

## 9. Engineering Workflow

Before implementing a feature: 1. Read `BUSINESS_RULES.md` and
`DATABASE.md`. 2. Identify affected tables, permissions, and edge cases.
3. Update SQL migrations and types where required. 4. Implement
server-side authorization and validation. 5. Implement UI after the data
contract is clear. 6. Add tests for business rules and permission
boundaries.

For each feature: - Keep changes focused. - Avoid unnecessary
abstractions and speculative features. - Do not silently change business
rules. - Add or update tests. - Update documentation when behavior or
schema changes. - Use clear, conventional commit messages.

## 10. MVP Scope

### Must have

-   Custom phone + password authentication and secure sessions
-   User profiles, including change password
-   Single super admin (app owner) with a super-admin panel
-   Password reset by the super admin (panel or database) to a
    temporary default with forced change on next login
-   Association creation and management
-   Add members by name and phone, whether or not they have accounts
-   Link a member record to a user account with a matching phone only
    after an association admin approves the link
-   Create slots and split each slot into allocations
-   Manual slot payout order
-   Cycles and due dates
-   Admin-only payment recording and overdue tracking
-   Payout records split by slot allocations
-   In-app notifications
-   Activity log
-   PWA installability and responsive Arabic RTL UI

### Later

-   WhatsApp notifications
-   Phone verification (SMS/WhatsApp OTP) if cost allows
-   Advanced PDF/Excel reports
-   Member payout receipt confirmation
-   Association comments/chat
-   Advanced analytics
-   Online money movement or payment gateway (not part of this product's
    current scope)

## 11. Definition of Done

A feature is not complete until: - Its business rules are implemented
and documented. - Server-side authorization is enforced. - Sensitive
data is not exposed to unauthorized members. - Inputs are validated on
the server. - Financial calculations use exact decimal/integer
arithmetic. - Loading, empty, success, and error states exist. -
Relevant tests pass. - Mobile RTL behavior is checked.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
