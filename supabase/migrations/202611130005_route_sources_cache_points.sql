begin;

-- La caché de fuentes rechazaba cualquier lista de más de 10 elementos, pensada para referencias de rutas
-- con geometría. Los puntos de paso (puertos, cimas y pueblos) y los puertos llegan a cientos y no llevan
-- geometría: el guardado fallaba y «Rutas cerca» se quedaba sin puntos. Ahora se admiten hasta 300 elementos
-- cuando ninguno lleva geometría; con geometría sigue el límite de 10.
create or replace function public.write_route_sources_cache(
  p_cache_key text, p_source text, p_payload jsonb, p_fetched_at timestamptz
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  reference jsonb;
  points bigint;
  purge_at timestamptz := clock_timestamp();
  with_geometry boolean;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'array' then
    raise exception 'Referencias no válidas' using errcode = '22023';
  end if;
  select exists (select 1 from jsonb_array_elements(p_payload) e where jsonb_typeof(e.value) = 'object' and e.value ? 'geometry')
    into with_geometry;
  if jsonb_array_length(p_payload) > (case when with_geometry then 10 else 300 end) then
    raise exception 'Demasiadas referencias' using errcode = '22023';
  end if;
  for reference in select value from jsonb_array_elements(p_payload) loop
    if jsonb_typeof(reference) = 'object' and reference ? 'geometry' then
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
