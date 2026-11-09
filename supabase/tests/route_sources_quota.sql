begin;
create function pg_temp.assert_sources_quota(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %', message; end if;
end $$;
create function pg_temp.expect_sources_quota_denied(statement text) returns void
language plpgsql as $$ begin
  begin execute statement;
  exception when insufficient_privilege then return; end;
  raise exception 'FAIL: operación no denegada: %', statement;
end $$;
create function pg_temp.expect_sources_invalid(statement text) returns void
language plpgsql as $$ begin
  begin execute statement;
  exception when invalid_parameter_value then return; end;
  raise exception 'FAIL: operación inválida admitida: %', statement;
end $$;

insert into auth.users(id,email,is_anonymous) values
  ('10000000-0000-0000-0000-000000000001','quota-a@example.invalid',false),
  ('10000000-0000-0000-0000-000000000002','quota-b@example.invalid',false),
  ('10000000-0000-0000-0000-000000000003',null,true);

set local role anon;
select pg_temp.expect_sources_quota_denied('select * from public.route_sources_usage');
select pg_temp.expect_sources_quota_denied('insert into public.route_sources_usage values (''10000000-0000-0000-0000-000000000001'',''day'',now(),1)');
select pg_temp.expect_sources_quota_denied('update public.route_sources_usage set calls=0');
select pg_temp.expect_sources_quota_denied('delete from public.route_sources_usage');
select pg_temp.expect_sources_quota_denied('select public.consume_route_sources_quota(''10000000-0000-0000-0000-000000000001'')');
select pg_temp.expect_sources_quota_denied('select public.write_route_sources_cache(''forbidden'',''osm'',''[]'',now())');
set local role authenticated;
select pg_temp.expect_sources_quota_denied('select * from public.route_sources_usage');
select pg_temp.expect_sources_quota_denied('insert into public.route_sources_usage values (''10000000-0000-0000-0000-000000000001'',''day'',now(),1)');
select pg_temp.expect_sources_quota_denied('update public.route_sources_usage set calls=0');
select pg_temp.expect_sources_quota_denied('delete from public.route_sources_usage');
select pg_temp.expect_sources_quota_denied('select public.consume_route_sources_quota(''10000000-0000-0000-0000-000000000001'')');
select pg_temp.expect_sources_quota_denied('select public.write_route_sources_cache(''forbidden'',''osm'',''[]'',now())');

set local role service_role;
select pg_temp.expect_sources_invalid('select public.consume_route_sources_quota(null)');
select pg_temp.expect_sources_invalid('select public.consume_route_sources_quota(''10000000-0000-0000-0000-000000000003'')');
select pg_temp.expect_sources_invalid('select public.consume_route_sources_quota(''10000000-0000-0000-0000-000000000099'')');
select pg_temp.assert_sources_quota((select count(*) = 0 from public.route_sources_usage), 'cuentas inválidas no consumen');
select pg_temp.assert_sources_quota((select allowed and retry_after_s = 0 from public.consume_route_sources_quota('10000000-0000-0000-0000-000000000001')), 'primera consulta');
select pg_temp.assert_sources_quota((select allowed from public.consume_route_sources_quota('10000000-0000-0000-0000-000000000001')), 'segunda consulta');
select pg_temp.assert_sources_quota((select allowed from public.consume_route_sources_quota('10000000-0000-0000-0000-000000000001')), 'tercera consulta');
select pg_temp.assert_sources_quota((select not allowed and retry_after_s between 1 and 60 from public.consume_route_sources_quota('10000000-0000-0000-0000-000000000001')), 'cuarta supera minuto');
select pg_temp.assert_sources_quota((select sum(calls) = 6 from public.route_sources_usage where account_id = '10000000-0000-0000-0000-000000000001'), 'rechazo no consume');
select pg_temp.assert_sources_quota((select allowed from public.consume_route_sources_quota('10000000-0000-0000-0000-000000000002')), 'otra cuenta independiente');

-- Ventana minuto vencida y día actual todavía con cuota.
update public.route_sources_usage set window_start = window_start - interval '2 minutes'
  where account_id = '10000000-0000-0000-0000-000000000001' and bucket = 'minute';
select pg_temp.assert_sources_quota((select allowed from public.consume_route_sources_quota('10000000-0000-0000-0000-000000000001')), 'minuto nuevo admite');
update public.route_sources_usage set calls = 30
  where account_id = '10000000-0000-0000-0000-000000000001' and bucket = 'day';
select pg_temp.assert_sources_quota((select not allowed and retry_after_s between 1 and 86400 from public.consume_route_sources_quota('10000000-0000-0000-0000-000000000001')), 'límite diario');
select pg_temp.assert_sources_quota((select calls = 30 from public.route_sources_usage where account_id = '10000000-0000-0000-0000-000000000001' and bucket='day'), 'rechazo diario no consume');
delete from public.route_sources_usage where account_id = '10000000-0000-0000-0000-000000000001' and bucket = 'minute';
update public.route_sources_usage set calls = 29
  where account_id = '10000000-0000-0000-0000-000000000001' and bucket = 'day';
select pg_temp.assert_sources_quota((select allowed from public.consume_route_sources_quota('10000000-0000-0000-0000-000000000001')), 'consulta treinta todavía admitida');
select pg_temp.assert_sources_quota((select not allowed from public.consume_route_sources_quota('10000000-0000-0000-0000-000000000001')), 'consulta treinta y una rechazada');
delete from public.route_sources_usage where account_id = '10000000-0000-0000-0000-000000000001' and bucket = 'minute';
update public.route_sources_usage set window_start = window_start - interval '72 hours'
  where account_id = '10000000-0000-0000-0000-000000000001';
select pg_temp.assert_sources_quota((select allowed from public.consume_route_sources_quota('10000000-0000-0000-0000-000000000001')), 'día vencido no bloquea');
select pg_temp.assert_sources_quota((select count(*) = 2 from public.route_sources_usage where account_id = '10000000-0000-0000-0000-000000000001'), 'purga contadores antiguos propios');

insert into public.route_sources_cache(cache_key,source,payload,fetched_at,expires_at)
  select 'expired-'||n,'osm','[]',now()-interval '8 days',now()-interval '24 hours' from generate_series(1,101) n;
insert into public.route_sources_cache(cache_key,source,payload) values ('still-valid','osm','[]');
select public.write_route_sources_cache('new-row','osm','[{"name":"Referencia sintética"}]',now());
select pg_temp.assert_sources_quota((select count(*) = 1 from public.route_sources_cache where expires_at <= clock_timestamp()), 'purga acotada de cien expirados');
select pg_temp.assert_sources_quota((select count(*) = 1 from public.route_sources_cache where cache_key = 'still-valid'), 'no borra caché vigente');
select pg_temp.assert_sources_quota((select payload->0->>'name' = 'Referencia sintética' and expires_at-fetched_at = interval '168 hours' from public.route_sources_cache where cache_key='new-row'), 'escritura payload y TTL');
select public.write_route_sources_cache('new-row','wikiloc','[]',now());
select pg_temp.assert_sources_quota((select count(*) = 0 from public.route_sources_cache where expires_at <= clock_timestamp()), 'segunda escritura purga restante');
select pg_temp.assert_sources_quota((select source = 'wikiloc' and payload = '[]'::jsonb from public.route_sources_cache where cache_key='new-row'), 'upsert actualiza fila');
select pg_temp.expect_sources_invalid('select public.write_route_sources_cache(''bad'',''osm'',''{}'',now())');
do $$
declare oversized jsonb;
begin
  select jsonb_build_array(jsonb_build_object('geometry',jsonb_build_object('type','MultiLineString','coordinates',jsonb_build_array(jsonb_agg(jsonb_build_array(0,0))))))
    into oversized from generate_series(1,2001);
  begin
    perform public.write_route_sources_cache('oversized','osm',oversized,now());
    raise exception 'FAIL: geometría >2000 puntos admitida';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
select pg_temp.assert_sources_quota((select not prosecdef from pg_proc where oid = 'public.write_route_sources_cache(text,text,jsonb,timestamptz)'::regprocedure), 'escritura sin elevación');
select pg_temp.assert_sources_quota((select relrowsecurity from pg_class where oid = 'public.route_sources_usage'::regclass), 'RLS cuota');
rollback;
