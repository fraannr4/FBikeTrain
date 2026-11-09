-- Ejecutar con psql -v ON_ERROR_STOP=1, después de las migraciones, en Supabase de pruebas.
-- Ningún dato se conserva: toda la prueba termina con rollback.
begin;
create function pg_temp.check_true(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %', message; end if;
end $$;
create function pg_temp.expect_error(statement text, expected_state text) returns void
language plpgsql as $$ begin
  begin execute statement;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise;
  end;
  raise exception 'FAIL: no se rechazó %', statement;
end $$;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-000000000001', 'one@example.invalid'),
  ('00000000-0000-0000-0000-000000000002', 'two@example.invalid'),
  ('00000000-0000-0000-0000-000000000003', 'three@example.invalid');
select pg_temp.check_true((select count(*) = 3 from public.profiles where id::text like '00000000-%'), 'creación automática de perfiles');
select pg_temp.check_true((select bool_and(stats_visibility = 'everyone') from public.profiles where id::text like '00000000-%'), 'visibilidad inicial');
select pg_temp.check_true((select not public from storage.buckets where id = 'fbiketrain-tracks'), 'bucket privado');
insert into storage.objects(bucket_id, name) values
  ('fbiketrain-tracks', '00000000-0000-0000-0000-000000000001/synthetic.json.gz'),
  ('fbiketrain-tracks', '00000000-0000-0000-0000-000000000002/synthetic.json.gz');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select pg_temp.check_true((select count(*) = 3 from public.profiles where id::text like '00000000-%'), 'búsqueda autenticada');
update public.profiles set display_name = 'Ciclista de prueba', stats_visibility = 'friends' where id = auth.uid();
update public.profiles set display_name = 'Intrusión' where id = '00000000-0000-0000-0000-000000000002';
select pg_temp.check_true((select display_name = 'Ciclista' from public.profiles where id = '00000000-0000-0000-0000-000000000002'), 'no editar otro perfil');
select pg_temp.expect_error('update public.profiles set id = gen_random_uuid()', '42501');
select pg_temp.expect_error('update public.profiles set username = ''Nombre Inválido'' where id = auth.uid()', '23514');
select pg_temp.expect_error('select public.request_friendship(auth.uid())', '22023');
select public.request_friendship('00000000-0000-0000-0000-000000000002');
select public.request_friendship('00000000-0000-0000-0000-000000000002');
select pg_temp.check_true((select count(*) = 1 from public.friendships), 'solicitud idempotente');
select set_config('test.request_id', (select id::text from public.friendships), true);
select pg_temp.expect_error('select public.accept_friendship(current_setting(''test.request_id'')::uuid)', '42501');
select pg_temp.expect_error('update public.friendships set status = ''accepted''', '42501');
select pg_temp.check_true((select count(*) = 1 from storage.objects where bucket_id = 'fbiketrain-tracks'), 'solo listar tracks propios');
select pg_temp.expect_error('insert into storage.objects(bucket_id,name) values (''fbiketrain-tracks'',''00000000-0000-0000-0000-000000000002/forbidden.gz'')', '42501');
select pg_temp.expect_error('update storage.objects set name = ''00000000-0000-0000-0000-000000000002/moved.gz'' where bucket_id = ''fbiketrain-tracks''', '42501');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select pg_temp.check_true((select count(*) = 0 from public.friendships), 'tercero no ve solicitudes');
select pg_temp.expect_error('select public.accept_friendship(current_setting(''test.request_id'')::uuid)', '42501');
select pg_temp.expect_error('select public.remove_friendship(current_setting(''test.request_id'')::uuid)', '42501');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select public.request_friendship('00000000-0000-0000-0000-000000000001');
select pg_temp.check_true((select count(*) = 1 from public.friendships), 'sin duplicado inverso');
select public.accept_friendship(current_setting('test.request_id')::uuid);
select pg_temp.check_true((select status = 'accepted' from public.friendships), 'destinatario acepta');
select public.remove_friendship(current_setting('test.request_id')::uuid);
select pg_temp.check_true((select count(*) = 0 from public.friendships), 'retirar amistad');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.expect_error('select * from public.profiles', '42501');
select pg_temp.expect_error('select public.request_friendship(''00000000-0000-0000-0000-000000000001'')', '42501');
select pg_temp.check_true((select count(*) = 0 from storage.objects where bucket_id = 'fbiketrain-tracks'), 'anónimo sin tracks');
rollback;
