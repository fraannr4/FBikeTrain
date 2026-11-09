begin;

create function pg_temp.assert_route_sources(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %', message; end if;
end $$;
create function pg_temp.expect_route_sources_denied(statement text) returns void
language plpgsql as $$ begin
  begin execute statement;
  exception when insufficient_privilege then return; end;
  raise exception 'FAIL: operación no denegada: %', statement;
end $$;

-- Probar las operaciones reales además de los grants del catálogo.
set local role anon;
select pg_temp.expect_route_sources_denied('select * from public.route_sources_cache');
select pg_temp.expect_route_sources_denied('insert into public.route_sources_cache(cache_key,source,payload) values (''forbidden'',''osm'',''[]'')');
select pg_temp.expect_route_sources_denied('update public.route_sources_cache set payload = ''[]''');
select pg_temp.expect_route_sources_denied('delete from public.route_sources_cache');
select pg_temp.expect_route_sources_denied('select * from public.route_source_request_slots');
select pg_temp.expect_route_sources_denied('select public.claim_route_source_request(''osm'')');
set local role authenticated;
select pg_temp.expect_route_sources_denied('select * from public.route_sources_cache');
select pg_temp.expect_route_sources_denied('insert into public.route_sources_cache(cache_key,source,payload) values (''forbidden'',''wikiloc'',''[]'')');
select pg_temp.expect_route_sources_denied('update public.route_sources_cache set payload = ''[]''');
select pg_temp.expect_route_sources_denied('delete from public.route_sources_cache');
select pg_temp.expect_route_sources_denied('select * from public.route_source_request_slots');
select pg_temp.expect_route_sources_denied('select public.claim_route_source_request(''wikiloc'')');

set local role service_role;
insert into public.route_sources_cache(cache_key,source,payload) values ('synthetic','osm','[]');
select pg_temp.assert_route_sources((select count(*) = 1 from public.route_sources_cache), 'servidor puede leer');
select pg_temp.assert_route_sources((select expires_at - fetched_at = interval '168 hours' from public.route_sources_cache where cache_key = 'synthetic'), 'TTL exacto de siete días');
update public.route_sources_cache set payload = '[{"name":"Referencia sintética"}]' where cache_key = 'synthetic';
select pg_temp.assert_route_sources((select payload->0->>'name' = 'Referencia sintética' from public.route_sources_cache where cache_key = 'synthetic'), 'servidor puede actualizar');
insert into public.route_sources_cache(cache_key,source,payload,fetched_at,expires_at)
  values ('expired','wikiloc','[]',now()-interval '8 days',now()-interval '1 day');
select pg_temp.assert_route_sources((select count(*) = 1 from public.route_sources_cache where expires_at > clock_timestamp()), 'consulta vigente excluye entradas caducadas');
delete from public.route_sources_cache where expires_at <= clock_timestamp();
select pg_temp.assert_route_sources((select count(*) = 1 from public.route_sources_cache), 'servidor puede purgar');

do $$ begin
  begin
    insert into public.route_sources_cache(cache_key,source,payload,fetched_at,expires_at)
      values ('bad-ttl','osm','[]',now(),now()+interval '8 days');
    raise exception 'FAIL: TTL incorrecto aceptado';
  exception when check_violation then null; end;
  begin
    insert into public.route_sources_cache(cache_key,source,payload) values ('bad-json','osm','{}');
    raise exception 'FAIL: payload no array aceptado';
  exception when check_violation then null; end;
  begin
    perform public.claim_route_source_request('unknown');
    raise exception 'FAIL: proveedor desconocido aceptado';
  exception when invalid_parameter_value then null; end;
end $$;

select pg_temp.assert_route_sources(public.claim_route_source_request('wikiloc'), 'primer slot Wikiloc admitido');
select pg_temp.assert_route_sources(not public.claim_route_source_request('wikiloc'), 'segundo slot Wikiloc rechazado');
select pg_temp.assert_route_sources(public.claim_route_source_request('osm'), 'proveedores independientes');
select pg_temp.assert_route_sources(not public.claim_route_source_request('osm'), 'segundo slot OSM rechazado');
update public.route_source_request_slots set last_requested_at = clock_timestamp() - interval '2 seconds' where provider = 'wikiloc';
select pg_temp.assert_route_sources(public.claim_route_source_request('wikiloc'), 'slot transcurrido vuelve a admitirse sin esperar');
delete from public.route_sources_cache;
select pg_temp.assert_route_sources((select count(*) = 0 from public.route_sources_cache), 'servidor puede borrar');
reset role;
select pg_temp.assert_route_sources((select not prosecdef from pg_proc where oid = 'public.claim_route_source_request(text)'::regprocedure), 'RPC sin elevación de privilegios');
select pg_temp.assert_route_sources((select relrowsecurity from pg_class where oid = 'public.route_sources_cache'::regclass), 'RLS caché activado');
select pg_temp.assert_route_sources((select relrowsecurity from pg_class where oid = 'public.route_source_request_slots'::regclass), 'RLS slots activado');

rollback;
