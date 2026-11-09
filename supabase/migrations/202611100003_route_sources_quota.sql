begin;

create table public.route_sources_usage (
  account_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null check (bucket in ('day', 'minute')),
  window_start timestamptz not null,
  calls integer not null check (calls >= 0),
  primary key (account_id, bucket, window_start)
);
alter table public.route_sources_usage enable row level security;
revoke all on public.route_sources_usage from public, anon, authenticated;
grant select, insert, update, delete on public.route_sources_usage to service_role;
create policy route_sources_usage_server on public.route_sources_usage
  for all to service_role using (true) with check (true);

-- Se llama tras Auth y antes de cualquier lectura de caché, incluso en hits.
-- SECURITY DEFINER solo para verificar auth.users; ejecución exclusiva del servidor.
create function public.consume_route_sources_quota(account_id uuid)
returns table(allowed boolean, retry_after_s integer)
language plpgsql security definer set search_path = '' as $$
declare
  checked_account uuid := account_id;
  current_at timestamptz;
  day_start timestamptz;
  minute_start timestamptz;
begin
  if checked_account is null or not exists (
    select 1 from auth.users u where u.id = checked_account and u.is_anonymous = false
  ) then
    raise exception 'Cuenta no válida' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fbiketrain_route_sources_quota:' || checked_account::text, 0));
  current_at := clock_timestamp();
  day_start := date_trunc('day', current_at at time zone 'UTC') at time zone 'UTC';
  minute_start := date_trunc('minute', current_at);
  if coalesce((select calls from public.route_sources_usage u
      where u.account_id = checked_account and bucket = 'day' and window_start = day_start), 0) >= 30 then
    return query select false, greatest(1, ceil(extract(epoch from day_start + interval '24 hours' - current_at))::integer);
    return;
  end if;
  if coalesce((select calls from public.route_sources_usage u
      where u.account_id = checked_account and bucket = 'minute' and window_start = minute_start), 0) >= 3 then
    return query select false, greatest(1, ceil(extract(epoch from minute_start + interval '1 minute' - current_at))::integer);
    return;
  end if;
  with expired as (
    select u.account_id, u.bucket, u.window_start from public.route_sources_usage u
    where u.account_id = checked_account and u.window_start < day_start - interval '48 hours'
    order by u.window_start limit 100 for update skip locked
  ) delete from public.route_sources_usage u using expired e
    where u.account_id = e.account_id and u.bucket = e.bucket and u.window_start = e.window_start;
  insert into public.route_sources_usage as usage(account_id, bucket, window_start, calls)
    values (checked_account, 'day', day_start, 1), (checked_account, 'minute', minute_start, 1)
    on conflict on constraint route_sources_usage_pkey do update set calls = usage.calls + 1;
  return query select true, 0;
end;
$$;
revoke all on function public.consume_route_sources_quota(uuid) from public, anon, authenticated;
grant execute on function public.consume_route_sources_quota(uuid) to service_role;

-- Mantiene caché y purga en una transacción sin escanear/borrar todas las filas vencidas.
create function public.write_route_sources_cache(
  p_cache_key text, p_source text, p_payload jsonb, p_fetched_at timestamptz
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  reference jsonb;
  points bigint;
  purge_at timestamptz := clock_timestamp();
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'array' then
    raise exception 'Referencias no válidas' using errcode = '22023';
  end if;
  if jsonb_array_length(p_payload) > 10 then
    raise exception 'Demasiadas referencias' using errcode = '22023';
  end if;
  for reference in select value from jsonb_array_elements(p_payload) loop
    if reference ? 'geometry' then
      if reference->'geometry'->>'type' is distinct from 'MultiLineString'
        or jsonb_typeof(reference->'geometry'->'coordinates') is distinct from 'array' then
        raise exception 'Geometría no válida' using errcode = '22023';
      end if;
      select coalesce(sum(jsonb_array_length(value)), 0) into points
        from jsonb_array_elements(reference->'geometry'->'coordinates');
      if points > 2000 then
        raise exception 'Geometría demasiado grande' using errcode = '22023';
      end if;
    end if;
  end loop;
  with expired as (
    select cache_key from public.route_sources_cache
    where expires_at <= purge_at
    order by expires_at, cache_key limit 100 for update skip locked
  ) delete from public.route_sources_cache c using expired e where c.cache_key = e.cache_key;
  insert into public.route_sources_cache(cache_key, source, payload, fetched_at, expires_at)
    values (p_cache_key, p_source, p_payload, p_fetched_at, p_fetched_at + interval '168 hours')
    on conflict (cache_key) do update set source = excluded.source, payload = excluded.payload,
      fetched_at = excluded.fetched_at, expires_at = excluded.expires_at;
end;
$$;
revoke all on function public.write_route_sources_cache(text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.write_route_sources_cache(text, text, jsonb, timestamptz) to service_role;

commit;
