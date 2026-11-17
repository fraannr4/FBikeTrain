-- Sincronización entre dispositivos: cada cuenta solo ve lo suyo, gana el cambio más reciente.
begin;
create function pg_temp.ok(value boolean,message text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
create function pg_temp.fails(statement text,state text) returns void language plpgsql as $$ begin
  begin execute statement; exception when others then if sqlstate = state then return; end if; raise; end;
  raise exception 'FAIL: no se rechazó %',statement;
end $$;
create function pg_temp.who(account_id text) returns void language sql as $$ select set_config('request.jwt.claim.sub',account_id,true) $$;
insert into auth.users(id,email,is_anonymous) values
('00000000-0000-0000-0000-000000000401','sync-a@example.invalid',false),
('00000000-0000-0000-0000-000000000402','sync-b@example.invalid',false),
('00000000-0000-0000-0000-000000000403','sync-anon@example.invalid',true);
set local role authenticated;

-- Clave: la primera candidata queda; la segunda devuelve la guardada.
select pg_temp.who('00000000-0000-0000-0000-000000000401');
select pg_temp.ok(public.sync_key('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=') = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=','guarda la primera clave');
select pg_temp.ok(public.sync_key('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=') = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=','una segunda candidata no la sustituye');
select pg_temp.fails($$select public.sync_key('corta')$$,'22023');

-- Subida: fila nueva aceptada; un cambio anterior o igual se rechaza; uno posterior sustituye.
select pg_temp.ok((select accepted and changed_ms = 1000 from public.sync_push('[{"kind":"workout","item_id":"w1","changed_ms":1000,"payload":"uno"}]')),'alta aceptada');
select pg_temp.ok((select not accepted and changed_ms = 1000 from public.sync_push('[{"kind":"workout","item_id":"w1","changed_ms":900,"payload":"viejo"}]')),'cambio anterior rechazado');
select pg_temp.ok((select not accepted from public.sync_push('[{"kind":"workout","item_id":"w1","changed_ms":1000,"payload":"igual"}]')),'cambio simultáneo rechazado');
select pg_temp.ok((select accepted from public.sync_push('[{"kind":"workout","item_id":"w1","changed_ms":2000,"payload":"dos"}]')),'cambio posterior aceptado');
-- El reloj del dispositivo nunca adelanta al del servidor.
select pg_temp.ok((select accepted and changed_ms <= (extract(epoch from clock_timestamp())*1000)::bigint + 1 from public.sync_push('[{"kind":"goal","item_id":"g1","changed_ms":99999999999999,"payload":"futuro"}]')),'fecha futura recortada');
-- Borrado: se guarda sin contenido y se lista como borrado.
select pg_temp.ok((select accepted from public.sync_push('[{"kind":"workout","item_id":"w1","changed_ms":3000,"payload":null}]')),'borrado aceptado');
select pg_temp.ok((select count(*) = 2 and bool_or(deleted and item_id = 'w1') from public.sync_list(0,100)),'lista dos datos, uno borrado');
select pg_temp.ok((select seq from public.sync_list(0,100) where item_id = 'w1') > (select seq from public.sync_list(0,100) where item_id = 'g1'),'cada cambio adelanta la secuencia');
select pg_temp.ok((select count(*) = 0 from public.sync_list((select max(seq) from public.sync_list(0,100)),100)),'nada después del cursor');
select pg_temp.ok((select payload = 'futuro' from public.sync_fetch('[{"kind":"goal","item_id":"g1"}]')),'descarga el contenido');
select pg_temp.ok((select payload is null from public.sync_fetch('[{"kind":"workout","item_id":"w1"}]')),'un borrado no tiene contenido');

-- Entradas no válidas.
select pg_temp.fails($$select * from public.sync_push('[]')$$,'22023');
select pg_temp.fails($$select * from public.sync_push('[{"kind":"otro","item_id":"x","changed_ms":1,"payload":"p"}]')$$,'22023');
select pg_temp.fails($$select * from public.sync_push('[{"kind":"goal","item_id":"","changed_ms":1,"payload":"p"}]')$$,'22023');
select pg_temp.fails($$select * from public.sync_push('[{"kind":"goal","item_id":"x","changed_ms":"1","payload":"p"}]')$$,'22023');
select pg_temp.fails($$select * from public.sync_push(jsonb_build_array(jsonb_build_object('kind','route','item_id','a','changed_ms',1,'payload',repeat('x',3000000)),jsonb_build_object('kind','route','item_id','b','changed_ms',1,'payload',repeat('x',3000000)),jsonb_build_object('kind','route','item_id','c','changed_ms',1,'payload',repeat('x',3000000))))$$,'22023');
select pg_temp.fails($$select * from public.sync_list(-1,10)$$,'22023');
select pg_temp.fails($$select * from public.sync_list(0,5000)$$,'22023');
select pg_temp.fails($$select * from public.sync_fetch('[]')$$,'22023');

-- B no ve nada de A y tiene su propia clave; el mismo identificador no choca.
select pg_temp.who('00000000-0000-0000-0000-000000000402');
select pg_temp.ok(public.sync_key('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=') = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=','clave propia de B');
select pg_temp.ok((select count(*) = 0 from public.sync_list(0,100)),'B no lista datos de A');
select pg_temp.ok((select count(*) = 0 from public.sync_fetch('[{"kind":"goal","item_id":"g1"}]')),'B no descarga datos de A');
select pg_temp.ok((select accepted from public.sync_push('[{"kind":"goal","item_id":"g1","changed_ms":5,"payload":"de B"}]')),'mismo identificador en otra cuenta');
select pg_temp.who('00000000-0000-0000-0000-000000000401');
select pg_temp.ok((select payload = 'futuro' from public.sync_fetch('[{"kind":"goal","item_id":"g1"}]')),'el dato de A sigue intacto');

-- Cuota por cuenta: el lote que la supera se rechaza entero.
reset role;
update public.sync_usage set bytes = 149999999 where user_id = '00000000-0000-0000-0000-000000000401';
set local role authenticated;
select pg_temp.fails($$select * from public.sync_push('[{"kind":"route","item_id":"r1","changed_ms":1,"payload":"demasiado"}]')$$,'53400');
select pg_temp.ok((select count(*) = 0 from public.sync_fetch('[{"kind":"route","item_id":"r1"}]')),'el lote rechazado no deja filas');
-- Borrar sigue permitido con la cuota llena.
select pg_temp.ok((select accepted from public.sync_push('[{"kind":"goal","item_id":"g1","changed_ms":99999999999999,"payload":null}]')),'borrar con la cuota llena');

-- Cuentas anónimas y visitantes, fuera. Tablas sin acceso directo.
select pg_temp.who('00000000-0000-0000-0000-000000000403');
select pg_temp.fails($$select public.sync_key('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')$$,'42501');
select pg_temp.fails($$select * from public.sync_list(0,10)$$,'42501');
select pg_temp.who('');
select pg_temp.fails($$select * from public.sync_push('[{"kind":"goal","item_id":"x","changed_ms":1,"payload":"p"}]')$$,'42501');
select pg_temp.fails('select * from public.sync_items','42501');
select pg_temp.fails('select * from public.sync_keys','42501');
select pg_temp.ok(not has_function_privilege('anon','public.sync_push(jsonb)','EXECUTE') and has_function_privilege('authenticated','public.sync_push(jsonb)','EXECUTE'),'RPC solo para autenticados');
rollback;
