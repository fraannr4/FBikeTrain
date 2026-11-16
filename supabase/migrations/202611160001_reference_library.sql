begin;

-- Biblioteca común de rutas de referencia (públicas, nunca tracks privados del usuario) y su mapa de calor
-- por cuadrículas de 200 m. Solo la escriben el servidor (service_role) y el script del administrador.
create table public.reference_routes (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('rwgps', 'komoot', 'bikemap', 'wikiloc', 'strava', 'other')),
  source_id text not null check (char_length(source_id) between 1 and 64),
  url text not null check (url ~ '^https://' and char_length(url) <= 500),
  name text not null default '' check (char_length(name) <= 300),
  -- Para la etiqueta de la tarjeta («Ride with GPS · autor»), como tenía rwgps_route_index.
  author text not null default '' check (char_length(author) <= 200),
  distance_m integer not null check (distance_m > 0),
  elev_gain_m integer check (elev_gain_m >= 0),
  start_lat double precision not null check (start_lat between -90 and 90),
  start_lng double precision not null check (start_lng between -180 and 180),
  min_lat double precision not null check (min_lat between -90 and 90),
  max_lat double precision not null check (max_lat between -90 and 90 and max_lat >= min_lat),
  min_lng double precision not null check (min_lng between -180 and 180),
  max_lng double precision not null check (max_lng between -180 and 180 and max_lng >= min_lng),
  -- [[lng, lat, ele?], ...], como mucho 2.000 puntos.
  line jsonb not null check (jsonb_typeof(line) = 'array' and jsonb_array_length(line) between 2 and 2000),
  loop boolean not null,
  unpaved_pct real check (unpaved_pct between 0 and 100),
  imported_at timestamptz not null default now(),
  unique (source, source_id)
);
create index reference_routes_lat on public.reference_routes (min_lat, max_lat);
create index reference_routes_lng on public.reference_routes (min_lng, max_lng);
alter table public.reference_routes enable row level security;
revoke all on public.reference_routes from public, anon, authenticated;
grant select, insert, update, delete on public.reference_routes to service_role;
create policy reference_routes_server on public.reference_routes
  for all to service_role using (true) with check (true);

create table public.reference_heat_cells (
  cell text primary key check (cell ~ '^-?\d+:-?\d+$'),
  -- Punto real de una ruta dentro de la celda.
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  routes integer not null check (routes >= 1),
  climb_m_per_km real check (climb_m_per_km >= 0),
  ele real
);
create index reference_heat_cells_lat_lng on public.reference_heat_cells (lat, lng);
alter table public.reference_heat_cells enable row level security;
revoke all on public.reference_heat_cells from public, anon, authenticated;
grant select, insert, update, delete on public.reference_heat_cells to service_role;
create policy reference_heat_cells_server on public.reference_heat_cells
  for all to service_role using (true) with check (true);

-- p_rows: lista de filas con los nombres de columna (snake_case). Una ruta ya importada se actualiza entera.
create function public.upsert_reference_routes(p_rows jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  affected integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Rutas no válidas' using errcode = '22023';
  end if;
  insert into public.reference_routes as r (source, source_id, url, name, author, distance_m, elev_gain_m,
    start_lat, start_lng, min_lat, max_lat, min_lng, max_lng, line, loop, unpaved_pct)
  select x.source, x.source_id, x.url, coalesce(x.name, ''), coalesce(x.author, ''), x.distance_m, x.elev_gain_m,
    x.start_lat, x.start_lng, x.min_lat, x.max_lat, x.min_lng, x.max_lng, x.line, x.loop, x.unpaved_pct
  from jsonb_populate_recordset(null::public.reference_routes, p_rows) x
  on conflict (source, source_id) do update set
    url = excluded.url, name = excluded.name, author = excluded.author, distance_m = excluded.distance_m,
    elev_gain_m = excluded.elev_gain_m, start_lat = excluded.start_lat, start_lng = excluded.start_lng,
    min_lat = excluded.min_lat, max_lat = excluded.max_lat, min_lng = excluded.min_lng, max_lng = excluded.max_lng,
    line = excluded.line, loop = excluded.loop, unpaved_pct = excluded.unpaved_pct, imported_at = now();
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.upsert_reference_routes(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_reference_routes(jsonb) to service_role;

-- Rutas cuya caja se corta con la pedida.
create function public.reference_routes_in_box(
  p_min_lat double precision, p_max_lat double precision, p_min_lng double precision, p_max_lng double precision
) returns setof public.reference_routes
language sql stable security invoker set search_path = '' as $$
  select r.* from public.reference_routes r
  where r.min_lat <= p_max_lat and r.max_lat >= p_min_lat
    and r.min_lng <= p_max_lng and r.max_lng >= p_min_lng
  order by r.source, r.source_id
  limit 1000;
$$;
revoke all on function public.reference_routes_in_box(double precision, double precision, double precision, double precision) from public, anon, authenticated;
grant execute on function public.reference_routes_in_box(double precision, double precision, double precision, double precision) to service_role;

create function public.reference_heat_cells_in_box(
  p_min_lat double precision, p_max_lat double precision, p_min_lng double precision, p_max_lng double precision
) returns setof public.reference_heat_cells
language sql stable security invoker set search_path = '' as $$
  select c.* from public.reference_heat_cells c
  where c.lat between p_min_lat and p_max_lat and c.lng between p_min_lng and p_max_lng
  order by c.routes desc, c.cell
  limit 20000;
$$;
revoke all on function public.reference_heat_cells_in_box(double precision, double precision, double precision, double precision) from public, anon, authenticated;
grant execute on function public.reference_heat_cells_in_box(double precision, double precision, double precision, double precision) to service_role;

-- p_cells: HeatCell[] ({cell, lat, lng, routes, climbMPerKm, ele}). p_box: {minLat, maxLat, minLng, maxLng}
-- o null (toda la tabla). Sin p_append borra antes las celdas de la caja. Una celda fuera de la caja se rechaza.
create function public.replace_reference_heat_cells(p_cells jsonb, p_box jsonb, p_append boolean default false)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  min_lat double precision := (p_box->>'minLat')::double precision;
  max_lat double precision := (p_box->>'maxLat')::double precision;
  min_lng double precision := (p_box->>'minLng')::double precision;
  max_lng double precision := (p_box->>'maxLng')::double precision;
  affected integer;
begin
  if p_cells is null or jsonb_typeof(p_cells) <> 'array' then
    raise exception 'Celdas no válidas' using errcode = '22023';
  end if;
  if p_box is not null and jsonb_typeof(p_box) <> 'null'
    and (min_lat is null or max_lat is null or min_lng is null or max_lng is null) then
    raise exception 'Caja no válida' using errcode = '22023';
  end if;
  if min_lat is not null and exists (
    select 1 from jsonb_array_elements(p_cells) e
    where not ((e.value->>'lat')::double precision between min_lat and max_lat
           and (e.value->>'lng')::double precision between min_lng and max_lng)
  ) then
    raise exception 'Celda fuera de la caja' using errcode = '22023';
  end if;
  if not coalesce(p_append, false) then
    if min_lat is null then
      delete from public.reference_heat_cells where true;
    else
      delete from public.reference_heat_cells
        where lat between min_lat and max_lat and lng between min_lng and max_lng;
    end if;
  end if;
  insert into public.reference_heat_cells as h (cell, lat, lng, routes, climb_m_per_km, ele)
  select e.value->>'cell', (e.value->>'lat')::double precision, (e.value->>'lng')::double precision,
    (e.value->>'routes')::integer, (e.value->>'climbMPerKm')::real, (e.value->>'ele')::real
  from jsonb_array_elements(p_cells) e
  on conflict (cell) do update set lat = excluded.lat, lng = excluded.lng, routes = excluded.routes,
    climb_m_per_km = excluded.climb_m_per_km, ele = excluded.ele;
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.replace_reference_heat_cells(jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.replace_reference_heat_cells(jsonb, jsonb, boolean) to service_role;

-- Ride with GPS pasa a ser proveedor de route-sources (llenado automático de zonas): caché y reloj propios.
alter table public.route_sources_cache drop constraint route_sources_cache_source_check,
  add constraint route_sources_cache_source_check check (source in ('wikiloc', 'osm', 'rwgps'));
alter table public.route_source_request_slots drop constraint route_source_request_slots_provider_check,
  add constraint route_source_request_slots_provider_check check (provider in ('wikiloc', 'osm', 'rwgps'));

create or replace function public.claim_route_source_request(provider text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  granted boolean := false;
begin
  if provider is null or provider not in ('wikiloc', 'osm', 'rwgps') then
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
grant execute on function public.claim_route_source_request(text) to service_role;

commit;
