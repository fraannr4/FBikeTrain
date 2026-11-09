begin;

-- Referencias públicas, nunca tracks privados del usuario. La API de navegador no accede.
create table public.route_sources_cache (
  cache_key text primary key check (length(cache_key) between 1 and 200),
  source text not null check (source in ('wikiloc', 'osm')),
  payload jsonb not null check (jsonb_typeof(payload) = 'array'),
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '168 hours'),
  constraint route_sources_cache_seven_day_ttl check (expires_at = fetched_at + interval '168 hours')
);
create index route_sources_cache_expiry on public.route_sources_cache (expires_at);
alter table public.route_sources_cache enable row level security;
revoke all on public.route_sources_cache from public, anon, authenticated;
grant select, insert, update, delete on public.route_sources_cache to service_role;
create policy route_sources_cache_server on public.route_sources_cache
  for all to service_role using (true) with check (true);

-- Un único reloj por proveedor/proyecto; el límite no se reinicia en cada instancia Edge.
create table public.route_source_request_slots (
  provider text primary key check (provider in ('wikiloc', 'osm')),
  last_requested_at timestamptz not null
);
alter table public.route_source_request_slots enable row level security;
revoke all on public.route_source_request_slots from public, anon, authenticated;
grant select, insert, update, delete on public.route_source_request_slots to service_role;
create policy route_source_slots_server on public.route_source_request_slots
  for all to service_role using (true) with check (true);

create function public.claim_route_source_request(provider text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  granted boolean := false;
begin
  if provider is null or provider not in ('wikiloc', 'osm') then
    raise exception 'Proveedor no válido' using errcode = '22023';
  end if;
  -- No dormir ni acumular una cola de peticiones; el llamador recibe un rechazo controlado.
  if not pg_try_advisory_xact_lock(hashtextextended('fbiketrain_route_source:' || provider, 0)) then
    return false;
  end if;
  insert into public.route_source_request_slots as slots (provider, last_requested_at)
    values (provider, clock_timestamp())
    on conflict on constraint route_source_request_slots_pkey do update set last_requested_at = clock_timestamp()
    where slots.last_requested_at <= clock_timestamp() - interval '1 second'
    returning true into granted;
  return coalesce(granted, false);
end;
$$;
revoke all on function public.claim_route_source_request(text) from public, anon, authenticated;
grant usage on schema public to service_role;
grant execute on function public.claim_route_source_request(text) to service_role;

commit;
