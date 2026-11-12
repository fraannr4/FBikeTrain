begin;

-- Índice propio de rutas públicas de Ride with GPS (la API no busca por zona). Lo llena la función rwgps:
-- 'seed' sale de las colecciones y rutas de la cuenta común; 'user' de una ruta pública que alguien ha leído.
-- Solo cifras resumidas y una línea simplificada; nada de la cuenta (correos, ids de usuario). Solo el servidor.
create table public.rwgps_route_index (
  id bigint primary key check (id > 0),
  name text not null default '',
  author text not null default '',
  distance_m integer not null check (distance_m >= 0),
  elev_gain_m integer check (elev_gain_m >= 0),
  start_lat double precision not null check (start_lat between -90 and 90),
  start_lng double precision not null check (start_lng between -180 and 180),
  min_lat double precision not null check (min_lat between -90 and 90),
  max_lat double precision not null check (max_lat between -90 and 90 and max_lat >= min_lat),
  min_lng double precision not null check (min_lng between -180 and 180),
  max_lng double precision not null check (max_lng between -180 and 180 and max_lng >= min_lng),
  -- [[lng, lat], ...], como mucho 300 puntos.
  line jsonb not null check (jsonb_typeof(line) = 'array' and jsonb_array_length(line) between 2 and 300),
  source text not null check (source in ('seed', 'user')),
  indexed_at timestamptz not null default now()
);
create index rwgps_route_index_lat on public.rwgps_route_index (min_lat, max_lat);
create index rwgps_route_index_lng on public.rwgps_route_index (min_lng, max_lng);
alter table public.rwgps_route_index enable row level security;
revoke all on public.rwgps_route_index from public, anon, authenticated;
grant select, insert, update, delete on public.rwgps_route_index to service_role;
create policy rwgps_route_index_server on public.rwgps_route_index
  for all to service_role using (true) with check (true);

-- Una sola fila: cuándo empezó la última pasada de sincronización y su código de error (nunca texto del proveedor).
create table public.rwgps_sync_state (
  id smallint primary key default 1 check (id = 1),
  last_sync_at timestamptz,
  last_error text check (char_length(last_error) <= 64)
);
insert into public.rwgps_sync_state(id) values (1);
alter table public.rwgps_sync_state enable row level security;
revoke all on public.rwgps_sync_state from public, anon, authenticated;
grant select, update on public.rwgps_sync_state to service_role;
create policy rwgps_sync_state_server on public.rwgps_sync_state
  for all to service_role using (true) with check (true);

-- Rutas cuya caja, ampliada con el radio (grados aproximados), contiene el punto. Primero las que empiezan
-- más cerca. El paso real por la línea lo calcula la función. SECURITY INVOKER: depende de los grants de arriba.
create function public.rwgps_routes_near(p_lat double precision, p_lng double precision, p_radius_km double precision)
returns setof public.rwgps_route_index
language sql stable security invoker set search_path = '' as $$
  with box as (
    select p_radius_km / 111.0 as dlat,
           p_radius_km / (111.0 * greatest(cos(radians(p_lat)), 0.01)) as dlng
  )
  select r.* from public.rwgps_route_index r, box b
  where p_lat between r.min_lat - b.dlat and r.max_lat + b.dlat
    and p_lng between r.min_lng - b.dlng and r.max_lng + b.dlng
  order by (r.start_lat - p_lat) ^ 2 + ((r.start_lng - p_lng) * cos(radians(p_lat))) ^ 2, r.id
  limit 400;
$$;
revoke all on function public.rwgps_routes_near(double precision, double precision, double precision) from public, anon, authenticated;
grant execute on function public.rwgps_routes_near(double precision, double precision, double precision) to service_role;

commit;
