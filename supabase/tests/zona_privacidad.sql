-- Privacidad de la zona: distancia por bandas y límite de cambios de celda. Datos sintéticos en el mar
-- (lat 41.0, lng 2.5); termina con rollback.
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
  ('00000000-0000-0000-0000-0000000000a1', 'a1@example.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 'a2@example.invalid'),
  ('00000000-0000-0000-0000-0000000000a3', 'a3@example.invalid'),
  ('00000000-0000-0000-0000-0000000000a4', 'a4@example.invalid'),
  ('00000000-0000-0000-0000-0000000000a5', 'a5@example.invalid'),
  ('00000000-0000-0000-0000-0000000000a6', 'a6@example.invalid');
-- Desde 41.00, 2.50: a2 a unos 3 km, a3 a unos 9 km, a4 a unos 22 km, a5 y a6 a unos 44 km.
update public.profiles set username = 'zz_cerca', locality = 'Celda Uno', area_lat = 41.03, area_lng = 2.50
  where id = '00000000-0000-0000-0000-0000000000a2';
update public.profiles set username = 'bb_medio', locality = 'Celda Dos', area_lat = 41.08, area_lng = 2.50
  where id = '00000000-0000-0000-0000-0000000000a3';
update public.profiles set username = 'cc_lejos', locality = 'Celda Tres', area_lat = 41.20, area_lng = 2.50
  where id = '00000000-0000-0000-0000-0000000000a4';
update public.profiles set username = 'yy_borde', locality = 'Celda Cuatro', area_lat = 41.40, area_lng = 2.50
  where id = '00000000-0000-0000-0000-0000000000a5';
update public.profiles set username = 'aa_borde', locality = 'Celda Cinco', area_lat = 41.40, area_lng = 2.51
  where id = '00000000-0000-0000-0000-0000000000a6';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
-- 1.º cambio: el alta de la zona (de null a valor) cuenta.
update public.profiles set locality = 'Celda Base', area_lat = 41.00, area_lng = 2.50 where id = auth.uid();

-- La distancia sale solo como banda (5, 10, 25 o 50), ordenada por banda y después por usuario.
select pg_temp.check_true((select bool_and(distance_km in (5, 10, 25, 50)) from public.search_profiles_near(50)),
  'la distancia siempre es 5, 10, 25 o 50');
select pg_temp.check_true((select array_agg(username || ':' || distance_km) = array['zz_cerca:5', 'bb_medio:10', 'cc_lejos:25', 'aa_borde:50', 'yy_borde:50']
  from public.search_profiles_near(50)), 'bandas por distancia y usuario dentro de la banda');
select pg_temp.check_true((select array_agg(distance_km) = array[5, 10, 25]::double precision[]
  from public.search_profiles_near(25)), 'a 25 km se queda en la banda de 25');

-- Las columnas de control no se leen ni se escriben.
select pg_temp.expect_error('update public.profiles set area_changes = 0 where id = auth.uid()', '42501');
select pg_temp.expect_error('update public.profiles set area_window_start = null where id = auth.uid()', '42501');
select pg_temp.expect_error('select area_changes from public.profiles', '42501');

-- Cambiar solo la visibilidad, la localidad o volver a guardar la misma celda no cuenta.
update public.profiles set show_area = false where id = auth.uid();
update public.profiles set show_area = true where id = auth.uid();
update public.profiles set locality = 'Celda Base Dos' where id = auth.uid();
update public.profiles set area_lat = 41.00, area_lng = 2.50 where id = auth.uid();
-- 2.º y 3.º cambios pasan; el 4.º en 24 h se rechaza con su mensaje y su código.
update public.profiles set area_lat = 41.01 where id = auth.uid();
update public.profiles set area_lng = 2.51 where id = auth.uid();
select pg_temp.expect_error('update public.profiles set area_lat = 41.02 where id = auth.uid()', 'ZN429',
  'Has cambiado tu zona demasiadas veces hoy. Prueba mañana.');
select pg_temp.check_true((select count(*) = 1 from public.search_profiles('zz_cerca')), 'sigue pudiendo buscar');
-- Pasado el límite, la visibilidad y la localidad se siguen pudiendo cambiar.
update public.profiles set show_area = false, locality = 'Celda Final' where id = auth.uid();
select pg_temp.check_true((select locality = 'Celda Final' and not show_area from public.my_area()), 'visibilidad sin límite');

-- Pasadas 24 h desde el primer cambio, la ventana vuelve a empezar.
reset role;
update public.profiles set area_window_start = now() - interval '25 hours' where id = '00000000-0000-0000-0000-0000000000a1';
set local role authenticated;
update public.profiles set area_lat = 41.02 where id = auth.uid();
reset role;
select pg_temp.check_true((select area_changes = 1 and area_window_start = now() from public.profiles
  where id = '00000000-0000-0000-0000-0000000000a1'), 'ventana nueva tras 24 h');
rollback;
