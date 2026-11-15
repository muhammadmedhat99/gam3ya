# Applied migrations (hosted project)

Migrations are applied by pasting each file from `supabase/migrations/` into the
Supabase Dashboard → SQL Editor, in filename order. Record each one here right
after it succeeds, then run `node --env-file=.env.local scripts/check-db.mts`.

| Migration | Applied on | Notes |
| --- | --- | --- |
| `20261115181630_auth_foundation.sql` | 2026-11-15 | Verified by `check-db.mts`. Super admin bootstrapped and password changed |
| `20261115185723_groups_members_slots.sql` | 2026-11-15 | Verified by `check-db.mts` + function smoke checks |
| `20261115193339_cycles_activation.sql` | 2026-11-15 | Verified by `check-db.mts`; `group_schedule` output matches the app |
| `20261115194525_payments.sql` | 2026-11-15 | Verified by `check-db.mts`; functions and ledger embed respond |
