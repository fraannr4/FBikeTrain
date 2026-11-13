begin;
create function pg_temp.assert_cache_points(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %', message; end if;
end $$;
-- 111 puntos de paso sin geometría (como «Rutas cerca» desde Caldes) se guardan.
select public.write_route_sources_cache('points', 'osm',
  (select jsonb_agg(jsonb_build_object('name', 'Punto sintético ' || n, 'lat', 0, 'lon', 0)) from generate_series(1, 111) n), now());
select pg_temp.assert_cache_points((select jsonb_array_length(payload) = 111 and expires_at - fetched_at = interval '168 hours'
  from public.route_sources_cache where cache_key = 'points'), '111 puntos sin geometría se guardan con TTL de 7 días');
-- Más de 300 no.
do $$ begin
  perform public.write_route_sources_cache('too-many', 'osm',
    (select jsonb_agg(jsonb_build_object('name', 'P' || n)) from generate_series(1, 301) n), now());
  raise exception 'FAIL: 301 puntos admitidos';
exception when invalid_parameter_value then null; end $$;
-- Con geometría sigue el límite de 10.
do $$ begin
  perform public.write_route_sources_cache('routes', 'osm',
    (select jsonb_agg(jsonb_build_object('geometry', jsonb_build_object('type', 'MultiLineString', 'coordinates', '[[[0,0],[1,1]]]'::jsonb))) from generate_series(1, 11) n), now());
  raise exception 'FAIL: 11 referencias con geometría admitidas';
exception when invalid_parameter_value then null; end $$;
rollback;
