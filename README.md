# جمعيتي — Association Manager

Arabic-first PWA for managing rotating savings associations (جمعيات).
Read `AGENTS.md`, `BUSINESS_RULES.md` and `DATABASE.md` before changing anything.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS 4 · HeroUI v3 ·
hosted Supabase Postgres (server-only access) · Zod · React Hook Form · Vitest + PGlite.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill it in:
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`: the `sb_secret_…` key. Server-only.
   - `SUPER_ADMIN_PHONE`, `SUPER_ADMIN_EMAIL`
3. Apply migrations: paste each file in `supabase/migrations/` (in order) into
   Dashboard → SQL Editor, then record it in `supabase/APPLIED.md`.
4. Once, in the SQL Editor, create the super admin:
   ```sql
   select public.bootstrap_super_admin('<SUPER_ADMIN_PHONE>', '<SUPER_ADMIN_EMAIL>', '<full name>');
   ```
   Then log in within 24 hours with the temporary password `123456789` and set a new one.
5. Verify the hosted database: `node --env-file=.env.local scripts/check-db.mts`
6. `npm run dev`

## Deploy (Vercel)

1. Vercel → **Add New → Project** → import the GitHub repo. Framework: Next.js (auto).
2. **Environment Variables** (Production and Preview):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY` (secret key; server-only, never `NEXT_PUBLIC_`)
   - `SUPER_ADMIN_PHONE` (reserves the owner's phone at registration)
3. **Settings → Functions → Region**: pick the region closest to the Supabase project
   (e.g. Frankfurt `fra1` for `eu-central-1`).
4. Deploy. Every push to `main` deploys to production.
5. Smoke test: `/login`, `/manifest.webmanifest`, `/offline`; log in; install from the
   browser menu on a phone (the service worker runs in production builds only).

Migrations are not run by Vercel: apply new files in `supabase/migrations/` through the
SQL Editor first, record them in `supabase/APPLIED.md`, then deploy.

## Scripts

- `npm test`: unit tests plus database tests. The DB tests run every migration in
  in-process Postgres (PGlite) and check permissions and business rules.
- `npm run typecheck`, `npm run lint`, `npm run build`
