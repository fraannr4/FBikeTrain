import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// PostgreSQL real embebido. Solo se simulan los esquemas externos de Auth/Storage.
// La API HTTP de Storage, OAuth y los correos necesitan validación adicional en Supabase.
const db = new PGlite();
try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create schema storage;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets (id text primary key, name text, public boolean default false);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as
      $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1)-1] $$;
    grant usage on schema public, auth, storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
  `);
  const migration = new URL('../supabase/migrations/202611090001_profiles_friendships.sql', import.meta.url);
  await db.exec(await readFile(migration, 'utf8'));
  await db.exec(await readFile(new URL('../supabase/tests/profiles_friendships.sql', import.meta.url), 'utf8'));
  console.log('PASS: migración y permisos de perfiles, amistades y filas Storage (PostgreSQL embebido).');
  await db.exec(await readFile(new URL('../supabase/migrations/202611090002_shared_ai_quota.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/tests/shared_ai_quota.sql', import.meta.url), 'utf8'));
  console.log('PASS: cuotas IA por usuario/global y permisos exclusivos del servidor.');
} finally {
  await db.close();
}
