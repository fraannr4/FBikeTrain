-- Publicaciones y fotos sintéticas; nada se conserva.
begin;
create function pg_temp.check_true(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %', message; end if;
end $$;
create function pg_temp.expect_error(statement text, expected_state text) returns void
language plpgsql as $$ begin
  begin execute statement;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise;
  end;
  raise exception 'FAIL: no se rechazó %', statement;
end $$;
create function pg_temp.as_user(id text) returns void
language sql as $$ select set_config('request.jwt.claim.sub', id, true) $$;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-000000000071', 'journal-a@example.invalid'),
  ('00000000-0000-0000-0000-000000000072', 'journal-b@example.invalid'),
  ('00000000-0000-0000-0000-000000000073', 'journal-c@example.invalid');
update public.profiles set username = 'ana_cuaderno', display_name = 'Ana Cuaderno' where id = '00000000-0000-0000-0000-000000000071';
select pg_temp.check_true((select not public and file_size_limit = 524288 and allowed_mime_types = array['image/webp']
  from storage.buckets where id = 'fbiketrain-avatars'), 'bucket privado y limitado a webp pequeño');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000071');
update public.profiles set bio = 'Carreteras pequeñas y puertos grandes.', riding_style = 'subir', avatar_version = 123 where id = auth.uid();
update public.profiles set bio = 'Intrusión' where id = '00000000-0000-0000-0000-000000000072';
select pg_temp.check_true((select bio = '' from public.profiles where id = '00000000-0000-0000-0000-000000000072'), 'bio solo editable por dueño');
select pg_temp.expect_error($$update public.profiles set bio = repeat('x',281) where id=auth.uid()$$, '23514');
select pg_temp.expect_error($$update public.profiles set riding_style = 'inexistente' where id=auth.uid()$$, '23514');
select pg_temp.expect_error($$update public.profiles set journal_window_count = 0 where id=auth.uid()$$, '42501');
select pg_temp.expect_error($$select journal_window_count from public.profiles$$, '42501');

-- Un único nombre de objeto por persona: no se pueden subir ficheros arbitrarios.
insert into storage.objects(bucket_id,name) values ('fbiketrain-avatars', auth.uid()::text || '/avatar.webp');
select pg_temp.expect_error($$insert into storage.objects(bucket_id,name) values ('fbiketrain-avatars', auth.uid()::text || '/extra.webp')$$, '42501');
select pg_temp.expect_error($$insert into storage.objects(bucket_id,name) values ('fbiketrain-avatars', '00000000-0000-0000-0000-000000000072/avatar.webp')$$, '42501');
select pg_temp.expect_error($$update storage.objects set name='00000000-0000-0000-0000-000000000072/avatar.webp' where bucket_id='fbiketrain-avatars'$$, '42501');

select set_config('test.journal.private', public.create_profile_post('  Mi primera nota  ', 'friends', null)::text, true);
select set_config('test.journal.public', public.create_profile_post('Una carretera tranquila.', 'everyone', null)::text, true);
select set_config('test.journal.ride', public.create_profile_post('', 'everyone',
  jsonb_build_object('activity_date', (now() at time zone 'Europe/Madrid')::date, 'distance_m', 42000, 'moving_time_s', 5400, 'elev_gain_m', 650))::text, true);
select pg_temp.check_true((select body = 'Mi primera nota' and author_id = auth.uid() and created_at = now()
  from public.profile_posts where id = current_setting('test.journal.private')::uuid), 'servidor fija autor y fecha y recorta texto');
select pg_temp.expect_error($$insert into public.profile_posts(author_id,body) values (auth.uid(),'fraude')$$, '42501');
select pg_temp.expect_error($$update public.profile_posts set author_id='00000000-0000-0000-0000-000000000072'$$, '42501');
select pg_temp.expect_error($$update public.profile_posts set created_at=now()+interval '1 day'$$, '42501');
select pg_temp.expect_error($$delete from public.profile_posts$$, '42501');
select pg_temp.expect_error($$select public.create_profile_post('', 'friends', null)$$, '22023');
select pg_temp.expect_error($$select public.create_profile_post(repeat('x',1001), 'friends', null)$$, '22023');
select pg_temp.expect_error($$select public.create_profile_post('x', 'invalid', null)$$, '22023');
select pg_temp.expect_error($$select public.create_profile_post('x', 'friends', '{"activity_date":"2020-01-01","distance_m":1,"moving_time_s":1,"elev_gain_m":null,"lat":41.6}')$$, '22023');
select pg_temp.expect_error($$select public.create_profile_post('x', 'friends', '{"activity_date":"2020-01-01","distance_m":1,"moving_time_s":1}')$$, '22023');
select pg_temp.expect_error($$select public.create_profile_post('x', 'friends', '{"activity_date":"2020-02-31","distance_m":1,"moving_time_s":1,"elev_gain_m":null}')$$, '22023');
select pg_temp.expect_error($$select public.create_profile_post('x', 'friends', '{"activity_date":"2999-01-01","distance_m":1,"moving_time_s":1,"elev_gain_m":null}')$$, '22023');
select pg_temp.expect_error($$select public.create_profile_post('x', 'friends', '{"activity_date":"2020-01-01","distance_m":-1,"moving_time_s":1,"elev_gain_m":null}')$$, '22023');
select pg_temp.expect_error($$select public.create_profile_post('x', 'friends', '{"activity_date":"2020-01-01","distance_m":1,"moving_time_s":"one","elev_gain_m":null}')$$, '22023');
select pg_temp.expect_error($$select public.create_profile_post('x', 'friends', 'null')$$, '22023');
select pg_temp.expect_error($$select public.list_profile_posts(null,now(),null)$$, '22023');

-- C tiene solicitud pendiente: solo ve publicaciones abiertas al visitar el perfil, no en feed de amigos.
select pg_temp.as_user('00000000-0000-0000-0000-000000000073');
select public.request_friendship('00000000-0000-0000-0000-000000000071');
select pg_temp.check_true((select count(*) = 2 from public.profile_posts), 'tercero solo ve publicaciones públicas');
select pg_temp.check_true((select count(*) = 2 from public.list_profile_posts('00000000-0000-0000-0000-000000000071')), 'perfil respeta privacidad');
select pg_temp.check_true((select count(*) = 0 from public.list_profile_posts()), 'feed no incluye solicitudes pendientes ni desconocidos');
select pg_temp.expect_error($$select public.delete_profile_post(current_setting('test.journal.private')::uuid)$$, '42501');
select pg_temp.check_true((select count(*) = 1 from storage.objects where bucket_id='fbiketrain-avatars'), 'cuentas pueden leer foto pública autenticada');
delete from storage.objects where bucket_id='fbiketrain-avatars';
select pg_temp.check_true((select count(*) = 1 from storage.objects where bucket_id='fbiketrain-avatars'), 'otra cuenta no borra foto');

-- A y B aceptan amistad. La lectura funciona en ambos sentidos.
select pg_temp.as_user('00000000-0000-0000-0000-000000000071');
select public.request_friendship('00000000-0000-0000-0000-000000000072');
select pg_temp.as_user('00000000-0000-0000-0000-000000000072');
select public.accept_friendship((select id from public.friendships where requester_id='00000000-0000-0000-0000-000000000071' and recipient_id=auth.uid()));
select pg_temp.check_true((select count(*) = 3 from public.list_profile_posts()), 'amiga ve cuaderno completo en su feed');
select pg_temp.check_true((select author->>'username' = 'ana_cuaderno' and author->>'riding_style' = 'subir'
  and not (author ?| array['email','area_lat','area_lng','locality']) from public.list_profile_posts() limit 1), 'autor del feed solo tiene identidad permitida');
select public.create_profile_post('La nota de Bea', 'friends', null);
select pg_temp.as_user('00000000-0000-0000-0000-000000000071');
select pg_temp.check_true((select count(*) = 4 from public.list_profile_posts()), 'amistad se lee en ambos sentidos y conserva propios');
update public.profiles set stats_visibility='friends' where id=auth.uid();
select pg_temp.as_user('00000000-0000-0000-0000-000000000073');
select pg_temp.check_true((select count(*) = 1 from public.profile_posts), 'cambiar privacidad oculta cifras también por API directa');
select pg_temp.as_user('00000000-0000-0000-0000-000000000072');
select pg_temp.check_true((select count(*) = 4 from public.list_profile_posts()), 'amiga sigue viendo cifras privadas');
select public.remove_friendship((select id from public.friendships where requester_id='00000000-0000-0000-0000-000000000071' and recipient_id=auth.uid()));
select pg_temp.check_true((select count(*) = 1 from public.list_profile_posts('00000000-0000-0000-0000-000000000071')), 'retirar amistad revoca lectura del cuaderno privado');
select pg_temp.check_true((select count(*) = 1 from public.list_profile_posts()), 'feed tras retirar amistad solo conserva propios');

-- Mismas fechas: el UUID desempata y el cursor evita duplicar y omitir publicaciones.
reset role;
insert into public.profile_posts(id,author_id,body,created_at) select
  ('00000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
  '00000000-0000-0000-0000-000000000073', 'Página sintética', timestamptz '2020-01-01T00:00:00Z'
  from generate_series(101,125) i;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000073');
select pg_temp.check_true((select count(*) = 20 from public.list_profile_posts()), 'tamaño máximo de página');
select pg_temp.check_true((select min(id::text) = '00000000-0000-0000-0000-000000000106' from public.list_profile_posts()), 'orden de desempate por id');
select pg_temp.check_true((select count(*) = 5 from public.list_profile_posts(null,'2020-01-01T00:00:00Z','00000000-0000-0000-0000-000000000106')), 'cursor estricto no repite filas');

-- Cuota real por ventana, incluso si se borran las publicaciones recién creadas.
do $$ declare n integer; p uuid; begin
  for n in 1..20 loop
    p := public.create_profile_post('Cuota sintética', 'friends', null);
    perform public.delete_profile_post(p);
  end loop;
end $$;
select pg_temp.expect_error($$select public.create_profile_post('Número 21', 'friends', null)$$, 'P0429');
reset role;
update public.profiles set journal_window_start=now()-interval '25 hours' where id='00000000-0000-0000-0000-000000000073';
set local role authenticated;
select public.create_profile_post('Ventana nueva', 'friends', null);

-- El dueño puede retirar su foto y una publicación.
select pg_temp.as_user('00000000-0000-0000-0000-000000000071');
select public.delete_profile_post(current_setting('test.journal.private')::uuid);
select pg_temp.check_true((select count(*)=0 from public.profile_posts where id=current_setting('test.journal.private')::uuid), 'dueño elimina publicación');
delete from storage.objects where bucket_id='fbiketrain-avatars';
select pg_temp.check_true((select count(*)=0 from storage.objects where bucket_id='fbiketrain-avatars'), 'dueño elimina avatar');
insert into storage.objects(bucket_id,name) values ('fbiketrain-avatars', auth.uid()::text || '/avatar.webp');

set local role anon;
select pg_temp.as_user('');
select pg_temp.expect_error($$select * from public.profile_posts$$, '42501');
select pg_temp.expect_error($$select bio from public.profiles$$, '42501');
select pg_temp.expect_error($$select public.list_profile_posts()$$, '42501');
select pg_temp.expect_error($$select public.create_profile_post('Anónimo','everyone',null)$$, '42501');
select pg_temp.expect_error($$insert into storage.objects(bucket_id,name) values ('fbiketrain-avatars','anonymous/avatar.webp')$$, '42501');
select pg_temp.check_true((select count(*)=0 from storage.objects where bucket_id='fbiketrain-avatars'), 'anónimo no puede leer avatares');
rollback;
