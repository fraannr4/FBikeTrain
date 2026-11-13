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
    create table auth.users (id uuid primary key, email text, is_anonymous boolean not null default false);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
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
  await db.exec(await readFile(new URL('../supabase/migrations/202611100001_shared_ors_quota.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202611130004_ors_user_minute.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/tests/shared_ors_quota.sql', import.meta.url), 'utf8'));
  console.log('PASS: cuotas del motor de rutas compartido por usuario/global y permisos exclusivos del servidor.');
  await db.exec(await readFile(new URL('../supabase/migrations/202611100002_route_sources_cache.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/tests/route_sources_cache.sql', import.meta.url), 'utf8'));
  console.log('PASS: caché de fuentes, TTL de siete días, límite por proveedor y permisos exclusivos del servidor.');
  await db.exec(await readFile(new URL('../supabase/migrations/202611100003_route_sources_quota.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/tests/route_sources_quota.sql', import.meta.url), 'utf8'));
  console.log('PASS: cuotas de fuentes por cuenta, rechazo de anónimos, purga acotada y geometrías de hasta 2.000 puntos.');
  await db.exec(await readFile(new URL('../supabase/migrations/202611100004_shared_ai_quota_raise.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/tests/shared_ai_quota_raise.sql', import.meta.url), 'utf8'));
  console.log('PASS: cuota de la IA compartida subida: 30 por usuario y 300 globales al día, 10 globales por minuto.');
  await db.exec(await readFile(new URL('../supabase/migrations/202611120002_rwgps_route_index.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/tests/rwgps_route_index.sql', import.meta.url), 'utf8'));
  console.log('PASS: índice de rutas de Ride with GPS: búsqueda por caja y radio, una fila de estado y permisos exclusivos del servidor.');
  await db.exec(await readFile(new URL('../supabase/migrations/202611130001_zona_buscador.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/tests/profile_search.sql', import.meta.url), 'utf8'));
  console.log('PASS: zona aproximada del perfil, búsqueda por nombre y cerca, y listado de amistades.');
  await db.exec(await readFile(new URL('../supabase/migrations/202611130002_retos.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/tests/challenges.sql', import.meta.url), 'utf8'));
  console.log('PASS: retos 1 contra 1 solo entre amigos, plazo de 30 días, resultados con cifras y lectura solo para los dos.');
  await db.exec(await readFile(new URL('../supabase/migrations/202611130003_zona_privacidad.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/tests/zona_privacidad.sql', import.meta.url), 'utf8'));
  console.log('PASS: zona privada: distancia por bandas de 5, 10, 25 y 50 km y 3 cambios de celda como mucho en 24 h.');
} finally {
  await db.close();
}
