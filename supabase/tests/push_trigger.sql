-- Trigger de push: sin configuración no encola nada; con ella envía el aviso con el nombre público
-- del actor y el secreto; un fallo al encolar nunca impide crear el aviso.
-- `net.http_post` es un doble del runner: apunta cada llamada en net.calls.
begin;
create function pg_temp.ok(value boolean,message text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
insert into auth.users(id,email,is_anonymous) values
('00000000-0000-0000-0000-000000000501','trigger-a@example.invalid',false),
('00000000-0000-0000-0000-000000000502','trigger-b@example.invalid',false);
update public.profiles set display_name = 'Ana Ruta' where id = '00000000-0000-0000-0000-000000000501';

-- Sin fila de configuración, el trigger no hace nada.
insert into public.community_notifications(user_id,kind,actor_id) values
('00000000-0000-0000-0000-000000000502','friendship','00000000-0000-0000-0000-000000000501');
select pg_temp.ok((select count(*) = 0 from net.calls),'sin configuración no se encola');

-- Con configuración: una petición por aviso, con el nombre público y el secreto.
insert into private.push_config(url,secret) values ('https://ejemplo.invalid/push',repeat('s',32));
insert into public.community_notifications(user_id,kind,actor_id) values
('00000000-0000-0000-0000-000000000502','friendship_accepted','00000000-0000-0000-0000-000000000501');
select pg_temp.ok((select count(*) = 1 from net.calls),'una petición por aviso');
select pg_temp.ok((select url = 'https://ejemplo.invalid/push' and headers->>'x-push-secret' = repeat('s',32)
  and headers->>'Content-Type' = 'application/json' from net.calls),'destino, secreto y tipo de contenido');
select pg_temp.ok((select body->>'type' = 'INSERT' and body->>'table' = 'community_notifications'
  and body->'record'->>'user_id' = '00000000-0000-0000-0000-000000000502'
  and body->'record'->>'kind' = 'friendship_accepted'
  and body->'record'->>'actor_name' = 'Ana Ruta' from net.calls),'cuerpo con destinatario, tipo y nombre público');
select pg_temp.ok((select not (body->'record' ? 'actor_id') from net.calls),'el identificador del actor no viaja');

-- Aviso sin actor: se encola igual, sin nombre.
delete from net.calls;
insert into public.community_notifications(user_id,kind) values ('00000000-0000-0000-0000-000000000502','finished');
select pg_temp.ok((select count(*) = 1 and bool_and(body->'record'->'actor_name' = 'null'::jsonb) from net.calls),'sin actor: nombre nulo');

-- Si encolar falla, el aviso se crea igual.
delete from net.calls;
update private.push_config set url = 'https://falla.invalid/';
insert into public.community_notifications(user_id,kind,actor_id) values
('00000000-0000-0000-0000-000000000501','friendship','00000000-0000-0000-0000-000000000502');
select pg_temp.ok((select count(*) = 1 from public.community_notifications
  where user_id = '00000000-0000-0000-0000-000000000501' and kind = 'friendship'),'el fallo al encolar no impide el aviso');
select pg_temp.ok((select count(*) = 0 from net.calls),'la petición fallida no queda apuntada');

-- Nadie fuera del servidor lee el secreto ni ejecuta la función.
select pg_temp.ok(not has_table_privilege('anon','private.push_config','SELECT')
  and not has_table_privilege('authenticated','private.push_config','SELECT'),'configuración sin lectura');
select pg_temp.ok(not has_schema_privilege('anon','private','USAGE')
  and not has_schema_privilege('authenticated','private','USAGE'),'esquema privado sin acceso');
select pg_temp.ok(not has_function_privilege('anon','private.notify_push()','EXECUTE')
  and not has_function_privilege('authenticated','private.notify_push()','EXECUTE'),'función del trigger sin ejecución');
rollback;
