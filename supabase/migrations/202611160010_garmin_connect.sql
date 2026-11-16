-- Direct Garmin Connect. Server only: clients never receive encrypted tokens or PKCE verifiers.
create table public.garmin_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  garmin_user_id text not null unique,
  ciphertext text not null,
  expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  permissions text[] not null default '{}',
  last_sync_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.garmin_oauth_states (
  state_hash text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  verifier text not null,
  expires_at timestamptz not null
);
-- Tokens already exchanged by the public /callback, waiting for /complete from the signed-in account
-- that started the flow (OAuth CSRF). One use, 5 minutes; code_hash is the SHA-256 of the browser code.
create table public.garmin_pending_connections (
  code_hash text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  garmin_user_id text not null,
  ciphertext text not null,
  token_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  permissions text[] not null default '{}',
  expires_at timestamptz not null
);
create table public.garmin_account_locks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  owner uuid not null,
  expires_at timestamptz not null
);
create table public.garmin_activity_files (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,128}$'),
  object_path text not null unique,
  device_name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, id)
);
create index garmin_activity_expiry on public.garmin_activity_files(expires_at);
create table public.garmin_notification_queue (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  kind text not null check (kind in ('activity', 'permissions', 'deletion')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done')),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.garmin_connections enable row level security;
alter table public.garmin_oauth_states enable row level security;
alter table public.garmin_pending_connections enable row level security;
alter table public.garmin_account_locks enable row level security;
alter table public.garmin_activity_files enable row level security;
alter table public.garmin_notification_queue enable row level security;
-- Deliberately no anon/authenticated policy. Ownership is checked by the server from auth.getUser.
revoke all on public.garmin_connections, public.garmin_oauth_states, public.garmin_pending_connections, public.garmin_account_locks, public.garmin_activity_files, public.garmin_notification_queue from anon, authenticated;
grant all on public.garmin_connections, public.garmin_oauth_states, public.garmin_pending_connections, public.garmin_account_locks, public.garmin_activity_files, public.garmin_notification_queue to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('garmin-originals', 'garmin-originals', false, 20971520, array['application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- Bucket is private and has no client policy: files are served only through the authenticated Edge Function.

create function public.garmin_consume_state(state_key text)
returns table(user_id uuid, verifier text, expires_at timestamptz)
language sql security definer set search_path = public
as $$ delete from public.garmin_oauth_states where state_hash = state_key returning user_id, verifier, expires_at $$;

create function public.garmin_consume_completion(code_key text)
returns table(user_id uuid, garmin_user_id text, ciphertext text, token_expires_at timestamptz, refresh_expires_at timestamptz, permissions text[], expires_at timestamptz)
language sql security definer set search_path = public
as $$ delete from public.garmin_pending_connections where code_hash = code_key
  returning user_id, garmin_user_id, ciphertext, token_expires_at, refresh_expires_at, permissions, expires_at $$;

create function public.garmin_acquire_lock(account_id uuid, lock_owner uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare acquired uuid;
begin
  insert into public.garmin_account_locks(user_id, owner, expires_at)
  values(account_id, lock_owner, now() + interval '90 seconds')
  on conflict(user_id) do update set owner = excluded.owner, expires_at = excluded.expires_at
  where garmin_account_locks.expires_at < now()
  returning owner into acquired;
  return acquired is not null;
end $$;

create function public.garmin_claim_event(account_id uuid, event_id text, event_kind text)
returns boolean language plpgsql security definer set search_path = public as $$
declare claimed text;
begin
  insert into public.garmin_notification_queue(user_id,id,kind,status)
  values(account_id,event_id,event_kind,'processing')
  on conflict(user_id,id) do update set status = 'processing', updated_at = now()
  -- Caller already owns the account lease. A processing row can be left by an aborted request;
  -- a second independent event lease would create a gap where a retry could be acknowledged lost.
  where garmin_notification_queue.status in ('pending', 'processing')
  returning id into claimed;
  return claimed is not null;
end $$;

revoke all on function public.garmin_consume_state(text), public.garmin_consume_completion(text), public.garmin_acquire_lock(uuid,uuid), public.garmin_claim_event(uuid,text,text) from public, anon, authenticated;
grant execute on function public.garmin_consume_state(text), public.garmin_consume_completion(text), public.garmin_acquire_lock(uuid,uuid), public.garmin_claim_event(uuid,text,text) to service_role;
