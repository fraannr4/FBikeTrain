-- «Me gusta» de retos y salidas compartidas: solo el propio, solo sobre lo que ya se puede ver.
begin;
create function pg_temp.ok(value boolean,message text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
create function pg_temp.fails(statement text,state text) returns void language plpgsql as $$ begin
  begin execute statement; exception when others then if sqlstate = state then return; end if; raise; end;
  raise exception 'FAIL: no se rechazó %',statement;
end $$;
create function pg_temp.who(account_id text) returns void language sql as $$ select set_config('request.jwt.claim.sub',account_id,true) $$;
insert into auth.users(id,email,is_anonymous) values
('00000000-0000-0000-0000-000000000301','mg-a@example.invalid',false),
('00000000-0000-0000-0000-000000000302','mg-b@example.invalid',false),
('00000000-0000-0000-0000-000000000303','mg-c@example.invalid',false),
('00000000-0000-0000-0000-000000000304','mg-anon@example.invalid',true);
set local role authenticated;
-- A reta a B; C queda fuera. A publica una nota solo para amigos y otra para la comunidad.
select pg_temp.who('00000000-0000-0000-0000-000000000301');
select set_config('test.reto',public.create_community_challenge('Duelo de prueba','distance',7,array['00000000-0000-0000-0000-000000000302']::uuid[],100000)::text,true);
select set_config('test.privada',public.create_profile_post('Solo amigos','friends',null)::text,true);
select set_config('test.publica',public.create_profile_post('Para todos','everyone',null)::text,true);

-- Dar «me gusta» a lo visible; la clave única impide duplicar.
insert into public.likes(user_id,object_type,object_id) values (auth.uid(),'challenge',current_setting('test.reto')::uuid);
insert into public.likes(user_id,object_type,object_id) values (auth.uid(),'post',current_setting('test.publica')::uuid);
select pg_temp.fails($$insert into public.likes(user_id,object_type,object_id) values (auth.uid(),'post',current_setting('test.publica')::uuid)$$,'23505');
-- Solo en nombre propio, con tipo válido y sobre objetos que existen y se ven.
select pg_temp.fails($$insert into public.likes(user_id,object_type,object_id) values ('00000000-0000-0000-0000-000000000302','post',current_setting('test.publica')::uuid)$$,'42501');
select pg_temp.fails($$insert into public.likes(user_id,object_type,object_id) values (auth.uid(),'segmento',current_setting('test.publica')::uuid)$$,'42501');
select pg_temp.fails($$insert into public.likes(user_id,object_type,object_id) values (auth.uid(),'post','00000000-0000-0000-0000-00000000ffff')$$,'42501');
select pg_temp.fails('update public.likes set object_id = object_id','42501');

-- B ve el reto y la nota pública; la nota privada (no son amigos) no.
select pg_temp.who('00000000-0000-0000-0000-000000000302');
select pg_temp.ok((select count(*) = 0 from public.likes),'B no lee quién dio me gusta');
select pg_temp.ok((select count(*) = 2 from public.like_counts),'B lee el recuento de lo que ve');
select pg_temp.fails($$insert into public.likes(user_id,object_type,object_id) values (auth.uid(),'post',current_setting('test.privada')::uuid)$$,'42501');
insert into public.likes(user_id,object_type,object_id) values (auth.uid(),'challenge',current_setting('test.reto')::uuid);
-- Recuento y marca propia en una sola consulta.
select pg_temp.ok((select like_count = 2 and liked from public.list_likes('challenge',array[current_setting('test.reto')::uuid])),'recuento 2 y propio');
select pg_temp.ok((select like_count = 1 and not liked from public.list_likes('post',array[current_setting('test.publica')::uuid])),'recuento 1 y no propio');
select pg_temp.ok((select count(*) = 3 from public.list_likes('post',array[current_setting('test.publica')::uuid,current_setting('test.privada')::uuid,'00000000-0000-0000-0000-00000000ffff']::uuid[])),'una fila por id pedido');
select pg_temp.ok((select like_count = 0 and not liked from public.list_likes('post',array[current_setting('test.privada')::uuid])),'la nota oculta no revela nada');
select pg_temp.fails($$select * from public.list_likes('segmento',array[]::uuid[])$$,'22023');
select pg_temp.fails($$select * from public.list_likes('post',(select array_agg(gen_random_uuid()) from generate_series(1,101)))$$,'22023');

-- C no ve el reto ni sus me gusta; sí la nota pública.
select pg_temp.who('00000000-0000-0000-0000-000000000303');
select pg_temp.ok((select count(*) = 0 from public.likes),'C no lee me gusta ajenos');
select pg_temp.ok((select count(*) = 1 from public.like_counts),'C solo lee el recuento de la nota pública');
select pg_temp.fails($$insert into public.likes(user_id,object_type,object_id) values (auth.uid(),'challenge',current_setting('test.reto')::uuid)$$,'42501');
select pg_temp.ok((select like_count = 0 and not liked from public.list_likes('challenge',array[current_setting('test.reto')::uuid])),'el reto ajeno no revela recuento');
-- Cuenta anónima: ni dar ni leer.
select pg_temp.who('00000000-0000-0000-0000-000000000304');
select pg_temp.ok((select count(*) = 0 from public.likes) and (select count(*) = 0 from public.like_counts),'anónima no lee');
select pg_temp.fails('update public.like_counts set like_count = 99','42501');
select pg_temp.fails($$insert into public.likes(user_id,object_type,object_id) values (auth.uid(),'post',current_setting('test.publica')::uuid)$$,'42501');
-- Nadie borra el de otro; cada cual quita el suyo.
select pg_temp.who('00000000-0000-0000-0000-000000000303');
delete from public.likes;
select pg_temp.who('00000000-0000-0000-0000-000000000302');
select pg_temp.ok((select count(*) = 1 from public.likes),'B solo ve el suyo');
select pg_temp.ok((select like_count = 2 from public.list_likes('challenge',array[current_setting('test.reto')::uuid])),'borrar ajenos no hace nada');
delete from public.likes where user_id = auth.uid() and object_type = 'challenge';
select pg_temp.ok((select like_count = 1 and not liked from public.list_likes('challenge',array[current_setting('test.reto')::uuid])),'quitar el propio baja el recuento');
select pg_temp.fails('update public.likes set created_at = now()','42501');
select pg_temp.fails('select * from public.list_likes(''post'',null)','22023');
select pg_temp.ok(has_function_privilege('authenticated','public.list_likes(text,uuid[])','EXECUTE') and not has_function_privilege('anon','public.list_likes(text,uuid[])','EXECUTE'),'RPC solo para autenticados');
select pg_temp.ok(not has_table_privilege('anon','public.likes','SELECT'),'anon sin acceso a la tabla');
rollback;
