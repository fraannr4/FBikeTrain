-- Suscripciones push: cada cuenta registrada ve y borra solo las suyas, las crea por la función y con límite.
begin;
create function pg_temp.ok(value boolean,message text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
create function pg_temp.fails(statement text,state text) returns void language plpgsql as $$ begin
  begin execute statement; exception when others then if sqlstate = state then return; end if; raise; end;
  raise exception 'FAIL: no se rechazó %',statement;
end $$;
create function pg_temp.who(account_id text) returns void language sql as $$ select set_config('request.jwt.claim.sub',account_id,true) $$;
insert into auth.users(id,email,is_anonymous) values
('00000000-0000-0000-0000-000000000401','push-a@example.invalid',false),
('00000000-0000-0000-0000-000000000402','push-b@example.invalid',false),
('00000000-0000-0000-0000-000000000403','push-anon@example.invalid',true);
set local role authenticated;

select pg_temp.who('00000000-0000-0000-0000-000000000401');
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/aaa',repeat('P',87),repeat('a',22),'Mozilla/5.0 prueba');
select pg_temp.ok((select count(*) = 1 from public.push_subscriptions),'A ve la suya');
select pg_temp.ok((select user_agent = 'Mozilla/5.0 prueba' and last_ok_at is null and user_id = auth.uid() from public.push_subscriptions),'fila propia sin último envío');
-- Registrar de nuevo el mismo endpoint no duplica.
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/aaa',repeat('Q',87),repeat('b',22),'Otro');
select pg_temp.ok((select count(*) = 1 and min(p256dh) = repeat('Q',87) from public.push_subscriptions),'mismo endpoint: se actualiza');
-- El user agent se recorta.
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/largo',repeat('P',87),repeat('a',22),repeat('x',500));
select pg_temp.ok((select max(length(user_agent)) = 120 from public.push_subscriptions),'user agent recortado a 120');
-- Datos no válidos.
select pg_temp.fails($$select public.register_push_subscription('http://fcm.googleapis.com/x',repeat('P',87),repeat('a',22),null)$$,'22023');
select pg_temp.fails($$select public.register_push_subscription('https://fcm.googleapis.com/'||repeat('x',1100),repeat('P',87),repeat('a',22),null)$$,'22023');
select pg_temp.fails($$select public.register_push_subscription('https://fcm.googleapis.com/y','corta',repeat('a',22),null)$$,'22023');
select pg_temp.fails($$select public.register_push_subscription('https://fcm.googleapis.com/y',repeat('P',87),'no válida!',null)$$,'22023');
-- Sin insert ni update directos: solo la función crea.
select pg_temp.fails($$insert into public.push_subscriptions(user_id,endpoint,p256dh,auth) values (auth.uid(),'https://fcm.googleapis.com/z',repeat('P',87),repeat('a',22))$$,'42501');
select pg_temp.fails('update public.push_subscriptions set last_ok_at = now()','42501');
-- Límite de 10 dispositivos: ya tiene 2; completa 8 más y el undécimo falla.
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/d'||n,repeat('P',87),repeat('a',22),null) from generate_series(1,8) n;
select pg_temp.ok((select count(*) = 10 from public.push_subscriptions),'diez dispositivos');
select pg_temp.fails($$select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/once',repeat('P',87),repeat('a',22),null)$$,'53400');
-- Volver a registrar uno existente no cuenta contra el límite.
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/aaa',repeat('P',87),repeat('a',22),null);

-- B no ve las de A y no las borra.
select pg_temp.who('00000000-0000-0000-0000-000000000402');
select pg_temp.ok((select count(*) = 0 from public.push_subscriptions),'B no ve las de A');
delete from public.push_subscriptions;
select pg_temp.who('00000000-0000-0000-0000-000000000401');
select pg_temp.ok((select count(*) = 10 from public.push_subscriptions),'el borrado de B no tocó las de A');
-- Un dispositivo pasa a la cuenta que inicia sesión en él (mismo endpoint).
select pg_temp.who('00000000-0000-0000-0000-000000000402');
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/aaa',repeat('P',87),repeat('a',22),null);
select pg_temp.ok((select count(*) = 1 from public.push_subscriptions),'B recibe el dispositivo');
select pg_temp.who('00000000-0000-0000-0000-000000000401');
select pg_temp.ok((select count(*) = 9 from public.push_subscriptions),'A pierde ese dispositivo');
delete from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/d1';
select pg_temp.ok((select count(*) = 8 from public.push_subscriptions),'A borra uno propio');

-- Cuenta anónima: ni crear ni leer.
select pg_temp.who('00000000-0000-0000-0000-000000000403');
select pg_temp.ok((select count(*) = 0 from public.push_subscriptions),'anónima no lee');
select pg_temp.fails($$select public.register_push_subscription('https://fcm.googleapis.com/anon',repeat('P',87),repeat('a',22),null)$$,'42501');
-- Sin sesión (anon): sin acceso a la tabla ni a la función.
reset role;
set local role anon;
select pg_temp.fails('select * from public.push_subscriptions','42501');
select pg_temp.fails($$select public.register_push_subscription('https://fcm.googleapis.com/x',repeat('P',87),repeat('a',22),null)$$,'42501');
reset role;
-- El servidor (service_role) lee, borra y anota el último envío correcto.
set local role service_role;
select pg_temp.ok((select count(*) = 9 from public.push_subscriptions),'el servidor lee todas');
update public.push_subscriptions set last_ok_at = now() where endpoint = 'https://fcm.googleapis.com/fcm/send/aaa';
select pg_temp.fails($$update public.push_subscriptions set endpoint = 'https://fcm.googleapis.com/otro'$$,'42501');
reset role;
-- El borrado de la cuenta se lleva sus suscripciones.
delete from public.profiles where id = '00000000-0000-0000-0000-000000000402';
select pg_temp.ok((select count(*) = 0 from public.push_subscriptions where user_id = '00000000-0000-0000-0000-000000000402'),'cascada al borrar la cuenta');
select pg_temp.ok(has_function_privilege('authenticated','public.register_push_subscription(text,text,text,text)','EXECUTE') and not has_function_privilege('anon','public.register_push_subscription(text,text,text,text)','EXECUTE'),'función solo para autenticados');
rollback;
