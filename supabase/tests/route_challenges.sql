-- Reto de ruta: geometría solo para participantes, resultado con cifras validadas y el mejor tiempo por persona.
-- Coordenadas sintéticas en el mar frente a la costa (lat 41.0, lng 2.5).
begin;
create function pg_temp.ok(value boolean,message text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
create function pg_temp.fails(statement text,state text) returns void language plpgsql as $$ begin
  begin execute statement; exception when others then if sqlstate = state then return; end if; raise; end;
  raise exception 'FAIL: no se rechazó %',statement;
end $$;
create function pg_temp.who(account_id text) returns void language sql as $$ select set_config('request.jwt.claim.sub',account_id,true) $$;
insert into auth.users(id,email,is_anonymous) values
('00000000-0000-0000-0000-000000000201','ruta-a@example.invalid',false),
('00000000-0000-0000-0000-000000000202','ruta-b@example.invalid',false),
('00000000-0000-0000-0000-000000000203','ruta-c@example.invalid',false),
('00000000-0000-0000-0000-000000000204','ruta-anon@example.invalid',true);
-- 21 puntos de 41.00 a 41.20 en lng 2.5: unos 22 km.
select set_config('test.line',(select jsonb_agg(jsonb_build_array(41.0 + i * 0.01,2.5) order by i)::text from generate_series(0,20) i),false);
set local role authenticated;
select pg_temp.who('00000000-0000-0000-0000-000000000201');

-- Creación: mismas reglas que los retos (1-30 días, invitados visibles) y ruta acotada.
select set_config('test.route',public.create_route_challenge('Ruta del faro',7,array['00000000-0000-0000-0000-000000000202']::uuid[],current_setting('test.line')::jsonb,20000)::text,true);
select pg_temp.ok(public.get_community_challenge(current_setting('test.route')::uuid)->>'kind' = 'route','el reto de ruta es un reto de la comunidad');
select pg_temp.ok((public.get_community_challenge(current_setting('test.route')::uuid)->>'route_distance_m')::integer = 20000,'el detalle lleva la distancia de la ruta');
select pg_temp.ok(not (public.get_community_challenge(current_setting('test.route')::uuid) ? 'points'),'el listado no arrastra la geometría');
select pg_temp.fails($$select public.create_route_challenge('X',0,array['00000000-0000-0000-0000-000000000202']::uuid[],current_setting('test.line')::jsonb,20000)$$,'22023');
select pg_temp.fails($$select public.create_route_challenge('X',31,array['00000000-0000-0000-0000-000000000202']::uuid[],current_setting('test.line')::jsonb,20000)$$,'22023');
select pg_temp.fails($$select public.create_route_challenge('X',7,array['00000000-0000-0000-0000-000000000201']::uuid[],current_setting('test.line')::jsonb,20000)$$,'22023');
select pg_temp.fails($$select public.create_route_challenge('X',7,array['00000000-0000-0000-0000-000000000204']::uuid[],current_setting('test.line')::jsonb,20000)$$,'22023');
select pg_temp.fails($$select public.create_route_challenge('X',7,array['00000000-0000-0000-0000-000000000202']::uuid[],'[[41.0,2.5]]',20000)$$,'22023');
select pg_temp.fails($$select public.create_route_challenge('X',7,array['00000000-0000-0000-0000-000000000202']::uuid[],(select jsonb_agg(jsonb_build_array(41.0,2.5 + i * 0.0001)) from generate_series(1,2001) i),20000)$$,'22023');
select pg_temp.fails($$select public.create_route_challenge('X',7,array['00000000-0000-0000-0000-000000000202']::uuid[],'[[41.0,2.5],[91,2.5]]',20000)$$,'22023');
select pg_temp.fails($$select public.create_route_challenge('X',7,array['00000000-0000-0000-0000-000000000202']::uuid[],'[[41.0,2.5],["a",2.5]]',20000)$$,'22023');
select pg_temp.fails($$select public.create_route_challenge('X',7,array['00000000-0000-0000-0000-000000000202']::uuid[],'{"a":1}',20000)$$,'22023');
select pg_temp.fails($$select public.create_route_challenge('X',7,array['00000000-0000-0000-0000-000000000202']::uuid[],current_setting('test.line')::jsonb,999)$$,'22023');
select pg_temp.fails($$select public.create_route_challenge('X',7,array['00000000-0000-0000-0000-000000000202']::uuid[],current_setting('test.line')::jsonb,1000001)$$,'22023');
-- El tipo nuevo no entra por la RPC genérica sin geometría.
select pg_temp.fails($$select public.create_community_challenge('X','route',7,array['00000000-0000-0000-0000-000000000202']::uuid[])$$,'22023');

-- Geometría: la leen los participantes (también el invitado pendiente), nadie más; nadie la escribe.
select pg_temp.ok((select count(*) = 1 and jsonb_array_length(min(points::text)::jsonb) = 21 from public.community_route_challenges),'el creador lee la geometría');
select pg_temp.fails('update public.community_route_challenges set distance_m = 1','42501');
select pg_temp.fails('delete from public.community_route_challenges','42501');
select pg_temp.fails($$insert into public.community_route_results(challenge_id,user_id,moving_time_s,coverage,ridden_at,activity_ref) values(current_setting('test.route')::uuid,auth.uid(),1,1,now(),'x')$$,'42501');
select pg_temp.who('00000000-0000-0000-0000-000000000202');
select pg_temp.ok((select count(*) = 1 from public.community_route_challenges),'el invitado pendiente ve la ruta antes de aceptar');
select pg_temp.who('00000000-0000-0000-0000-000000000203');
select pg_temp.ok((select count(*) = 0 from public.community_route_challenges),'un ajeno no ve la geometría');
select pg_temp.ok((select count(*) = 0 from public.community_route_results),'un ajeno no ve resultados');
select pg_temp.fails($$select public.submit_route_result(current_setting('test.route')::uuid,3600,0.95,now(),'1700000000000-20000')$$,'42501');
select pg_temp.who('00000000-0000-0000-0000-000000000204');
select pg_temp.ok((select count(*) = 0 from public.community_route_challenges),'un anónimo no ve la geometría');
select pg_temp.fails($$select public.create_route_challenge('X',7,array['00000000-0000-0000-0000-000000000202']::uuid[],current_setting('test.line')::jsonb,20000)$$,'42501');

-- Resultado del creador: rangos del servidor y se guarda el mejor tiempo.
select pg_temp.who('00000000-0000-0000-0000-000000000201');
select pg_temp.fails($$select public.submit_route_result(current_setting('test.route')::uuid,3600,0.89,now(),'1700000000000-20000')$$,'22023');
select pg_temp.fails($$select public.submit_route_result(current_setting('test.route')::uuid,3600,1.01,now(),'1700000000000-20000')$$,'22023');
-- 20 km a 60 km/h son 1.200 s.
select pg_temp.fails($$select public.submit_route_result(current_setting('test.route')::uuid,1199,0.95,now(),'1700000000000-20000')$$,'22023');
select pg_temp.fails($$select public.submit_route_result(current_setting('test.route')::uuid,2592001,0.95,now(),'1700000000000-20000')$$,'22023');
select pg_temp.fails($$select public.submit_route_result(current_setting('test.route')::uuid,3600,0.95,now() - interval '1 hour','1700000000000-20000')$$,'22023');
select pg_temp.fails($$select public.submit_route_result(current_setting('test.route')::uuid,3600,0.95,now() + interval '1 hour','1700000000000-20000')$$,'22023');
select pg_temp.fails($$select public.submit_route_result(current_setting('test.route')::uuid,3600,0.95,now(),'')$$,'22023');
select pg_temp.fails($$select public.submit_route_result(current_setting('test.route')::uuid,3600,0.95,now(),'<script>')$$,'22023');
select pg_temp.fails($$select public.submit_community_score(current_setting('test.route')::uuid,3600)$$,'22023');
select public.submit_route_result(current_setting('test.route')::uuid,3600,0.95,now(),'1700000000000-20000');
select public.submit_route_result(current_setting('test.route')::uuid,4000,0.99,now(),'1700000000001-20000');
select pg_temp.ok((select moving_time_s = 3600 and activity_ref = '1700000000000-20000' from public.community_route_results),'un peor tiempo no reemplaza al mejor');
select public.submit_route_result(current_setting('test.route')::uuid,1200,0.91,now(),'1700000000002-20000');
select pg_temp.ok((select moving_time_s = 1200 and abs(coverage - 0.91) < 1e-6 from public.community_route_results),'un tiempo mejor reemplaza al anterior');
select pg_temp.ok((select score = 1200 from public.community_challenge_scores where challenge_id = current_setting('test.route')::uuid),'el marcador común lleva el mejor tiempo');

-- El invitado: pendiente no publica; aceptado sí, desde su aceptación.
select pg_temp.who('00000000-0000-0000-0000-000000000202');
select pg_temp.fails($$select public.submit_route_result(current_setting('test.route')::uuid,3000,0.95,now(),'1700000000000-20000')$$,'42501');
select public.respond_community_challenge(current_setting('test.route')::uuid,true);
select public.submit_route_result(current_setting('test.route')::uuid,1300,0.97,now(),'1700000000000-20000');
select pg_temp.ok((select count(*) = 2 from public.community_route_results),'los participantes leen los dos resultados');
select pg_temp.ok((select jsonb_array_length(public.get_community_challenge(current_setting('test.route')::uuid)->'winner_ids') = 0),'sin ganador antes del cierre');

-- Cierre: gana el menor tiempo y no se admiten resultados tardíos.
reset role;
update public.community_challenges set created_at = now() - interval '8 days',deadline = now() - interval '1 second' where id = current_setting('test.route')::uuid;
update public.community_challenge_members set accepted_at = now() - interval '8 days' where challenge_id = current_setting('test.route')::uuid;
set local role authenticated;
select pg_temp.ok(public.get_community_challenge(current_setting('test.route')::uuid)->'winner_ids' = '["00000000-0000-0000-0000-000000000201"]','gana el menor tiempo');
select pg_temp.fails($$select public.submit_route_result(current_setting('test.route')::uuid,1250,0.95,now() - interval '1 day','1700000000000-20000')$$,'22023');

-- Bloquear oculta el reto entero, también la geometría.
select pg_temp.who('00000000-0000-0000-0000-000000000202');
select set_config('test.route2',public.create_route_challenge('Otra ruta',3,array['00000000-0000-0000-0000-000000000201']::uuid[],current_setting('test.line')::jsonb,20000)::text,true);
select pg_temp.who('00000000-0000-0000-0000-000000000201');
select public.block_cyclist('00000000-0000-0000-0000-000000000202',true);
select pg_temp.ok((select count(*) = 0 from public.community_route_challenges),'el bloqueo oculta la geometría');
select pg_temp.fails($$select public.submit_route_result(current_setting('test.route2')::uuid,3600,0.95,now(),'1700000000000-20000')$$,'42501');
select public.block_cyclist('00000000-0000-0000-0000-000000000202',false);

-- Cuota compartida de 20 destinatarios por 24 h.
reset role;
update public.community_rate_limits set used = 20,window_start = now() where user_id = '00000000-0000-0000-0000-000000000201';
set local role authenticated;
select pg_temp.fails($$select public.create_route_challenge('X',7,array['00000000-0000-0000-0000-000000000203']::uuid[],current_setting('test.line')::jsonb,20000)$$,'P0429');

-- Ningún helper nuevo queda expuesto; las RPC de la ruta sí.
select pg_temp.ok((select bool_and(not has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE'))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and left(p.proname,10)='community_'
    and p.proname not in ('community_current_registered','community_readable_profile_ids','community_challenge_visible')),'ningún helper interno tiene EXECUTE del cliente');
select pg_temp.ok(has_function_privilege('authenticated','public.create_route_challenge(text,integer,uuid[],jsonb,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.submit_route_result(uuid,integer,real,timestamptz,text)','EXECUTE')
  and not has_function_privilege('anon','public.submit_route_result(uuid,integer,real,timestamptz,text)','EXECUTE'),'RPC de ruta solo para autenticados');
rollback;
