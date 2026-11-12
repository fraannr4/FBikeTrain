-- Retos 1 contra 1: solo entre amigos aceptados, plazo de 30 días y lectura solo para los dos.
-- Datos sintéticos; termina con rollback.
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
create function pg_temp.as_user(id text) returns void
language sql as $$ select set_config('request.jwt.claim.sub', id, true) $$;
-- La fecha de la salida se cuenta en Madrid, como en la app.
create function pg_temp.today() returns date
language sql stable as $$ select (now() at time zone 'Europe/Madrid')::date $$;
-- Cada reto creado se guarda en un ajuste de la transacción para usarlo en las sentencias dinámicas.

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-000000000021', 'a@example.invalid'),
  ('00000000-0000-0000-0000-000000000022', 'b@example.invalid'),
  ('00000000-0000-0000-0000-000000000023', 'c@example.invalid');
update public.profiles set username = 'ana_reto', display_name = 'Ana Reto', locality = 'Pueblo Uno', area_lat = 41.61, area_lng = 2.29
  where id = '00000000-0000-0000-0000-000000000021';
update public.profiles set username = 'bea_reto', display_name = 'Bea Reto', locality = 'Pueblo Dos', area_lat = 41.70, area_lng = 2.29, show_area = false
  where id = '00000000-0000-0000-0000-000000000022';
update public.profiles set username = 'cris_ajeno', display_name = 'Cris Ajeno'
  where id = '00000000-0000-0000-0000-000000000023';

set local role authenticated;
-- A y B, amigos aceptados. C solo tiene una solicitud pendiente con A.
select pg_temp.as_user('00000000-0000-0000-0000-000000000021');
select public.request_friendship('00000000-0000-0000-0000-000000000022');
select pg_temp.as_user('00000000-0000-0000-0000-000000000022');
select public.accept_friendship((select id from public.friendships
  where requester_id = '00000000-0000-0000-0000-000000000021' and recipient_id = '00000000-0000-0000-0000-000000000022'));
select pg_temp.as_user('00000000-0000-0000-0000-000000000023');
select public.request_friendship('00000000-0000-0000-0000-000000000021');

-- C no puede retar a A: una solicitud pendiente no es una amistad.
select pg_temp.expect_error($$select public.create_challenge('00000000-0000-0000-0000-000000000021', 'Ruta', '[[41.6,2.29],[41.61,2.3]]', 12000, null)$$,
  '42501', 'Solo puedes retar a amigos');

select pg_temp.as_user('00000000-0000-0000-0000-000000000021');
select pg_temp.expect_error($$select public.create_challenge('00000000-0000-0000-0000-000000000021', 'Ruta', '[[41.6,2.29],[41.61,2.3]]', 12000, null)$$,
  '42501', 'Solo puedes retar a amigos');
-- La ruta: de 2 a 2.000 posiciones [lat, lng] o [lat, lng, ele], nombre de 1 a 120 y distancia positiva.
select pg_temp.expect_error($$select public.create_challenge('00000000-0000-0000-0000-000000000022', 'Ruta', '[[41.6,2.29]]', 12000, null)$$, '22023', 'Ruta no válida');
select pg_temp.expect_error($$select public.create_challenge('00000000-0000-0000-0000-000000000022', 'Ruta',
  (select jsonb_agg(jsonb_build_array(41.6, 2.29)) from generate_series(1, 2001)), 12000, null)$$, '22023', 'Ruta no válida');
select pg_temp.expect_error($$select public.create_challenge('00000000-0000-0000-0000-000000000022', 'Ruta', '[[41.6,2.29],[95,2.3]]', 12000, null)$$, '22023', 'Ruta no válida');
select pg_temp.expect_error($$select public.create_challenge('00000000-0000-0000-0000-000000000022', 'Ruta', '[[41.6,2.29],[41.61]]', 12000, null)$$, '22023', 'Ruta no válida');
select pg_temp.expect_error($$select public.create_challenge('00000000-0000-0000-0000-000000000022', 'Ruta', '[[41.6,2.29],["41.61",2.3]]', 12000, null)$$, '22023', 'Ruta no válida');
select pg_temp.expect_error($$select public.create_challenge('00000000-0000-0000-0000-000000000022', 'Ruta', '{"a":1}', 12000, null)$$, '22023', 'Ruta no válida');
select pg_temp.expect_error($$select public.create_challenge('00000000-0000-0000-0000-000000000022', '   ', '[[41.6,2.29],[41.61,2.3]]', 12000, null)$$, '22023', 'Ruta no válida');
select pg_temp.expect_error($$select public.create_challenge('00000000-0000-0000-0000-000000000022', 'Ruta', '[[41.6,2.29],[41.61,2.3]]', 0, null)$$, '22023', 'Ruta no válida');
select pg_temp.check_true((select count(*) = 0 from public.challenges), 'ningún reto inválido guardado');

-- A reta a B con 2.000 puntos, el máximo.
select set_config('test.reto', public.create_challenge('00000000-0000-0000-0000-000000000022', '  Vuelta sintética  ',
  (select jsonb_agg(jsonb_build_array(41.6 + i / 100000.0, 2.29, 100 + i)) from generate_series(1, 2000) i), 42500, 610)::text, true);
select pg_temp.check_true((select route_name = 'Vuelta sintética' and status = 'pending' and jsonb_array_length(route_points) = 2000
  and deadline = created_at + interval '30 days' and challenger_id = auth.uid()
  from public.challenges where id = current_setting('test.reto')::uuid), 'reto creado, pendiente y con plazo de 30 días');

-- Las escrituras solo van por RPC.
select pg_temp.expect_error($$insert into public.challenges(challenger_id, challenged_id, route_name, route_points, distance_m, deadline)
  values (auth.uid(), '00000000-0000-0000-0000-000000000022', 'X', '[[1,1],[2,2]]', 1, now())$$, '42501');
select pg_temp.expect_error($$update public.challenges set status = 'finished'$$, '42501');
select pg_temp.expect_error($$delete from public.challenges$$, '42501');
select pg_temp.expect_error($$insert into public.challenge_results(challenge_id, user_id, activity_date, moving_time_s, distance_m, avg_speed_ms)
  values (current_setting('test.reto')::uuid, auth.uid(), pg_temp.today(), 1, 1, 1)$$, '42501');

-- Sin aceptar, nadie envía resultado; solo el retado responde.
select pg_temp.expect_error($$select public.submit_challenge_result(current_setting('test.reto')::uuid, pg_temp.today(), 5400, 42000, 7.8, 600, 400)$$, '22023', 'Reto cerrado');
select pg_temp.expect_error($$select public.respond_challenge(current_setting('test.reto')::uuid, true)$$, '42501', 'Reto no disponible');

-- C no ve el reto ni puede tocarlo.
select pg_temp.as_user('00000000-0000-0000-0000-000000000023');
select pg_temp.check_true((select count(*) = 0 from public.challenges), 'un tercero no lee retos ajenos');
select pg_temp.check_true((select count(*) = 0 from public.list_challenges()), 'un tercero no lista retos ajenos');
select pg_temp.expect_error($$select public.respond_challenge(current_setting('test.reto')::uuid, true)$$, '42501', 'Reto no disponible');
select pg_temp.expect_error($$select public.submit_challenge_result(current_setting('test.reto')::uuid, pg_temp.today(), 5400, 42000, 7.8, 600, 400)$$, '42501', 'Reto no disponible');

-- B lo ve pendiente, con A como rival (y la zona de A, que es visible) y lo acepta.
select pg_temp.as_user('00000000-0000-0000-0000-000000000022');
select pg_temp.check_true((select (challenge->>'status') = 'pending' and (rival).username = 'ana_reto' and (rival).locality = 'Pueblo Uno'
  and mine is null and theirs is null and (challenge->>'i_am_challenger')::boolean = false
  and (challenge->>'route_name') = 'Vuelta sintética' and (challenge->>'distance_m')::int = 42500 and (challenge->>'elev_gain_m')::int = 610
  and jsonb_array_length(challenge->'route_points') = 2000
  from public.list_challenges()), 'el retado ve el reto pendiente');
select public.respond_challenge(current_setting('test.reto')::uuid, true);
select pg_temp.expect_error($$select public.respond_challenge(current_setting('test.reto')::uuid, false)$$, '22023', 'Reto cerrado');

-- Resultados: la salida no puede ser anterior al reto ni posterior a hoy, y las cifras tienen que ser válidas.
select pg_temp.expect_error($$select public.submit_challenge_result(current_setting('test.reto')::uuid, '2000-01-01', 5400, 42000, 7.8, 600, 400)$$, '22023', 'Salida fuera del plazo');
select pg_temp.expect_error($$select public.submit_challenge_result(current_setting('test.reto')::uuid, pg_temp.today() + 2, 5400, 42000, 7.8, 600, 400)$$, '22023', 'Salida fuera del plazo');
select pg_temp.expect_error($$select public.submit_challenge_result(current_setting('test.reto')::uuid, pg_temp.today(), 0, 42000, 7.8, 600, 400)$$, '22023', 'Cifras no válidas');
select pg_temp.expect_error($$select public.submit_challenge_result(current_setting('test.reto')::uuid, pg_temp.today(), 5400, 42000, -1, 600, 400)$$, '22023', 'Cifras no válidas');
select public.submit_challenge_result(current_setting('test.reto')::uuid, pg_temp.today(), 6000, 42000, 7.0, 600, 360);
-- Cambiar de salida antes de que acabe el reto sustituye la fila propia.
select public.submit_challenge_result(current_setting('test.reto')::uuid, pg_temp.today(), 5600, 42100, 7.5, 605, 389);
select pg_temp.check_true((select count(*) = 1 and min(moving_time_s) = 5600 from public.challenge_results), 'una fila por participante');
select pg_temp.check_true((select (challenge->>'status') = 'accepted' and (mine->>'moving_time_s')::int = 5600 and theirs is null
  from public.list_challenges()), 'con un resultado el reto sigue aceptado');

select pg_temp.as_user('00000000-0000-0000-0000-000000000023');
select pg_temp.check_true((select count(*) = 0 from public.challenge_results), 'un tercero no lee resultados ajenos');

-- A envía el suyo y el reto termina; A ve los dos resultados y a B sin su zona oculta.
select pg_temp.as_user('00000000-0000-0000-0000-000000000021');
select pg_temp.check_true((select count(*) = 1 from public.challenge_results), 'el rival ve el resultado del otro participante');
select public.submit_challenge_result(current_setting('test.reto')::uuid, pg_temp.today(), 5400, 42000, 7.8, 600, 400);
select pg_temp.check_true((select (challenge->>'status') = 'finished' and (challenge->>'i_am_challenger')::boolean
  and (rival).username = 'bea_reto' and (rival).locality is null
  and (mine->>'moving_time_s')::int = 5400 and (theirs->>'moving_time_s')::int = 5600 and (mine->>'vam_mh')::int = 400
  and (mine->>'activity_date') = pg_temp.today()::text and mine ? 'avg_speed_ms' and not mine ? 'user_id'
  from public.list_challenges()), 'reto terminado con los dos resultados');
select pg_temp.expect_error($$select public.submit_challenge_result(current_setting('test.reto')::uuid, pg_temp.today(), 5000, 42000, 8.4, 600, 432)$$, '22023', 'Reto cerrado');

-- Plazo vencido: un reto aceptado no admite resultados y uno pendiente no admite respuesta; los dos salen como caducados.
select set_config('test.vencido', public.create_challenge('00000000-0000-0000-0000-000000000022', 'Vencido', '[[41.6,2.29],[41.61,2.3]]', 9000, null)::text, true);
select set_config('test.sin_respuesta', public.create_challenge('00000000-0000-0000-0000-000000000022', 'Sin respuesta', '[[41.6,2.29],[41.61,2.3]]', 9000, null)::text, true);
select set_config('test.rechazado', public.create_challenge('00000000-0000-0000-0000-000000000022', 'Rechazado', '[[41.6,2.29],[41.61,2.3]]', 9000, null)::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-000000000022');
select public.respond_challenge(current_setting('test.vencido')::uuid, true);
select public.respond_challenge(current_setting('test.rechazado')::uuid, false);
reset role;
update public.challenges set deadline = now() - interval '1 second'
  where id in (current_setting('test.vencido')::uuid, current_setting('test.sin_respuesta')::uuid);
set local role authenticated;
select pg_temp.expect_error($$select public.submit_challenge_result(current_setting('test.vencido')::uuid, pg_temp.today(), 5400, 9000, 7.8, null, null)$$, '22023', 'Reto cerrado');
select pg_temp.expect_error($$select public.respond_challenge(current_setting('test.sin_respuesta')::uuid, true)$$, '22023', 'Reto cerrado');
select pg_temp.expect_error($$select public.submit_challenge_result(current_setting('test.rechazado')::uuid, pg_temp.today(), 5400, 9000, 7.8, null, null)$$, '22023', 'Reto cerrado');
select pg_temp.check_true((select array_agg(challenge->>'status' order by challenge->>'route_name')
  = array['declined', 'expired', 'expired', 'finished'] from public.list_challenges()), 'caducado, rechazado y terminado');

-- Sin sesión, nada.
set local role anon;
select pg_temp.as_user('');
select pg_temp.expect_error('select * from public.list_challenges()', '42501');
select pg_temp.expect_error('select count(*) from public.challenges', '42501');
select pg_temp.expect_error('select count(*) from public.challenge_results', '42501');
select pg_temp.expect_error($$select public.create_challenge('00000000-0000-0000-0000-000000000022', 'Ruta', '[[41.6,2.29],[41.61,2.3]]', 12000, null)$$, '42501');
rollback;
