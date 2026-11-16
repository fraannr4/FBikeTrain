begin;

create function pg_temp.assert_reference(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %', message; end if;
end $$;
create function pg_temp.expect_reference_denied(statement text) returns void
language plpgsql as $$ begin
  begin execute statement;
  exception when insufficient_privilege then return; end;
  raise exception 'FAIL: operación no denegada: %', statement;
end $$;

-- Ni el navegador anónimo ni una cuenta leen o escriben la biblioteca común: solo el servidor.
set local role anon;
select pg_temp.expect_reference_denied('select * from public.reference_routes');
select pg_temp.expect_reference_denied('insert into public.reference_routes(source,source_id,url,distance_m,start_lat,start_lng,min_lat,max_lat,min_lng,max_lng,line,loop) values (''other'',''x'',''https://example.com'',1,41,2.5,41,41,2.5,2.5,''[[2.5,41],[2.5,41]]'',false)');
select pg_temp.expect_reference_denied('select * from public.reference_heat_cells');
select pg_temp.expect_reference_denied('insert into public.reference_heat_cells(cell,lat,lng,routes) values (''1:1'',41,2.5,1)');
select pg_temp.expect_reference_denied('select public.upsert_reference_routes(''[]'')');
select pg_temp.expect_reference_denied('select * from public.reference_routes_in_box(40, 42, 2, 3)');
select pg_temp.expect_reference_denied('select * from public.reference_heat_cells_in_box(40, 42, 2, 3)');
select pg_temp.expect_reference_denied('select public.replace_reference_heat_cells(''[]'', null)');
set local role authenticated;
select pg_temp.expect_reference_denied('select * from public.reference_routes');
select pg_temp.expect_reference_denied('insert into public.reference_routes(source,source_id,url,distance_m,start_lat,start_lng,min_lat,max_lat,min_lng,max_lng,line,loop) values (''other'',''x'',''https://example.com'',1,41,2.5,41,41,2.5,2.5,''[[2.5,41],[2.5,41]]'',false)');
select pg_temp.expect_reference_denied('select * from public.reference_heat_cells');
select pg_temp.expect_reference_denied('insert into public.reference_heat_cells(cell,lat,lng,routes) values (''1:1'',41,2.5,1)');
select pg_temp.expect_reference_denied('select public.upsert_reference_routes(''[]'')');
select pg_temp.expect_reference_denied('select * from public.reference_routes_in_box(40, 42, 2, 3)');
select pg_temp.expect_reference_denied('select * from public.reference_heat_cells_in_box(40, 42, 2, 3)');
select pg_temp.expect_reference_denied('select public.replace_reference_heat_cells(''[]'', null)');

set local role service_role;
-- Rutas sintéticas en el mar frente a la costa: una en (41.0, 2.5) y otra unos 50 km al este.
select pg_temp.assert_reference(public.upsert_reference_routes('[
  {"source":"other","source_id":"aqui","url":"https://example.com/aqui","name":"Aquí","author":"A","distance_m":60000,"elev_gain_m":500,
   "start_lat":41.0,"start_lng":2.5,"min_lat":41.0,"max_lat":41.1,"min_lng":2.5,"max_lng":2.55,
   "line":[[2.5,41.0,10],[2.55,41.1,120]],"loop":true,"unpaved_pct":0},
  {"source":"rwgps","source_id":"12345","url":"https://ridewithgps.com/routes/12345","name":"Este","author":"B","distance_m":40000,"elev_gain_m":null,
   "start_lat":41.0,"start_lng":3.1,"min_lat":41.0,"max_lat":41.1,"min_lng":3.1,"max_lng":3.15,
   "line":[[3.1,41.0],[3.15,41.1]],"loop":false,"unpaved_pct":null}
]') = 2, 'upsert de dos rutas devuelve 2');
select pg_temp.assert_reference(public.upsert_reference_routes('[
  {"source":"other","source_id":"aqui","url":"https://example.com/aqui","name":"Aquí renombrada","author":"A","distance_m":60000,"elev_gain_m":500,
   "start_lat":41.0,"start_lng":2.5,"min_lat":41.0,"max_lat":41.1,"min_lng":2.5,"max_lng":2.55,
   "line":[[2.5,41.0,10],[2.55,41.1,120]],"loop":true,"unpaved_pct":0}
]') = 1, 'upsert de una ruta repetida devuelve 1');
select pg_temp.assert_reference((select count(*) = 2 from public.reference_routes), 'repetir una ruta no duplica filas');
select pg_temp.assert_reference((select name = 'Aquí renombrada' from public.reference_routes where source = 'other' and source_id = 'aqui'), 'el upsert actualiza el nombre');
select pg_temp.assert_reference((select elev_gain_m is null from public.reference_routes where source = 'rwgps'), 'sin altitud queda null');
select pg_temp.assert_reference((select array_agg(source_id) = array['aqui'] from public.reference_routes_in_box(41.05, 41.2, 2.4, 2.52)), 'caja que corta la ruta cercana y no la del este');
select pg_temp.assert_reference((select count(*) = 0 from public.reference_routes_in_box(42.5, 43, 2.4, 2.6)), 'caja sin rutas');

do $$ begin
  begin
    insert into public.reference_routes(source,source_id,url,distance_m,start_lat,start_lng,min_lat,max_lat,min_lng,max_lng,line,loop)
      values ('other','p1','https://example.com',1,41,2.5,41,41,2.5,2.5,'[[2.5,41]]',false);
    raise exception 'FAIL: línea de un punto aceptada';
  exception when check_violation then null; end;
  begin
    insert into public.reference_routes(source,source_id,url,distance_m,start_lat,start_lng,min_lat,max_lat,min_lng,max_lng,line,loop)
      values ('other','p2001','https://example.com',1,41,2.5,41,41,2.5,2.5,
        (select jsonb_agg(jsonb_build_array(2.5, 41)) from generate_series(1, 2001)),false);
    raise exception 'FAIL: línea de 2.001 puntos aceptada';
  exception when check_violation then null; end;
  begin
    insert into public.reference_routes(source,source_id,url,distance_m,start_lat,start_lng,min_lat,max_lat,min_lng,max_lng,line,loop)
      values ('user','u1','https://example.com',1,41,2.5,41,41,2.5,2.5,'[[2.5,41],[2.5,41]]',false);
    raise exception 'FAIL: origen user aceptado';
  exception when check_violation then null; end;
  begin
    insert into public.reference_routes(source,source_id,url,distance_m,start_lat,start_lng,min_lat,max_lat,min_lng,max_lng,line,loop)
      values ('other','h1','http://example.com',1,41,2.5,41,41,2.5,2.5,'[[2.5,41],[2.5,41]]',false);
    raise exception 'FAIL: url http aceptada';
  exception when check_violation then null; end;
  begin
    insert into public.reference_heat_cells(cell,lat,lng,routes) values ('abc',41,2.5,1);
    raise exception 'FAIL: clave de cuadrícula no válida aceptada';
  exception when check_violation then null; end;
end $$;

-- Mapa de calor: dos celdas dentro de la caja de prueba y una fuera.
select pg_temp.assert_reference(public.replace_reference_heat_cells('[
  {"cell":"1:1","lat":41.0,"lng":2.5,"routes":3,"climbMPerKm":12.5,"ele":10},
  {"cell":"1:2","lat":41.01,"lng":2.51,"routes":1,"climbMPerKm":null,"ele":null},
  {"cell":"9:9","lat":42.0,"lng":3.5,"routes":2,"climbMPerKm":0,"ele":5}
]', null) = 3, 'carga inicial de tres celdas');
select pg_temp.assert_reference((select climb_m_per_km = 12.5 and ele = 10 from public.reference_heat_cells where cell = '1:1'), 'subida y altitud guardadas');
select pg_temp.assert_reference((select climb_m_per_km is null and ele is null from public.reference_heat_cells where cell = '1:2'), 'sin altitud no inventa subida');
select pg_temp.assert_reference((select array_agg(cell) = array['1:1', '9:9', '1:2'] from public.reference_heat_cells_in_box(40, 43, 2, 4)), 'orden por rutas descendente');
select pg_temp.assert_reference(public.replace_reference_heat_cells('[{"cell":"1:3","lat":41.02,"lng":2.52,"routes":4,"climbMPerKm":5,"ele":50}]',
  '{"minLat":40.95,"maxLat":41.05,"minLng":2.45,"maxLng":2.55}') = 1, 'sustituir la caja devuelve 1');
select pg_temp.assert_reference((select array_agg(cell order by cell) = array['1:3', '9:9'] from public.reference_heat_cells), 'borra las celdas de dentro y conserva la de fuera');
select pg_temp.assert_reference(public.replace_reference_heat_cells('[{"cell":"1:4","lat":41.03,"lng":2.53,"routes":1,"climbMPerKm":null,"ele":null}]',
  '{"minLat":40.95,"maxLat":41.05,"minLng":2.45,"maxLng":2.55}', true) = 1, 'añadir devuelve 1');
select pg_temp.assert_reference((select array_agg(cell order by cell) = array['1:3', '1:4', '9:9'] from public.reference_heat_cells), 'añadir no borra');
do $$ begin
  begin
    perform public.replace_reference_heat_cells('[{"cell":"5:5","lat":42.5,"lng":2.5,"routes":1,"climbMPerKm":null,"ele":null}]',
      '{"minLat":40.95,"maxLat":41.05,"minLng":2.45,"maxLng":2.55}');
    raise exception 'FAIL: celda fuera de la caja aceptada';
  exception when invalid_parameter_value then null; end;
end $$;
select pg_temp.assert_reference((select count(*) = 3 from public.reference_heat_cells), 'el rechazo no borra nada');
select pg_temp.assert_reference(public.replace_reference_heat_cells('[]', null) = 0, 'vaciar toda la tabla devuelve 0');
select pg_temp.assert_reference((select count(*) = 0 from public.reference_heat_cells), 'sin caja vacía la tabla');

-- Ride with GPS como proveedor de la caché y del reloj de route-sources.
select pg_temp.assert_reference(public.claim_route_source_request('rwgps'), 'primer turno de rwgps admitido');
select pg_temp.assert_reference(not public.claim_route_source_request('rwgps'), 'segundo turno inmediato de rwgps rechazado');
insert into public.route_sources_cache(cache_key,source,payload) values ('rwgps-sintetica','rwgps','[]');
select pg_temp.assert_reference((select count(*) = 1 from public.route_sources_cache where source = 'rwgps'), 'la caché acepta rwgps');

reset role;
select pg_temp.assert_reference((select bool_and(not prosecdef) from pg_proc where oid in (
  'public.upsert_reference_routes(jsonb)'::regprocedure,
  'public.reference_routes_in_box(double precision,double precision,double precision,double precision)'::regprocedure,
  'public.reference_heat_cells_in_box(double precision,double precision,double precision,double precision)'::regprocedure,
  'public.replace_reference_heat_cells(jsonb,jsonb,boolean)'::regprocedure,
  'public.claim_route_source_request(text)'::regprocedure)), 'RPC sin elevación de privilegios');
select pg_temp.assert_reference((select relrowsecurity from pg_class where oid = 'public.reference_routes'::regclass), 'RLS rutas activado');
select pg_temp.assert_reference((select relrowsecurity from pg_class where oid = 'public.reference_heat_cells'::regclass), 'RLS calor activado');

rollback;
