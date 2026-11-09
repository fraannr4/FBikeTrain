begin;
create function pg_temp.assert_quota(ok boolean, message text) returns void
language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %', message; end if; end $$;
create function pg_temp.expect_quota_denied(statement text) returns void
language plpgsql as $$ begin
  begin execute statement;
  exception when insufficient_privilege then return; end;
  raise exception 'FAIL: operación no denegada: %', statement;
end $$;

set local role authenticated;
select pg_temp.expect_quota_denied('select * from public.shared_ai_usage');
select pg_temp.expect_quota_denied('select * from public.consume_shared_ai_quota(''00000000-0000-0000-0000-000000000001'')');
set local role anon;
select pg_temp.expect_quota_denied('select * from public.consume_shared_ai_quota(''00000000-0000-0000-0000-000000000001'')');

set local role service_role;
select pg_temp.assert_quota((select allowed from public.consume_shared_ai_quota('00000000-0000-0000-0000-000000000001')), 'primera operación');
select pg_temp.assert_quota((select allowed from public.consume_shared_ai_quota('00000000-0000-0000-0000-000000000001')), 'segunda operación');
select pg_temp.assert_quota((select not allowed and retry_after_s > 0 from public.consume_shared_ai_quota('00000000-0000-0000-0000-000000000001')), 'tercera operación supera límite por usuario');
select pg_temp.assert_quota((select allowed from public.consume_shared_ai_quota('00000000-0000-0000-0000-000000000002')), 'otra cuenta consume el tercer cupo global');
select pg_temp.assert_quota((select not allowed from public.consume_shared_ai_quota('00000000-0000-0000-0000-000000000003')), 'límite global compartido');
reset role;
select pg_temp.assert_quota((select calls = 3 from public.shared_ai_usage where bucket = 'global:day'), 'rechazadas no consumen cuota');

delete from public.shared_ai_usage;
insert into public.shared_ai_usage(bucket, window_start, calls) values
  ('user:00000000-0000-0000-0000-000000000001:day', date_trunc('day', now() at time zone 'UTC') at time zone 'UTC', 12);
set local role service_role;
select pg_temp.assert_quota((select not allowed from public.consume_shared_ai_quota('00000000-0000-0000-0000-000000000001')), 'límite diario por usuario');
reset role;
select pg_temp.assert_quota((select count(*) = 1 from public.shared_ai_usage), 'rechazo diario no crea otros contadores');
delete from public.shared_ai_usage;
insert into public.shared_ai_usage(bucket, window_start, calls) values
  ('global:day', date_trunc('day', now() at time zone 'UTC') at time zone 'UTC', 40);
set local role service_role;
select pg_temp.assert_quota((select not allowed from public.consume_shared_ai_quota('00000000-0000-0000-0000-000000000002')), 'límite global diario');
rollback;
