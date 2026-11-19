-- Chat entre amigos: solo miembros leen, todo se escribe por RPC, idempotencia, cuotas, bloqueo y aviso push.
-- `net.http_post` es un doble del runner: apunta cada llamada en net.calls.
-- Dentro de la transacción now() no avanza: el paso del tiempo se simula moviendo marcas como superusuario.
begin;
create function pg_temp.ok(value boolean,message text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
create function pg_temp.fails(statement text,state text) returns void language plpgsql as $$ begin
  begin execute statement; exception when others then if sqlstate = state then return; end if; raise; end;
  raise exception 'FAIL: no se rechazó %',statement;
end $$;
create function pg_temp.fails_msg(statement text,state text,message text) returns void language plpgsql as $$ begin
  begin execute statement; exception when others then if sqlstate = state and sqlerrm = message then return; end if; raise; end;
  raise exception 'FAIL: no se rechazó %',statement;
end $$;
create function pg_temp.who(account_id text) returns void language sql as $$ select set_config('request.jwt.claim.sub',account_id,true) $$;
insert into auth.users(id,email,is_anonymous) values
('00000000-0000-0000-0000-000000000401','chat-a@example.invalid',false),
('00000000-0000-0000-0000-000000000402','chat-b@example.invalid',false),
('00000000-0000-0000-0000-000000000403','chat-c@example.invalid',false),
('00000000-0000-0000-0000-000000000404','chat-anon@example.invalid',true),
('00000000-0000-0000-0000-000000000405','chat-e@example.invalid',false);
update public.profiles set display_name = 'Ana Ruta' where id = '00000000-0000-0000-0000-000000000401';
update public.profiles set display_name = 'Beto Costa' where id = '00000000-0000-0000-0000-000000000402';
-- A y B amigos; A y E amigos; A y C no.
insert into public.friendships(id,requester_id,recipient_id,status) values
('00000000-0000-0000-0000-0000000004f1','00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000402','accepted'),
('00000000-0000-0000-0000-0000000004f2','00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000405','accepted');

-- Permisos: RPC solo para autenticados; tablas solo de lectura; trigger inaccesible.
select pg_temp.ok(bool_and(has_function_privilege('authenticated',f,'EXECUTE') and not has_function_privilege('anon',f,'EXECUTE')),'RPC solo para autenticados')
  from unnest(array['public.chat_is_member(uuid)','public.chat_open_direct(uuid)','public.chat_list_conversations()',
    'public.chat_list_messages(uuid,timestamptz,integer)','public.chat_send(uuid,uuid,text,text,jsonb)','public.chat_mark_read(uuid)',
    'public.chat_delete_message(uuid)','public.chat_set_muted(uuid,boolean)','public.chat_unread_count()','public.report_chat_message(uuid,text)']) f;
select pg_temp.ok(not has_function_privilege('authenticated','private.notify_chat_push()','EXECUTE') and not has_function_privilege('anon','private.notify_chat_push()','EXECUTE'),'función del trigger sin ejecución');
select pg_temp.ok(bool_and(not has_table_privilege('authenticated',t,'INSERT') and not has_table_privilege('authenticated',t,'UPDATE')
  and not has_table_privilege('authenticated',t,'DELETE') and not has_table_privilege('anon',t,'SELECT')),'tablas sin escritura directa ni acceso anónimo')
  from unnest(array['public.chat_conversations','public.chat_members','public.chat_messages']) t;
select pg_temp.ok(has_table_privilege('authenticated','public.chat_messages','SELECT') and not has_table_privilege('authenticated','public.chat_conversations','SELECT')
  and not has_table_privilege('authenticated','public.chat_members','SELECT'),'solo los mensajes se leen directamente (Realtime); conversaciones y miembros, por RPC');

set local role authenticated;
-- Abrir
select pg_temp.who('00000000-0000-0000-0000-000000000401');
select set_config('test.conv',public.chat_open_direct('00000000-0000-0000-0000-000000000402')::text,true);
select pg_temp.ok(public.chat_open_direct('00000000-0000-0000-0000-000000000402') = current_setting('test.conv')::uuid,'abrir dos veces devuelve la misma');
select pg_temp.fails_msg($$select public.chat_open_direct('00000000-0000-0000-0000-000000000403')$$,'42501','Conversación no disponible');
select pg_temp.fails_msg($$select public.chat_open_direct('00000000-0000-0000-0000-000000000401')$$,'22023','Usuario no disponible');
select pg_temp.fails_msg($$select public.chat_open_direct('00000000-0000-0000-0000-000000000404')$$,'22023','Usuario no disponible');
select set_config('test.conv2',public.chat_open_direct('00000000-0000-0000-0000-000000000405')::text,true);
select pg_temp.ok(current_setting('test.conv2') <> current_setting('test.conv'),'otra amistad, otra conversación');
select pg_temp.who('00000000-0000-0000-0000-000000000402');
select pg_temp.ok(public.chat_open_direct('00000000-0000-0000-0000-000000000401') = current_setting('test.conv')::uuid,'B abre la misma que A');

-- Enviar e idempotencia
select pg_temp.who('00000000-0000-0000-0000-000000000401');
select pg_temp.ok((select count(*) = 1 and bool_and(body = 'Hola' and sender_name = 'Ana Ruta' and kind = 'text' and not deleted)
  from public.chat_send('00000000-0000-0000-0000-0000000004a1',current_setting('test.conv')::uuid,'text','Hola','{}')),'envía');
select pg_temp.ok((select count(*) = 1 from public.chat_send('00000000-0000-0000-0000-0000000004a1',current_setting('test.conv')::uuid,'text','Hola','{}')),'repetir id no falla');
select pg_temp.ok((select count(*) = 1 from public.chat_messages where id = '00000000-0000-0000-0000-0000000004a1'),'repetir id no duplica');
select pg_temp.fails_msg($$select public.chat_send('00000000-0000-0000-0000-0000000004a2',current_setting('test.conv')::uuid,'text','','{}')$$,'22023','Mensaje no válido');
select pg_temp.fails($$select public.chat_send('00000000-0000-0000-0000-0000000004a2',current_setting('test.conv')::uuid,'text','   ','{}')$$,'22023');
select pg_temp.fails($$select public.chat_send('00000000-0000-0000-0000-0000000004a2',current_setting('test.conv')::uuid,'text',E'\n\n \t\r\n','{}')$$,'22023');
select pg_temp.fails($$select public.chat_send('00000000-0000-0000-0000-0000000004a2',current_setting('test.conv')::uuid,'text',null,'{}')$$,'22023');
select pg_temp.fails($$select public.chat_send('00000000-0000-0000-0000-0000000004a3',current_setting('test.conv')::uuid,'text',repeat('x',2001),'{}')$$,'22023');
select pg_temp.fails($$select public.chat_send('00000000-0000-0000-0000-0000000004a4',current_setting('test.conv')::uuid,'ride','','{}')$$,'22023');
select pg_temp.fails($$select public.chat_send('00000000-0000-0000-0000-0000000004a4',current_setting('test.conv')::uuid,'text','Hola','{"x":1}')$$,'22023');
select pg_temp.fails($$select public.chat_send(null,current_setting('test.conv')::uuid,'text','Hola','{}')$$,'22023');
select pg_temp.ok((select count(*) = 0 from public.chat_messages where id in ('00000000-0000-0000-0000-0000000004a2','00000000-0000-0000-0000-0000000004a3','00000000-0000-0000-0000-0000000004a4')),'lo rechazado no se guarda');
select pg_temp.ok((select char_length(body) = 2000 from public.chat_send('00000000-0000-0000-0000-0000000004a5',current_setting('test.conv')::uuid,'text',repeat('🚴',2000),'{}')),'2000 caracteres con emoji pasan');
select pg_temp.ok((select count(*) = 1 from public.chat_send('00000000-0000-0000-0000-0000000004a6',current_setting('test.conv')::uuid,'text',E'Línea uno\nLínea dos','{}')),'texto con salto de línea');
-- El mismo id en otra conversación o de otra persona no devuelve el mensaje ajeno.
select pg_temp.fails_msg($$select public.chat_send('00000000-0000-0000-0000-0000000004a1',current_setting('test.conv2')::uuid,'text','Hola','{}')$$,'22023','Mensaje no válido');
select pg_temp.ok((select count(*) = 1 from public.chat_send('00000000-0000-0000-0000-0000000004e1',current_setting('test.conv2')::uuid,'text','Hola E','{}')),'A escribe a E');
select pg_temp.who('00000000-0000-0000-0000-000000000402');
select pg_temp.fails_msg($$select public.chat_send('00000000-0000-0000-0000-0000000004a1',current_setting('test.conv')::uuid,'text','Hola','{}')$$,'22023','Mensaje no válido');
select pg_temp.ok((select sender_id = '00000000-0000-0000-0000-000000000401' and body = 'Hola' from public.chat_messages where id = '00000000-0000-0000-0000-0000000004a1'),'el mensaje de A sigue intacto');
-- Escritura directa en tablas, también siendo miembro.
select pg_temp.fails($$insert into public.chat_messages(id,conversation_id,sender_id,kind,body) values (gen_random_uuid(),current_setting('test.conv')::uuid,auth.uid(),'text','x')$$,'42501');
select pg_temp.fails($$update public.chat_messages set body = 'cambiado'$$,'42501');
select pg_temp.fails($$delete from public.chat_messages$$,'42501');
select pg_temp.fails($$update public.chat_members set muted = true$$,'42501');
select pg_temp.fails($$insert into public.chat_conversations(kind,title) values ('group','Grupo')$$,'42501');
select pg_temp.fails($$delete from public.chat_conversations$$,'42501');
-- Un miembro no puede mirar si la otra persona le ha silenciado.
select pg_temp.fails($$select muted from public.chat_members$$,'42501');
select pg_temp.fails($$select 1 from public.chat_conversations$$,'42501');

-- Tercero
select pg_temp.who('00000000-0000-0000-0000-000000000403');
select pg_temp.ok((select count(*) = 0 from public.chat_messages),'un tercero no lee mensajes');
select pg_temp.fails($$select 1 from public.chat_conversations$$,'42501');
select pg_temp.fails($$select 1 from public.chat_members$$,'42501');
select pg_temp.ok((select count(*) = 0 from public.chat_list_conversations()),'ni las lista');
select pg_temp.ok(not public.chat_is_member(current_setting('test.conv')::uuid),'no es miembro');
select pg_temp.fails_msg($$select * from public.chat_list_messages(current_setting('test.conv')::uuid)$$,'42501','Conversación no disponible');
select pg_temp.fails_msg($$select public.chat_send(gen_random_uuid(),current_setting('test.conv')::uuid,'text','Hola','{}')$$,'42501','Conversación no disponible');
select pg_temp.fails($$select public.chat_mark_read(current_setting('test.conv')::uuid)$$,'42501');
select pg_temp.fails($$select public.chat_set_muted(current_setting('test.conv')::uuid,true)$$,'42501');
select pg_temp.fails($$insert into public.chat_messages(id,conversation_id,sender_id,kind,body) values (gen_random_uuid(),current_setting('test.conv')::uuid,auth.uid(),'text','x')$$,'42501');

-- Sin leer, leído y «Visto»
select pg_temp.who('00000000-0000-0000-0000-000000000402');
select pg_temp.ok((select count(*) = 3 from public.chat_messages),'B lee los mensajes de su conversación');
select pg_temp.ok(public.chat_unread_count() = 1,'B tiene una conversación sin leer');
select pg_temp.ok((select unread = 3 and peer_id = '00000000-0000-0000-0000-000000000401' and peer_name = 'Ana Ruta' and kind = 'direct'
  and last_kind = 'text' and last_preview = 'Línea uno Línea dos' and last_sender_id = '00000000-0000-0000-0000-000000000401' and can_send and not muted
  from public.chat_list_conversations()),'B ve la conversación con tres sin leer y el último texto en una línea');
select public.chat_mark_read(current_setting('test.conv')::uuid);
select pg_temp.ok(public.chat_unread_count() = 0,'tras leer, cero');
select pg_temp.who('00000000-0000-0000-0000-000000000401');
select pg_temp.ok((select peer_last_read_at is not null and unread = 0 from public.chat_list_conversations() where id = current_setting('test.conv')::uuid),'A ve que B ha leído');
-- Orden y página
select pg_temp.ok((select array_agg(id) = array['00000000-0000-0000-0000-0000000004a6','00000000-0000-0000-0000-0000000004a5']::uuid[]
  from public.chat_list_messages(current_setting('test.conv')::uuid,null,2)),'página de 2, del más reciente al más antiguo');
select pg_temp.ok((select count(*) = 0 from public.chat_list_messages(current_setting('test.conv')::uuid,now() - interval '1 minute')),'nada antes del cursor');
select pg_temp.fails($$select * from public.chat_list_messages(current_setting('test.conv')::uuid,null,0)$$,'22023');
select pg_temp.fails($$select * from public.chat_list_messages(current_setting('test.conv')::uuid,null,101)$$,'22023');

-- Borrar
select pg_temp.who('00000000-0000-0000-0000-000000000402');
select pg_temp.fails($$select public.chat_delete_message('00000000-0000-0000-0000-0000000004a1')$$,'42501');
select pg_temp.who('00000000-0000-0000-0000-000000000401');
select public.chat_delete_message('00000000-0000-0000-0000-0000000004a1');
select pg_temp.ok((select deleted and body = '' and payload = '{}'::jsonb from public.chat_list_messages(current_setting('test.conv')::uuid) where id = '00000000-0000-0000-0000-0000000004a1'),'borrado: sin texto');
select pg_temp.ok((select count(*) = 1 from public.chat_messages where id = '00000000-0000-0000-0000-0000000004a1'),'la fila borrada se conserva');
select pg_temp.ok((select not last_deleted from public.chat_list_conversations() where id = current_setting('test.conv')::uuid),'el último mensaje de esa conversación no es el borrado');
select public.chat_delete_message('00000000-0000-0000-0000-0000000004e1');
select pg_temp.ok((select last_deleted and last_preview = '' and last_kind = 'text' from public.chat_list_conversations() where id = current_setting('test.conv2')::uuid),'la lista marca que el último mensaje está borrado');

-- Cuota: 30 por minuto. Los envíos anteriores se mueven fuera de la ventana.
reset role;
update public.chat_messages set created_at = created_at - interval '2 minutes' where sender_id = '00000000-0000-0000-0000-000000000401';
set local role authenticated;
do $$ begin for i in 1..30 loop
  perform public.chat_send(gen_random_uuid(),current_setting('test.conv')::uuid,'text','Mensaje ' || i,'{}');
end loop; end $$;
select pg_temp.fails_msg($$select public.chat_send(gen_random_uuid(),current_setting('test.conv')::uuid,'text','El 31','{}')$$,'P0429','Demasiados mensajes seguidos');
-- Cuota: 600 al día.
reset role;
update public.chat_messages set created_at = created_at - interval '2 minutes' where sender_id = '00000000-0000-0000-0000-000000000401';
insert into public.chat_messages(id,conversation_id,sender_id,kind,body,created_at)
  select gen_random_uuid(),current_setting('test.conv')::uuid,'00000000-0000-0000-0000-000000000401','text','relleno',now() - interval '1 hour' from generate_series(1,600);
set local role authenticated;
select pg_temp.fails_msg($$select public.chat_send(gen_random_uuid(),current_setting('test.conv')::uuid,'text','Uno más','{}')$$,'P0429','Límite diario de mensajes');
reset role;
delete from public.chat_messages where body = 'relleno';

-- Push (como superusuario: configuración y registro de llamadas vacío)
insert into private.push_config(url,secret) values ('https://ejemplo.invalid/push',repeat('s',32));
delete from net.calls;
set local role authenticated;
select pg_temp.who('00000000-0000-0000-0000-000000000401');
select public.chat_send('00000000-0000-0000-0000-0000000004b1',current_setting('test.conv')::uuid,'text','Hola push','{}');
-- net.calls solo lo lee el superusuario.
reset role;
select pg_temp.ok((select count(*) = 1 from net.calls),'un mensaje, un aviso');
select pg_temp.ok((select url = 'https://ejemplo.invalid/push' and headers->>'x-push-secret' = repeat('s',32)
  and body->>'type' = 'INSERT' and body->>'table' = 'chat_messages'
  and body->'record'->>'user_id' = '00000000-0000-0000-0000-000000000402' and body->'record'->>'kind' = 'text'
  and body->'record'->>'conversation_id' = current_setting('test.conv') and body->'record'->>'actor_name' = 'Ana Ruta'
  and body->'record'->'title' = 'null'::jsonb and body->'record'->>'preview' = 'Hola push' from net.calls),'aviso con destinatario, nombre y texto');
select pg_temp.ok((select strpos(body::text,repeat('s',32)) = 0 from net.calls),'el secreto no va en el cuerpo');
set local role authenticated;
select public.chat_send('00000000-0000-0000-0000-0000000004b2',current_setting('test.conv')::uuid,'text','Otro','{}');
reset role;
select pg_temp.ok((select count(*) = 1 from net.calls),'freno de 20 s');
update public.chat_members set last_notified_at = now() - interval '1 minute' where user_id = '00000000-0000-0000-0000-000000000402';
set local role authenticated;
select public.chat_send('00000000-0000-0000-0000-0000000004b3',current_setting('test.conv')::uuid,'text','Tercero','{}');
reset role;
select pg_temp.ok((select count(*) = 2 from net.calls),'pasado el freno, otro aviso');
delete from net.calls;
update public.chat_members set last_notified_at = now() - interval '1 minute' where user_id = '00000000-0000-0000-0000-000000000402';
set local role authenticated;
select public.chat_send('00000000-0000-0000-0000-0000000004b4',current_setting('test.conv')::uuid,'text',repeat('y',500),'{}');
reset role;
select pg_temp.ok((select char_length(body->'record'->>'preview') = 120 from net.calls),'el aviso lleva 120 caracteres');
set local role authenticated;
-- Silenciada: ni aviso ni cuenta en la insignia.
select pg_temp.who('00000000-0000-0000-0000-000000000402');
select public.chat_set_muted(current_setting('test.conv')::uuid,true);
reset role;
delete from net.calls;
update public.chat_members set last_notified_at = now() - interval '1 minute', last_read_at = now() - interval '1 hour' where user_id = '00000000-0000-0000-0000-000000000402';
set local role authenticated;
select pg_temp.who('00000000-0000-0000-0000-000000000401');
select public.chat_send('00000000-0000-0000-0000-0000000004b5',current_setting('test.conv')::uuid,'text','Silencio','{}');
reset role;
select pg_temp.ok((select count(*) = 0 from net.calls),'silenciada: sin aviso');
set local role authenticated;
select pg_temp.who('00000000-0000-0000-0000-000000000402');
select pg_temp.ok(public.chat_unread_count() = 0,'silenciada: no cuenta');
select pg_temp.ok((select muted and unread > 0 from public.chat_list_conversations()),'silenciada pero con mensajes sin leer');
select public.chat_set_muted(current_setting('test.conv')::uuid,false);
select pg_temp.ok(public.chat_unread_count() = 1,'sin silenciar, cuenta');
-- Si el aviso falla, el mensaje se guarda igual.
reset role;
update private.push_config set url = 'https://falla.invalid/';
update public.chat_members set last_notified_at = null where user_id = '00000000-0000-0000-0000-000000000402';
set local role authenticated;
select pg_temp.who('00000000-0000-0000-0000-000000000401');
select public.chat_send('00000000-0000-0000-0000-0000000004b6',current_setting('test.conv')::uuid,'text','Con la red caída','{}');
select pg_temp.ok((select count(*) = 1 from public.chat_messages where id = '00000000-0000-0000-0000-0000000004b6'),'el fallo del aviso no impide guardar');
reset role;
select pg_temp.ok((select count(*) = 0 from net.calls),'la petición fallida no queda apuntada');
set local role authenticated;

-- Amistad retirada: no se escribe, el historial se sigue leyendo.
select public.remove_friendship('00000000-0000-0000-0000-0000000004f1');
select pg_temp.fails_msg($$select public.chat_send(gen_random_uuid(),current_setting('test.conv')::uuid,'text','Hola','{}')$$,'42501','Ya no sois amigos');
select pg_temp.ok((select count(*) > 0 from public.chat_list_messages(current_setting('test.conv')::uuid)),'el historial sigue legible');
select pg_temp.ok((select not can_send from public.chat_list_conversations() where id = current_setting('test.conv')::uuid),'la lista dice que no se puede escribir');
select pg_temp.fails($$select public.chat_open_direct('00000000-0000-0000-0000-000000000402')$$,'42501');

-- Denuncia: guarda el mensaje y su texto, y bloquea al autor.
select pg_temp.fails_msg($$select public.report_chat_message('00000000-0000-0000-0000-0000000004b1','Mensaje propio de prueba')$$,'22023','Denuncia no válida');
select pg_temp.who('00000000-0000-0000-0000-000000000403');
select pg_temp.fails($$select public.report_chat_message('00000000-0000-0000-0000-0000000004b1','Mensaje ajeno de prueba')$$,'22023');
select pg_temp.who('00000000-0000-0000-0000-000000000402');
select pg_temp.fails($$select public.report_chat_message('00000000-0000-0000-0000-0000000004b1','abc')$$,'22023');
select public.report_chat_message('00000000-0000-0000-0000-0000000004b1','Mensaje ofensivo de prueba');
select pg_temp.ok((select count(*) = 1 and bool_and(target_id = '00000000-0000-0000-0000-000000000401' and message_id = '00000000-0000-0000-0000-0000000004b1'
  and message_body = 'Hola push' and reason = 'Mensaje ofensivo de prueba') from public.community_reports),'la denuncia guarda mensaje y copia del texto');
select pg_temp.ok((select count(*) = 1 from public.community_blocks where blocked_id = '00000000-0000-0000-0000-000000000401'),'y bloquea al autor');
-- Con bloqueo la conversación deja de listarse y de leerse, en los dos lados.
select pg_temp.ok((select count(*) = 0 from public.chat_list_conversations()),'B ya no la lista');
select pg_temp.who('00000000-0000-0000-0000-000000000401');
select pg_temp.ok((select count(*) = 0 from public.chat_list_conversations() where id = current_setting('test.conv')::uuid),'A ya no la lista');
select pg_temp.ok((select count(*) = 0 from public.chat_messages where conversation_id = current_setting('test.conv')::uuid),'ni lee sus mensajes');
select pg_temp.fails_msg($$select * from public.chat_list_messages(current_setting('test.conv')::uuid)$$,'42501','Conversación no disponible');
select pg_temp.fails_msg($$select public.chat_send(gen_random_uuid(),current_setting('test.conv')::uuid,'text','Hola','{}')$$,'42501','Conversación no disponible');
-- Bloqueo directo con block_cyclist.
select pg_temp.who('00000000-0000-0000-0000-000000000405');
select pg_temp.ok((select count(*) = 1 from public.chat_list_conversations()),'E lista su conversación con A');
select pg_temp.who('00000000-0000-0000-0000-000000000401');
select public.block_cyclist('00000000-0000-0000-0000-000000000405',true);
select pg_temp.who('00000000-0000-0000-0000-000000000405');
select pg_temp.ok((select count(*) = 0 from public.chat_list_conversations()),'bloqueado: E ya no la lista');

-- Cuenta anónima y sin sesión: toda RPC falla con 42501.
select pg_temp.who('00000000-0000-0000-0000-000000000404');
select pg_temp.fails($$select public.chat_open_direct('00000000-0000-0000-0000-000000000401')$$,'42501');
select pg_temp.fails($$select * from public.chat_list_conversations()$$,'42501');
select pg_temp.fails($$select * from public.chat_list_messages(current_setting('test.conv')::uuid)$$,'42501');
select pg_temp.fails($$select public.chat_send(gen_random_uuid(),current_setting('test.conv')::uuid,'text','Hola','{}')$$,'42501');
select pg_temp.fails($$select public.chat_mark_read(current_setting('test.conv')::uuid)$$,'42501');
select pg_temp.fails($$select public.chat_delete_message('00000000-0000-0000-0000-0000000004b1')$$,'42501');
select pg_temp.fails($$select public.chat_set_muted(current_setting('test.conv')::uuid,true)$$,'42501');
select pg_temp.fails($$select public.chat_unread_count()$$,'42501');
select pg_temp.fails($$select public.report_chat_message('00000000-0000-0000-0000-0000000004b1','Mensaje de prueba')$$,'42501');
select pg_temp.ok((select count(*) = 0 from public.chat_messages) and not public.chat_is_member(current_setting('test.conv')::uuid),'anónima no lee nada');
select pg_temp.who('');
select pg_temp.fails($$select * from public.chat_list_conversations()$$,'42501');
select pg_temp.fails($$select public.chat_unread_count()$$,'42501');

-- Borrar el perfil de A borra sus mensajes y su fila de miembro.
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-000000000401';
select pg_temp.ok((select count(*) = 0 from public.chat_messages where sender_id = '00000000-0000-0000-0000-000000000401'),'sin mensajes de A');
select pg_temp.ok((select count(*) = 0 from public.chat_members where user_id = '00000000-0000-0000-0000-000000000401'),'sin filas de miembro de A');
rollback;
