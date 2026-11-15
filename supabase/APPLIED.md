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
| `20261115195324_payouts.sql` | 2026-11-15 | Verified by `check-db.mts`; functions, anon denial and embeds checked |
| `20261115200139_settings_roles_completion.sql` | 2026-11-15 | Verified by `check-db.mts`; new functions respond, anon denied, roles embed ok |
| `20261115200746_notifications.sql` | 2026-11-15 | Verified by `check-db.mts`; anon denied. Cron job: check Dashboard → Integrations → Cron |
| `20261115201001_super_admin.sql` | 2026-11-15 | Verified: non-admin actor and anon refused; admin embeds ok |
