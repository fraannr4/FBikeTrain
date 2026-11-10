begin;
create function pg_temp.assert_raise(ok boolean, message text) returns void
language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %', message; end if; end $$;
create function pg_temp.expect_raise_denied(statement text) returns void
language plpgsql as $$ begin
  begin execute statement;
  exception when insufficient_privilege then return; end;
  raise exception 'FAIL: operación no denegada: %', statement;
end $$;

-- Los permisos no cambian: solo el servidor consume.
set local role authenticated;
select pg_temp.expect_raise_denied('select * from public.consume_shared_ai_quota(''00000000-0000-0000-0000-000000000001'')');
set local role anon;
select pg_temp.expect_raise_denied('select * from public.consume_shared_ai_quota(''00000000-0000-0000-0000-000000000001'')');
reset role;

-- Por usuario, 30 al día: con 12 hechas (el límite anterior) sigue permitido; la 31.ª se deniega.
delete from public.shared_ai_usage;
insert into public.shared_ai_usage(bucket, window_start, calls) values
  ('user:00000000-0000-0000-0000-000000000001:day', date_trunc('day', now() at time zone 'UTC') at time zone 'UTC', 12);
set local role service_role;
select pg_temp.assert_raise((select allowed from public.consume_shared_ai_quota('00000000-0000-0000-0000-000000000001')), 'con 12 operaciones hoy, la 13.ª sigue permitida');
reset role;
select pg_temp.assert_raise((select calls = 13 from public.shared_ai_usage where bucket = 'user:00000000-0000-0000-0000-000000000001:day'), 'la 13.ª se contabiliza en el mismo contador');

delete from public.shared_ai_usage;
insert into public.shared_ai_usage(bucket, window_start, calls) values
  ('user:00000000-0000-0000-0000-000000000001:day', date_trunc('day', now() at time zone 'UTC') at time zone 'UTC', 29);
set local role service_role;
select pg_temp.assert_raise((select allowed from public.consume_shared_ai_quota('00000000-0000-0000-0000-000000000001')), 'la 30.ª del día por usuario se admite');
select pg_temp.assert_raise((select not allowed and retry_after_s > 0 from public.consume_shared_ai_quota('00000000-0000-0000-0000-000000000001')), 'la 31.ª del día por usuario se deniega');
reset role;
select pg_temp.assert_raise((select calls = 30 from public.shared_ai_usage where bucket = 'user:00000000-0000-0000-0000-000000000001:day'), 'la denegada por usuario no consume');

-- Global, 300 al día.
delete from public.shared_ai_usage;
insert into public.shared_ai_usage(bucket, window_start, calls) values
  ('global:day', date_trunc('day', now() at time zone 'UTC') at time zone 'UTC', 299);
set local role service_role;
select pg_temp.assert_raise((select allowed from public.consume_shared_ai_quota('00000000-0000-0000-0000-000000000002')), 'la 300.ª global del día se admite');
select pg_temp.assert_raise((select not allowed and retry_after_s > 0 from public.consume_shared_ai_quota('00000000-0000-0000-0000-000000000003')), 'la 301.ª global del día se deniega');
reset role;
select pg_temp.assert_raise((select calls = 300 from public.shared_ai_usage where bucket = 'global:day'), 'la denegada global no consume');

-- Global, 10 por minuto.
delete from public.shared_ai_usage;
insert into public.shared_ai_usage(bucket, window_start, calls) values ('global:minute', date_trunc('minute', now()), 9);
set local role service_role;
select pg_temp.assert_raise((select allowed from public.consume_shared_ai_quota('00000000-0000-0000-0000-000000000004')), 'la 10.ª global del minuto se admite');
select pg_temp.assert_raise((select not allowed and retry_after_s between 1 and 60 from public.consume_shared_ai_quota('00000000-0000-0000-0000-000000000005')), 'la 11.ª global del minuto se deniega');
reset role;

-- Por usuario siguen 2 por minuto.
delete from public.shared_ai_usage;
set local role service_role;
select pg_temp.assert_raise((select allowed from public.consume_shared_ai_quota('00000000-0000-0000-0000-000000000006')), 'primera del minuto por usuario');
select pg_temp.assert_raise((select allowed from public.consume_shared_ai_quota('00000000-0000-0000-0000-000000000006')), 'segunda del minuto por usuario');
select pg_temp.assert_raise((select not allowed from public.consume_shared_ai_quota('00000000-0000-0000-0000-000000000006')), 'la tercera del minuto por usuario sigue denegada');
rollback;
