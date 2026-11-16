begin;

create function pg_temp.assert_dropped(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %', message; end if;
end $$;

-- El índice antiguo de Ride with GPS y su búsqueda desaparecen; el reloj de la sincronización y la biblioteca común siguen.
select pg_temp.assert_dropped(to_regclass('public.rwgps_route_index') is null, 'rwgps_route_index sigue existiendo');
select pg_temp.assert_dropped(not exists (select 1 from pg_proc where proname = 'rwgps_routes_near' and pronamespace = 'public'::regnamespace), 'rwgps_routes_near sigue existiendo');
select pg_temp.assert_dropped(to_regclass('public.rwgps_sync_state') is not null, 'rwgps_sync_state ha desaparecido');
select pg_temp.assert_dropped(to_regclass('public.reference_routes') is not null, 'reference_routes ha desaparecido');
select pg_temp.assert_dropped((select count(*) from public.rwgps_sync_state where id = 1) = 1, 'rwgps_sync_state ha perdido su fila');

rollback;
