/**
 * A real Postgres (PGlite, Postgres compiled to WebAssembly) with just enough
 * of Supabase's `auth` and `storage` schemas stubbed for the migrations to
 * run unchanged. Row-level security, foreign keys, checks and functions are
 * enforced by Postgres itself, so security tests exercise the real policies.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.resolve(import.meta.dirname, "../../../../supabase/migrations");

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;

  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text not null,
    owner uuid default auth.uid(),
    created_at timestamptz default now(),
    unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
  grant select on storage.buckets to authenticated;
  grant usage on schema public to anon, authenticated;
`;

export async function createTestDatabase() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS, file), "utf8"));
  }
  return db;
}

/** Runs `work` as a signed-in player (role `authenticated`, `auth.uid()` = userId), inside a transaction. */
export async function asUser<T>(db: PGlite, userId: string | null, work: (tx: Pick<PGlite, "query" | "exec">) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${userId ? "authenticated" : "anon"}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ""]);
    return work(tx);
  });
}
