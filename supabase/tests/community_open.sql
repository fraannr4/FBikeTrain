begin;
create function pg_temp.ok(value boolean,message text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
create function pg_temp.fails(statement text,state text) returns void language plpgsql as $$ begin
  begin execute statement; exception when others then if sqlstate = state then return; end if; raise; end;
  raise exception 'FAIL: no se rechazó %',statement;
end $$;
create function pg_temp.who(account_id text) returns void language sql as $$ select set_config('request.jwt.claim.sub',account_id,true) $$;
insert into auth.users(id,email,is_anonymous) values
('00000000-0000-0000-0000-000000000101','a@example.invalid',false),
('00000000-0000-0000-0000-000000000102','b@example.invalid',false),
('00000000-0000-0000-0000-000000000103','c@example.invalid',false),
('00000000-0000-0000-0000-000000000104','anon@example.invalid',true),
('00000000-0000-0000-0000-000000000105','outsider@example.invalid',false);
update public.profiles set display_name = 'Ciclista Uno',username = 'ciclista_uno',locality = 'Pueblo sintético',area_lat = 41.61,area_lng = 2.29 where id::text like '%0101';
update public.profiles set display_name = 'Ciclista Dos',username = 'ciclista_dos',locality = 'Secreto',show_area = false,area_lat = 41.63,area_lng = 2.29 where id::text like '%0102';
update public.profiles set locality='Cerca',area_lat=41.64,area_lng=2.29 where id::text like '%0103';
set local role authenticated;
select pg_temp.who('00000000-0000-0000-0000-000000000101');
select pg_temp.ok((select count(*) = 4 from public.list_cyclists()),'todas las cuentas registradas, incluida la propia');
select pg_temp.ok((select count(*) = 0 from public.list_cyclists('%')),'búsqueda literal sin comodines');
select pg_temp.ok((select count(*) = 1 from public.list_cyclists('Uno')),'búsqueda nombre');
select pg_temp.ok((select count(*) = 0 from public.list_cyclists('',50)),'página siguiente');
select pg_temp.ok((select locality is null and distance_km is null from public.list_cyclists('Dos')),'zona oculta y ninguna distancia');
select pg_temp.fails('select area_lat,area_lng from public.profiles','42501');
select pg_temp.fails('select * from public.community_presence','42501');
select pg_temp.fails('update public.profiles set area_changes = 0','42501');
select pg_temp.fails('update public.community_rate_limits set used=0','42501');
update public.profiles set bio = 'Propia' where id = auth.uid();
update public.profiles set bio = 'Ajena' where id = '00000000-0000-0000-0000-000000000102';
select pg_temp.ok((select bio = '' from public.profiles where id::text like '%0102'),'perfil ajeno solo lectura');
select public.touch_community_activity();
select pg_temp.ok((select id = auth.uid() and last_active_at = date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' from public.list_cyclists() limit 1),'orden reciente por día sin hora exacta');
select pg_temp.ok((select bool_and(distance_km in (5,10,25,50)) from public.search_profiles_near(25)),'bandas existentes preservadas');
-- Duelo y grupo sin ninguna amistad previa.
select set_config('test.community',public.create_community_challenge('100 km','distance',7,array['00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000103']::uuid[],100000)::text,true);
select pg_temp.ok(jsonb_array_length(public.get_community_challenge(current_setting('test.community')::uuid)->'members') = 3,'grupo con creador y dos invitados');
select pg_temp.ok(public.get_community_challenge(current_setting('test.community')::uuid)->'winner_ids' = '[]','sin ganador provisional');
select pg_temp.fails($$select public.create_community_challenge('X','distance',0,array['00000000-0000-0000-0000-000000000102']::uuid[])$$,'22023');
select pg_temp.fails($$select public.create_community_challenge('X','distance',31,array['00000000-0000-0000-0000-000000000102']::uuid[])$$,'22023');
select pg_temp.fails($$select public.create_community_challenge('X','distance',1,array['00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000102']::uuid[])$$,'22023');
select pg_temp.fails($$select public.create_community_challenge('X','distance',1,array['00000000-0000-0000-0000-000000000104']::uuid[])$$,'22023');
select pg_temp.fails($$select public.create_community_challenge('X','speed',1,array['00000000-0000-0000-0000-000000000102']::uuid[])$$,'22023');
select pg_temp.fails($$select public.create_community_challenge('X','segment',1,array['00000000-0000-0000-0000-000000000102']::uuid[],null,1000,'gps coords')$$,'22023');
select pg_temp.fails($$select public.create_community_challenge('X','distance',1,array['00000000-0000-0000-0000-000000000102']::uuid[],'NaN')$$,'22023');
select pg_temp.fails($$select public.create_community_challenge('X','speed',1,array['00000000-0000-0000-0000-000000000102']::uuid[],1000,1000)$$,'22023');
select pg_temp.fails($$select public.submit_community_score(current_setting('test.community')::uuid,'NaN')$$,'22023');
select pg_temp.fails($$select public.submit_community_score(current_setting('test.community')::uuid,'Infinity')$$,'22023');
select pg_temp.fails($$select public.submit_community_score(current_setting('test.community')::uuid,-1)$$,'22023');
select public.submit_community_score(current_setting('test.community')::uuid,42000);
select public.submit_community_score(current_setting('test.community')::uuid,41000);
select pg_temp.ok((select count(*) = 1 and min(score)=41000 from public.community_challenge_scores),'snapshot reemplaza, no suma ni duplica');
select pg_temp.fails('update public.community_challenge_scores set score=1','42501');
select pg_temp.fails('update public.community_challenge_members set status=''accepted''','42501');
select pg_temp.fails('delete from public.community_challenges','42501');
select pg_temp.fails('select public.community_consume_quota(1)','42501');
select pg_temp.fails('select public.community_old_list_challenges()','42501');
select pg_temp.ok((select bool_and(not has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE'))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and left(p.proname,10)='community_'
    and p.proname not in ('community_registered','community_visible','community_challenge_visible')),'ningún helper interno tiene EXECUTE del cliente');
-- Invitado pendiente no publica score; aceptar es irreversible.
select pg_temp.who('00000000-0000-0000-0000-000000000102');
select pg_temp.fails($$select public.submit_community_score(current_setting('test.community')::uuid,41000)$$,'42501');
select pg_temp.ok((select count(*) = 1 from public.list_community_notifications()),'invitación interna propia');
select set_config('test.notice',(select id::text from public.list_community_notifications() limit 1),true);
select public.read_community_notification(current_setting('test.notice')::uuid);
select pg_temp.ok((select read_at is not null from public.list_community_notifications() limit 1),'aviso leído');
select public.respond_community_challenge(current_setting('test.community')::uuid,true);
select pg_temp.fails($$select public.respond_community_challenge(current_setting('test.community')::uuid,false)$$,'22023');
select public.submit_community_score(current_setting('test.community')::uuid,41000);
-- Un tercero no invitado no ve tablas ni RPC ni puede responder/escribir/leer avisos.
select pg_temp.who('00000000-0000-0000-0000-000000000105');
select pg_temp.ok(public.get_community_challenge(current_setting('test.community')::uuid) is null,'outsider sin detalle');
select pg_temp.ok((select count(*)=0 from public.community_challenges),'outsider sin tablas');
select pg_temp.ok((select count(*)=0 from public.community_challenge_members),'outsider sin miembros');
select pg_temp.ok((select count(*)=0 from public.community_challenge_scores),'outsider sin cifras');
select pg_temp.fails($$select public.respond_community_challenge(current_setting('test.community')::uuid,true)$$,'42501');
select pg_temp.fails($$select public.submit_community_score(current_setting('test.community')::uuid,100000)$$,'42501');
select pg_temp.fails($$select public.read_community_notification(current_setting('test.notice')::uuid)$$,'42501');
select pg_temp.who('00000000-0000-0000-0000-000000000103');
select public.respond_community_challenge(current_setting('test.community')::uuid,false);
-- Cierre, empate y rechazo persistentes. Ajustar timestamps como administrador para simular tiempo.
reset role;
update public.community_challenges set created_at = now() - interval '8 days',deadline = now() - interval '1 day' where id = current_setting('test.community')::uuid;
set local role authenticated;
select pg_temp.who('00000000-0000-0000-0000-000000000101');
select pg_temp.ok(public.get_community_challenge(current_setting('test.community')::uuid)->>'status' = 'finished','cierre automático sin cron');
select pg_temp.ok(jsonb_array_length(public.get_community_challenge(current_setting('test.community')::uuid)->'winner_ids')=2,'empate compartido');
select pg_temp.fails($$select public.submit_community_score(current_setting('test.community')::uuid,1000000)$$,'22023');
select pg_temp.ok((select count(*)=1 from public.list_community_notifications() where kind='finished'),'notificación de cierre');
select pg_temp.ok((select count(*)=1 from public.list_community_notifications() where kind='finished'),'cierre no duplica avisos');
-- Segmento gana el menor tiempo positivo. Cero no vence a tiempo válido.
select set_config('test.segment',public.create_community_challenge('Subida','segment',1,array['00000000-0000-0000-0000-000000000102']::uuid[],null,1200,repeat('a',64))::text,true);
select public.submit_community_score(current_setting('test.segment')::uuid,600);
select pg_temp.who('00000000-0000-0000-0000-000000000102');
select public.respond_community_challenge(current_setting('test.segment')::uuid,true);
select public.submit_community_score(current_setting('test.segment')::uuid,650);
reset role;
update public.community_challenges set created_at=now()-interval '2 days',deadline=now()-interval '1 day' where id=current_setting('test.segment')::uuid;
set local role authenticated;
select pg_temp.ok(public.get_community_challenge(current_setting('test.segment')::uuid)->'winner_ids' = '["00000000-0000-0000-0000-000000000101"]','segmento gana tiempo menor');
-- Anónimos autenticados y rol anon: ni perfiles, ni nuevas ni viejas RPC sociales.
select pg_temp.who('00000000-0000-0000-0000-000000000104');
select pg_temp.ok(not public.community_registered('00000000-0000-0000-0000-000000000101'),'anónimo no puede sondear existencia de cuentas mediante helper');
select pg_temp.ok((select count(*)=0 from public.profiles),'anónimo autenticado no lee perfiles');
select pg_temp.fails('select * from public.list_cyclists()','42501');
select pg_temp.fails('select public.touch_community_activity()','42501');
select pg_temp.fails('select public.list_community_challenges()','42501');
select pg_temp.fails('select public.list_challenges()','42501');
select pg_temp.fails('select public.list_friends()','42501');
select pg_temp.fails($$select public.search_profiles('Ciclista')$$,'42501');
select pg_temp.fails($$select public.request_friendship('00000000-0000-0000-0000-000000000101')$$,'42501');
select pg_temp.fails($$select public.block_cyclist('00000000-0000-0000-0000-000000000101',true)$$,'42501');
select pg_temp.fails($$select public.report_cyclist('00000000-0000-0000-0000-000000000101','Prueba')$$,'42501');
select pg_temp.fails($$select public.create_profile_post('Anónimo')$$,'42501');
set local role anon;
select pg_temp.who('');
select pg_temp.fails('select * from public.list_cyclists()','42501');
select pg_temp.fails('select * from public.community_challenges','42501');
-- Bloqueo bidireccional: desaparece perfil, búsquedas, cuaderno, amistades, retos y avisos.
set local role authenticated;
select pg_temp.who('00000000-0000-0000-0000-000000000101');
select public.request_friendship('00000000-0000-0000-0000-000000000102');
select pg_temp.who('00000000-0000-0000-0000-000000000102');
select public.accept_friendship((select id from public.friendships where requester_id='00000000-0000-0000-0000-000000000101'));
select pg_temp.who('00000000-0000-0000-0000-000000000101');
select set_config('test.legacy',public.create_challenge('00000000-0000-0000-0000-000000000102','Ruta sintética','[[1,1],[2,2]]',10000,null)::text,true);
select pg_temp.ok((select count(*)=1 from public.list_challenges()),'RPC legacy sigue disponible con guardas');
select pg_temp.who('00000000-0000-0000-0000-000000000102');
select public.respond_challenge(current_setting('test.legacy')::uuid,true);
select public.submit_challenge_result(current_setting('test.legacy')::uuid,(now() at time zone 'Europe/Madrid')::date,2000,10000,5,100,null);
select pg_temp.who('00000000-0000-0000-0000-000000000101');
select public.create_profile_post('Texto público','everyone');
select public.block_cyclist('00000000-0000-0000-0000-000000000102',true);
select pg_temp.ok((select count(*)=1 from public.list_blocked_cyclists()),'gestión de bloqueados');
select pg_temp.ok((select count(*)=0 from public.list_friends()),'bloquear retira amistad');
select pg_temp.ok((select count(*)=0 from public.list_cyclists('Dos')),'bloqueado fuera directorio');
select pg_temp.ok(public.get_community_challenge(current_setting('test.community')::uuid) is null,'reto bloqueado oculto');
select pg_temp.ok((select count(*)=0 from public.list_challenges()),'retos legacy bloqueados ocultos');
select pg_temp.fails($$select public.submit_challenge_result(current_setting('test.legacy')::uuid,(now() at time zone 'Europe/Madrid')::date,2000,10000,5,100,null)$$,'42501');
select pg_temp.fails($$select public.request_friendship('00000000-0000-0000-0000-000000000102')$$,'42501');
select pg_temp.who('00000000-0000-0000-0000-000000000102');
select pg_temp.ok((select count(*)=0 from public.profiles where id::text like '%0101'),'bloqueo inverso perfil directo');
select pg_temp.ok((select count(*)=0 from public.search_profiles('Uno')),'bloqueo inverso búsqueda');
select pg_temp.ok((select count(*)=0 from public.profile_posts),'bloqueo inverso cuaderno');
select pg_temp.ok((select count(*)=0 from public.list_community_notifications()),'bloqueo oculta avisos');
select pg_temp.fails($$select public.create_community_challenge('X','rides',1,array['00000000-0000-0000-0000-000000000101']::uuid[])$$,'22023');
select public.report_cyclist('00000000-0000-0000-0000-000000000101','Conducta inapropiada sintética');
select pg_temp.ok((select count(*)=1 from public.community_reports),'denunciante lee la suya');
select pg_temp.who('00000000-0000-0000-0000-000000000101');
select pg_temp.ok((select count(*)=0 from public.community_reports),'denunciado no lee denuncia');
select public.block_cyclist('00000000-0000-0000-0000-000000000102',false);
select pg_temp.ok((select count(*)=1 from public.list_cyclists('Dos')),'desbloqueo devuelve visibilidad');
-- Cuota consume por destinatario, no se devuelve al borrar solicitudes.
reset role;
update public.community_rate_limits set used=0 where user_id::text like '%0101';
set local role authenticated;
do $$ declare i integer; f uuid; begin
  for i in 1..20 loop
    perform public.request_friendship('00000000-0000-0000-0000-000000000102');
    select id into f from public.friendships where requester_id=auth.uid();
    perform public.remove_friendship(f);
  end loop;
end $$;
select pg_temp.fails($$select public.request_friendship('00000000-0000-0000-0000-000000000103')$$,'P0429');
select pg_temp.fails($$select public.create_community_challenge('X','rides',1,array['00000000-0000-0000-0000-000000000103']::uuid[])$$,'P0429');
reset role;
update public.community_rate_limits set window_start=now()-interval '25 hours' where user_id::text like '%0101';
set local role authenticated;
select public.request_friendship('00000000-0000-0000-0000-000000000103');
select pg_temp.ok((select count(*)=1 from public.list_friends()),'cuota reinicia pasado plazo');
-- Una invitación ignorada no permite proclamarse ganador frente a nadie.
select set_config('test.solo',public.create_community_challenge('Sin rival','rides',1,array['00000000-0000-0000-0000-000000000102']::uuid[])::text,true);
select public.submit_community_score(current_setting('test.solo')::uuid,2);
select pg_temp.fails($$select public.submit_community_score(current_setting('test.solo')::uuid,2.5)$$,'22023');
reset role;
update public.community_challenges set created_at=now()-interval '2 days',deadline=now()-interval '1 day' where id=current_setting('test.solo')::uuid;
set local role authenticated;
select pg_temp.ok(public.get_community_challenge(current_setting('test.solo')::uuid)->'winner_ids'='[]','sin dos aceptados no hay ganador');
-- Ninguna cifra cero produce ganador, incluso con dos aceptados.
select set_config('test.zero',public.create_community_challenge('Sin salidas','elevation',1,array['00000000-0000-0000-0000-000000000102']::uuid[])::text,true);
select public.submit_community_score(current_setting('test.zero')::uuid,0);
select pg_temp.who('00000000-0000-0000-0000-000000000102');
select public.respond_community_challenge(current_setting('test.zero')::uuid,true);
select public.submit_community_score(current_setting('test.zero')::uuid,0);
reset role;
update public.community_challenges set created_at=now()-interval '2 days',deadline=now()-interval '1 day' where id=current_setting('test.zero')::uuid;
set local role authenticated;
select pg_temp.ok(public.get_community_challenge(current_setting('test.zero')::uuid)->'winner_ids'='[]','cero no gana');
-- Grupos no pueden invitar a dos cuentas que se han bloqueado entre sí.
select pg_temp.who('00000000-0000-0000-0000-000000000102');
select public.block_cyclist('00000000-0000-0000-0000-000000000103',true);
select pg_temp.who('00000000-0000-0000-0000-000000000101');
select pg_temp.fails($$select public.create_community_challenge('Grupo','rides',1,array['00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000103']::uuid[])$$,'42501');
-- Directorio: páginas de 50 alcanzan a todos los usuarios, con desempate estable.
reset role;
insert into auth.users(id,email) select ('10000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,'synthetic@example.invalid' from generate_series(1,55) i;
set local role authenticated;
select pg_temp.ok((select count(*)=50 from public.list_cyclists()),'primera página de 50');
select pg_temp.ok((select count(*)=9 from public.list_cyclists('',50)),'segunda página incluye resto, sin anónimo');
select pg_temp.ok((select count(*)=0 from (select id from public.list_cyclists() intersect select id from public.list_cyclists('',50)) t),'páginas estables no se solapan');
select pg_temp.fails('select * from public.list_cyclists('''',-1)','22023');
select pg_temp.fails('select public.list_community_challenges(-1)','22023');
-- Un grupo de 20 consume 19 invitaciones, y comparte el mismo presupuesto con amistades.
reset role;
update public.community_rate_limits set used=0,window_start=now() where user_id::text like '%0101';
set local role authenticated;
select set_config('test.largegroup',public.create_community_challenge('Grupo de veinte','rides',30,
  (select array_agg(('10000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid) from generate_series(1,19) i))::text,true);
select pg_temp.ok(jsonb_array_length(public.get_community_challenge(current_setting('test.largegroup')::uuid)->'members')=20,'grupo máximo veinte');
select public.request_friendship('00000000-0000-0000-0000-000000000102');
select pg_temp.fails($$select public.create_community_challenge('Sin cuota','rides',1,array['00000000-0000-0000-0000-000000000105']::uuid[])$$,'P0429');
select pg_temp.fails($$select public.create_community_challenge('Demasiados','rides',1,(select array_agg(('10000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid) from generate_series(1,20) i))$$,'22023');
-- Lectura de detalles y paginación de retos no dependen de figurar entre los primeros 50.
reset role;
insert into public.community_challenges(id,creator_id,title,kind,deadline)
  select ('20000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000101','Reto sintético ' || i,'rides',now()+interval '1 day' from generate_series(1,55) i;
insert into public.community_challenge_members(challenge_id,user_id,status,accepted_at)
  select ('20000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000101','accepted',now() from generate_series(1,55) i;
set local role authenticated;
select pg_temp.ok((select count(*)=50 from public.list_community_challenges()),'retos paginados cincuenta');
select pg_temp.ok((select count(*)>0 from public.list_community_challenges(50)),'historial accesible más allá de cincuenta');
select pg_temp.ok(public.get_community_challenge('20000000-0000-0000-0000-000000000001') is not null,'detalle por id independiente de página');
-- Las denuncias solo se revisan desde el servicio; el destinatario nunca las recibe.
set local role service_role;
select pg_temp.ok((select count(*)=1 from public.community_reports),'servicio puede moderar denuncias');
rollback;
