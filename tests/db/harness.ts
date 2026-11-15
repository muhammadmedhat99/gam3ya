import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");

/**
 * The parts of a Supabase database our migrations rely on:
 * API roles, the `extensions` schema, and pgcrypto installed there.
 */
const SUPABASE_STUBS = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  create schema extensions;
  create extension pgcrypto schema extensions;
  grant usage on schema public, extensions to anon, authenticated, service_role;
`;

export type Role = "anon" | "authenticated" | "service_role";

export interface TestDb {
  db: PGlite;
  /** Run `fn` with the session switched to `role`, then switch back to postgres. */
  as<T>(role: Role, fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUBS);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }

  return {
    db,
    async as(role, fn) {
      await db.exec(`set role ${role}`);
      try {
        return await fn();
      } finally {
        await db.exec("reset role");
      }
    },
    close: () => db.close(),
  };
}
