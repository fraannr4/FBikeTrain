begin;
create function pg_temp.assert_garmin(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %', message; end if;
end $$;
create function pg_temp.expect_garmin_denied(statement text) returns void
language plpgsql as $$ begin
  begin execute statement;
  exception when insufficient_privilege then return; end;
  raise exception 'FAIL: operación no denegada: %', statement;
end $$;

insert into auth.users(id,email,is_anonymous) values
  ('30000000-0000-0000-0000-000000000001','garmin-a@example.invalid',false),
  ('30000000-0000-0000-0000-000000000002','garmin-b@example.invalid',false);
insert into storage.objects(bucket_id,name) values
  ('garmin-originals','30000000-0000-0000-0000-000000000001/synthetic.fit'),
  ('garmin-originals','30000000-0000-0000-0000-000000000002/synthetic.fit');
insert into public.garmin_oauth_states values ('synthetic-state','30000000-0000-0000-0000-000000000001','v1.synthetic-cipher',now()+interval '10 minutes');
insert into public.garmin_pending_connections(code_hash,user_id,garmin_user_id,ciphertext,token_expires_at,refresh_expires_at,permissions,expires_at)
  values ('synthetic-completion','30000000-0000-0000-0000-000000000002','synthetic-garmin-b','v1.synthetic.cipher',now()+interval '1 day',now()+interval '90 days','{ACTIVITY_EXPORT}',now()+interval '5 minutes');
insert into public.garmin_connections(user_id,garmin_user_id,ciphertext,expires_at,refresh_expires_at,permissions)
  values ('30000000-0000-0000-0000-000000000001','synthetic-garmin-a','v1.synthetic.cipher',now()+interval '1 day',now()+interval '90 days','{ACTIVITY_EXPORT}');

select pg_temp.assert_garmin((select not public and file_size_limit = 20971520 from storage.buckets where id = 'garmin-originals'), 'bucket privado de 20 MB');

-- Navegador (anon y cuentas con sesión): ni tokens, ni estado PKCE, ni colas, ni RPC, ni originales.
set local role anon;
select pg_temp.expect_garmin_denied('select * from public.garmin_connections');
select pg_temp.expect_garmin_denied('select * from public.garmin_oauth_states');
select pg_temp.expect_garmin_denied('select * from public.garmin_account_locks');
select pg_temp.expect_garmin_denied('select * from public.garmin_activity_files');
select pg_temp.expect_garmin_denied('select * from public.garmin_notification_queue');
select pg_temp.expect_garmin_denied('select * from public.garmin_consume_state(''synthetic-state'')');
select pg_temp.expect_garmin_denied('select * from public.garmin_pending_connections');
select pg_temp.expect_garmin_denied('select * from public.garmin_consume_completion(''synthetic-completion'')');
select pg_temp.assert_garmin((select count(*) = 0 from storage.objects where bucket_id = 'garmin-originals'), 'anon no ve originales');
set local role authenticated;
set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000001';
select pg_temp.expect_garmin_denied('select * from public.garmin_connections');
select pg_temp.expect_garmin_denied('update public.garmin_connections set ciphertext = ''forged''');
select pg_temp.expect_garmin_denied('insert into public.garmin_connections(user_id,garmin_user_id,ciphertext,expires_at,refresh_expires_at) values (''30000000-0000-0000-0000-000000000002'',''x'',''x'',now(),now())');
select pg_temp.expect_garmin_denied('delete from public.garmin_connections');
select pg_temp.expect_garmin_denied('select * from public.garmin_oauth_states');
select pg_temp.expect_garmin_denied('select * from public.garmin_activity_files');
select pg_temp.expect_garmin_denied('select * from public.garmin_notification_queue');
select pg_temp.expect_garmin_denied('select * from public.garmin_consume_state(''synthetic-state'')');
select pg_temp.expect_garmin_denied('select * from public.garmin_pending_connections');
select pg_temp.expect_garmin_denied('select * from public.garmin_consume_completion(''synthetic-completion'')');
select pg_temp.expect_garmin_denied('select public.garmin_acquire_lock(''30000000-0000-0000-0000-000000000001'',''30000000-0000-0000-0000-0000000000a1'')');
select pg_temp.expect_garmin_denied('select public.garmin_claim_event(''30000000-0000-0000-0000-000000000001'',''synthetic-event'',''activity'')');
-- Ni siquiera el dueño ve sus propios originales: solo los sirve la Edge Function.
select pg_temp.assert_garmin((select count(*) = 0 from storage.objects where bucket_id = 'garmin-originals'), 'la cuenta no lee el bucket directamente');

-- Servidor: estado de un solo uso, candado por cuenta y cola idempotente.
set local role service_role;
select pg_temp.assert_garmin((select count(*) = 1 from public.garmin_consume_state('synthetic-state')), 'el estado se consume');
select pg_temp.assert_garmin((select count(*) = 0 from public.garmin_consume_state('synthetic-state')), 'el estado no se reutiliza');
select pg_temp.assert_garmin((select count(*) = 1 from public.garmin_consume_completion('synthetic-completion') c
  where c.user_id = '30000000-0000-0000-0000-000000000002' and c.garmin_user_id = 'synthetic-garmin-b' and c.permissions = '{ACTIVITY_EXPORT}'), 'la vinculación pendiente se consume con su cuenta');
select pg_temp.assert_garmin((select count(*) = 0 from public.garmin_consume_completion('synthetic-completion')), 'el código de vinculación no se reutiliza');
select pg_temp.assert_garmin(public.garmin_acquire_lock('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-0000000000a1'), 'primer candado');
select pg_temp.assert_garmin(not public.garmin_acquire_lock('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-0000000000a2'), 'candado ocupado');
select pg_temp.assert_garmin(public.garmin_acquire_lock('30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-0000000000a2'), 'otra cuenta independiente');
select pg_temp.assert_garmin(public.garmin_claim_event('30000000-0000-0000-0000-000000000001','activityFile:synthetic','activity'), 'primera entrega');
select pg_temp.assert_garmin(public.garmin_claim_event('30000000-0000-0000-0000-000000000001','activityFile:synthetic','activity'), 'reanuda una entrega a medias');
reset role;
update public.garmin_notification_queue set status = 'done' where id = 'activityFile:synthetic';
set local role service_role;
select pg_temp.assert_garmin(not public.garmin_claim_event('30000000-0000-0000-0000-000000000001','activityFile:synthetic','activity'), 'una entrega terminada no se repite');
reset role;

-- Borrar la cuenta borra su conexión Garmin y su vinculación pendiente.
insert into public.garmin_pending_connections(code_hash,user_id,garmin_user_id,ciphertext,token_expires_at,refresh_expires_at,expires_at)
  values ('synthetic-completion-a','30000000-0000-0000-0000-000000000001','synthetic-garmin-a','v1.synthetic.cipher',now(),now(),now()+interval '5 minutes');
delete from auth.users where id = '30000000-0000-0000-0000-000000000001';
select pg_temp.assert_garmin((select count(*) = 0 from public.garmin_connections), 'cascada al borrar la cuenta');
select pg_temp.assert_garmin((select count(*) = 0 from public.garmin_pending_connections), 'cascada de la vinculación pendiente');
rollback;
