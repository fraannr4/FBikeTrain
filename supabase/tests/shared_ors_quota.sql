begin;
create function pg_temp.assert_ors(ok boolean, message text) returns void
language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %', message; end if; end $$;
create function pg_temp.expect_ors_denied(statement text) returns void
language plpgsql as $$ begin
  begin execute statement;
  exception when insufficient_privilege then return; end;
  raise exception 'FAIL: operación no denegada: %', statement;
end $$;
create function pg_temp.today() returns timestamptz language sql as
  $$ select date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' $$;

set local role authenticated;
select pg_temp.expect_ors_denied('select * from public.consume_shared_ors_quota(''00000000-0000-0000-0000-000000000001'', 1)');
set local role anon;
select pg_temp.expect_ors_denied('select * from public.consume_shared_ors_quota(''00000000-0000-0000-0000-000000000001'', 1)');
reset role;

-- Límite por minuto y usuario: 8.
set local role service_role;
select pg_temp.assert_ors((select allowed from public.consume_shared_ors_quota('00000000-0000-0000-0000-000000000001', 7)), 'siete consultas de golpe');
select pg_temp.assert_ors((select allowed from public.consume_shared_ors_quota('00000000-0000-0000-0000-000000000001', 1)), 'la octava cabe');
select pg_temp.assert_ors((select not allowed and retry_after_s between 1 and 60 from public.consume_shared_ors_quota('00000000-0000-0000-0000-000000000001', 1)), 'la novena supera el minuto por usuario');
reset role;
select pg_temp.assert_ors((select calls = 8 from public.shared_ai_usage where bucket = 'ors:global:day'), 'el coste se suma y el rechazo no consume');
select pg_temp.assert_ors(not exists (select 1 from public.shared_ai_usage where bucket like 'user:%' or bucket like 'global:%'), 'no toca los contadores de la IA');

-- Coste no válido.
set local role service_role;
do $$ begin
  perform * from public.consume_shared_ors_quota('00000000-0000-0000-0000-000000000002', 0);
  raise exception 'FAIL: coste 0 aceptado';
exception when invalid_parameter_value then null; end $$;
do $$ begin
  perform * from public.consume_shared_ors_quota(null, 1);
  raise exception 'FAIL: cuenta nula aceptada';
exception when invalid_parameter_value then null; end $$;
reset role;

-- Límite diario por usuario: 150.
delete from public.shared_ai_usage;
insert into public.shared_ai_usage(bucket, window_start, calls) values ('ors:user:00000000-0000-0000-0000-000000000001:day', pg_temp.today(), 150);
set local role service_role;
select pg_temp.assert_ors((select not allowed and retry_after_s > 60 from public.consume_shared_ors_quota('00000000-0000-0000-0000-000000000001', 1)), 'límite diario por usuario');
select pg_temp.assert_ors((select allowed from public.consume_shared_ors_quota('00000000-0000-0000-0000-000000000002', 1)), 'otra cuenta sigue pudiendo');
reset role;

-- Límite global por minuto: 35.
delete from public.shared_ai_usage;
insert into public.shared_ai_usage(bucket, window_start, calls) values ('ors:global:minute', date_trunc('minute', now()), 35);
set local role service_role;
select pg_temp.assert_ors((select not allowed from public.consume_shared_ors_quota('00000000-0000-0000-0000-000000000003', 1)), 'límite global por minuto');
reset role;

-- Límite global diario: 1.800.
delete from public.shared_ai_usage;
insert into public.shared_ai_usage(bucket, window_start, calls) values ('ors:global:day', pg_temp.today(), 1799);
set local role service_role;
select pg_temp.assert_ors((select not allowed from public.consume_shared_ors_quota('00000000-0000-0000-0000-000000000004', 2)), 'el coste no puede pasar del límite global diario');
select pg_temp.assert_ors((select allowed from public.consume_shared_ors_quota('00000000-0000-0000-0000-000000000004', 1)), 'la última del día cabe');
select pg_temp.assert_ors((select not allowed from public.consume_shared_ors_quota('00000000-0000-0000-0000-000000000005', 1)), 'límite global diario');
rollback;
