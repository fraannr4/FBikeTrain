-- Zona aproximada, búsqueda de perfiles y listado de amistades. Datos sintéticos; termina con rollback.
begin;
create function pg_temp.check_true(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %', message; end if;
end $$;
create function pg_temp.expect_error(statement text, expected_state text, expected_message text default null) returns void
language plpgsql as $$ begin
  begin execute statement;
  exception when others then
    if sqlstate = expected_state and (expected_message is null or sqlerrm = expected_message) then return; end if;
    raise;
  end;
  raise exception 'FAIL: no se rechazó %', statement;
end $$;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-000000000001', 'one@example.invalid'),
  ('00000000-0000-0000-0000-000000000002', 'two@example.invalid'),
  ('00000000-0000-0000-0000-000000000003', 'three@example.invalid'),
  ('00000000-0000-0000-0000-000000000004', 'four@example.invalid'),
  ('00000000-0000-0000-0000-000000000005', 'five@example.invalid');
select pg_temp.check_true((select bool_and(show_area and locality is null and area_lat is null)
  from public.profiles where id::text like '00000000-%'), 'zona vacía y visible por defecto');
-- 2 a unos 10 km, 3 a unos 40 km, 4 a unos 4 km pero con la zona oculta; 5 conserva el usuario automático.
update public.profiles set username = 'ana_ruta', display_name = 'Ana Ruta', locality = 'Pueblo Norte', area_lat = 41.70, area_lng = 2.29
  where id = '00000000-0000-0000-0000-000000000002';
update public.profiles set username = 'bea_puerto', display_name = 'Bea Puerto', locality = 'Pueblo Lejano', area_lat = 41.97, area_lng = 2.29
  where id = '00000000-0000-0000-0000-000000000003';
update public.profiles set username = 'ana_oculta', display_name = 'Ana Oculta', locality = 'Pueblo Oculto', area_lat = 41.65, area_lng = 2.29, show_area = false
  where id = '00000000-0000-0000-0000-000000000004';
select pg_temp.expect_error('update public.profiles set area_lat = 41.6123 where id = ''00000000-0000-0000-0000-000000000005''', '23514');
select pg_temp.expect_error('update public.profiles set area_lat = 41.61, area_lng = null where id = ''00000000-0000-0000-0000-000000000005''', '23514');
select pg_temp.expect_error('update public.profiles set locality = '''' where id = ''00000000-0000-0000-0000-000000000005''', '23514');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
-- Sin zona propia no hay búsqueda cercana.
select pg_temp.expect_error('select * from public.search_profiles_near(25)', '22023', 'Sin zona configurada');
-- El dueño guarda su zona; la celda tiene que ir redondeada a 2 decimales.
update public.profiles set display_name = 'Ana Centro', locality = 'Pueblo Centro', area_lat = 41.61, area_lng = 2.29 where id = auth.uid();
select pg_temp.expect_error('update public.profiles set area_lat = 41.6123 where id = auth.uid()', '23514');
update public.profiles set locality = 'Intrusión' where id = '00000000-0000-0000-0000-000000000002';
select pg_temp.check_true((select locality = 'Pueblo Norte' from public.search_profiles('ana_ruta')), 'no editar la zona de otro');
-- La zona ajena no se lee directamente: solo por las RPC.
select pg_temp.expect_error('select locality from public.profiles', '42501');
select pg_temp.expect_error('select area_lat, area_lng from public.profiles', '42501');
select pg_temp.check_true((select count(*) = 5 from public.profiles where id::text like '00000000-%'), 'búsqueda autenticada sigue disponible');
select pg_temp.check_true((select locality = 'Pueblo Centro' and show_area from public.my_area()), 'el dueño lee su zona');

-- Cerca: 25 km encuentra a 2; 50 km también a 3; 4 oculta su zona y nunca aparece.
select pg_temp.check_true((select array_agg(username order by distance_km) = array['ana_ruta']
  from public.search_profiles_near(25)), 'a 25 km solo la zona a 10 km');
select pg_temp.check_true((select array_agg(username order by distance_km) = array['ana_ruta', 'bea_puerto']
  from public.search_profiles_near(50)), 'a 50 km también la zona a 40 km, por distancia');
select pg_temp.check_true((select distance_km between 9 and 11 and locality = 'Pueblo Norte'
  from public.search_profiles_near(25)), 'distancia aproximada y localidad visible');
select pg_temp.expect_error('select * from public.search_profiles_near(30)', '22023');

-- Por nombre: 3 letras como mínimo, patrón escapado, sin el propio usuario.
select pg_temp.expect_error('select * from public.search_profiles(''ab'')', '22023', 'Escribe al menos 3 letras');
select pg_temp.expect_error('select * from public.search_profiles(''  ab  '')', '22023', 'Escribe al menos 3 letras');
select pg_temp.check_true((select array_agg(username order by username) = array['ana_oculta', 'ana_ruta']
  from public.search_profiles('ana')), 'por usuario y nombre visible, sin el propio (Ana Centro)');
select pg_temp.check_true((select locality is null and distance_km is null from public.search_profiles('oculta')), 'zona oculta sale como null');
select pg_temp.check_true((select locality = 'Pueblo Norte' from public.search_profiles('Ana Ruta')), 'zona visible por nombre');
select pg_temp.check_true((select count(*) = 0 from public.search_profiles('%%%')), 'el % no devuelve todos los perfiles');
select pg_temp.check_true((select count(*) = 0 from public.search_profiles('a%a')), 'el % es literal');
select pg_temp.check_true((select count(*) = 0 from public.search_profiles('___')), 'el _ no devuelve todos los perfiles');
select pg_temp.check_true((select count(*) = 0 from public.search_profiles('\\\')), 'la barra invertida es literal');
select pg_temp.check_true((select count(*) = 0 from public.search_profiles('''x''')), 'las comillas no rompen la consulta');
-- El usuario automático (hexadecimal del id) no es un nombre: no se busca por él.
select pg_temp.check_true((select count(*) = 0 from public.search_profiles('00000000000')), 'sin coincidencias por el usuario automático');

-- Amistades: dirección según quién la pidió y localidad según la visibilidad del otro.
select public.request_friendship('00000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select public.request_friendship('00000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select pg_temp.check_true((select count(*) = 2 from public.list_friends()), 'lista solo mis amistades');
select pg_temp.check_true((select direction = 'sent' and status = 'pending' and (profile).username = 'ana_ruta' and (profile).locality = 'Pueblo Norte'
  from public.list_friends() where (profile).id = '00000000-0000-0000-0000-000000000002'), 'solicitud enviada');
select pg_temp.check_true((select direction = 'received' and (profile).locality is null
  from public.list_friends() where (profile).id = '00000000-0000-0000-0000-000000000004'), 'solicitud recibida sin zona oculta');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select pg_temp.check_true((select count(*) = 0 from public.list_friends()), 'un tercero no ve amistades ajenas');

-- Ocultar la zona propia la retira de la búsqueda cercana de los demás.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
update public.profiles set show_area = false where id = auth.uid();
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select pg_temp.check_true((select array_agg(username) = array['bea_puerto'] from public.search_profiles_near(50)), 'zona ocultada al momento');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.expect_error('select * from public.search_profiles(''ana'')', '42501');
select pg_temp.expect_error('select * from public.search_profiles_near(25)', '42501');
select pg_temp.expect_error('select * from public.list_friends()', '42501');
select pg_temp.expect_error('select * from public.my_area()', '42501');
rollback;
