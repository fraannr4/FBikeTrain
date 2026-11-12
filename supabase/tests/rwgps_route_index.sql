begin;

create function pg_temp.assert_rwgps_index(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %', message; end if;
end $$;
create function pg_temp.expect_rwgps_index_denied(statement text) returns void
language plpgsql as $$ begin
  begin execute statement;
  exception when insufficient_privilege then return; end;
  raise exception 'FAIL: operación no denegada: %', statement;
end $$;

set local role anon;
select pg_temp.expect_rwgps_index_denied('select * from public.rwgps_route_index');
select pg_temp.expect_rwgps_index_denied('select * from public.rwgps_sync_state');
select pg_temp.expect_rwgps_index_denied('select * from public.rwgps_routes_near(41, 2, 10)');
set local role authenticated;
select pg_temp.expect_rwgps_index_denied('select * from public.rwgps_route_index');
select pg_temp.expect_rwgps_index_denied('insert into public.rwgps_route_index(id,distance_m,start_lat,start_lng,min_lat,max_lat,min_lng,max_lng,line,source) values (1,1,0,0,0,0,0,0,''[[0,0],[0,0]]'',''user'')');
select pg_temp.expect_rwgps_index_denied('update public.rwgps_sync_state set last_sync_at = now()');
select pg_temp.expect_rwgps_index_denied('select * from public.rwgps_routes_near(41, 2, 10)');

set local role service_role;
select pg_temp.assert_rwgps_index((select count(*) = 1 and bool_and(last_sync_at is null) from public.rwgps_sync_state), 'una fila de estado sin sincronizar');
-- Rutas sintéticas de norte a sur: una en el punto, otra a ~6 km al este, otra a ~50 km.
insert into public.rwgps_route_index(id,name,author,distance_m,elev_gain_m,start_lat,start_lng,min_lat,max_lat,min_lng,max_lng,line,source) values
  (1,'Aquí','A',50000,300,41,2,41,41.1,2,2,'[[2,41],[2,41.1]]','seed'),
  (2,'Este','A',60000,null,41,2.07,41,41.1,2.07,2.07,'[[2.07,41],[2.07,41.1]]','seed'),
  (3,'Lejos','A',70000,100,41,2.6,41,41.1,2.6,2.6,'[[2.6,41],[2.6,41.1]]','user');
select pg_temp.assert_rwgps_index((select array_agg(id order by id) = array[1::bigint, 2] from public.rwgps_routes_near(41.05, 2, 10)), 'cerca: solo las cajas a menos de 10 km');
select pg_temp.assert_rwgps_index((select array_agg(id order by id) = array[1::bigint] from public.rwgps_routes_near(41.05, 2, 1)), 'radio pequeño');
select pg_temp.assert_rwgps_index((select count(*) = 0 from public.rwgps_routes_near(42.5, 2, 30)), 'fuera de todas las cajas');
update public.rwgps_sync_state set last_sync_at = now(), last_error = 'provider_busy' where id = 1;
delete from public.rwgps_route_index where id = 3;

do $$ begin
  begin
    insert into public.rwgps_route_index(id,distance_m,start_lat,start_lng,min_lat,max_lat,min_lng,max_lng,line,source) values (9,1,0,0,0,0,0,0,'[[0,0]]','seed');
    raise exception 'FAIL: línea de un punto aceptada';
  exception when check_violation then null; end;
  begin
    insert into public.rwgps_route_index(id,distance_m,start_lat,start_lng,min_lat,max_lat,min_lng,max_lng,line,source) values (9,1,0,0,0,0,0,0,'[[0,0],[0,0]]','otro');
    raise exception 'FAIL: origen desconocido aceptado';
  exception when check_violation then null; end;
  begin
    insert into public.rwgps_sync_state(id) values (2);
    raise exception 'FAIL: segunda fila de estado aceptada';
  exception when check_violation or insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.assert_rwgps_index((select not prosecdef from pg_proc where oid = 'public.rwgps_routes_near(double precision,double precision,double precision)'::regprocedure), 'RPC sin elevación de privilegios');
select pg_temp.assert_rwgps_index((select relrowsecurity from pg_class where oid = 'public.rwgps_route_index'::regclass), 'RLS índice activado');
select pg_temp.assert_rwgps_index((select relrowsecurity from pg_class where oid = 'public.rwgps_sync_state'::regclass), 'RLS estado activado');

rollback;
