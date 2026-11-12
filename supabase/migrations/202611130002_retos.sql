-- Retos 1 contra 1 entre amigos aceptados, con una ruta de la biblioteca y un plazo de 30 días.
-- Al servidor llegan los puntos de la ruta del reto (2 a 2.000) y las cifras de la salida elegida a
-- mano; nunca el track de la salida. Solo los dos participantes leen el reto y sus resultados.
begin;

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  challenger_id uuid not null references public.profiles(id) on delete cascade,
  challenged_id uuid not null references public.profiles(id) on delete cascade,
  route_name text not null check (char_length(route_name) between 1 and 120),
  -- [lat, lng] o [lat, lng, ele], números y en rango. `case` evita aplicar las funciones de array a otra cosa.
  route_points jsonb not null check (case when jsonb_typeof(route_points) = 'array' then
    jsonb_array_length(route_points) between 2 and 2000
    and not jsonb_path_exists(route_points, 'strict $[*] ? (@.type() != "array" || @.size() < 2 || @.size() > 3)')
    and not jsonb_path_exists(route_points, 'strict $[*][*] ? (@.type() != "number")')
    and not jsonb_path_exists(route_points, 'strict $[*] ? (@[0] < -90 || @[0] > 90 || @[1] < -180 || @[1] > 180)')
    else false end),
  distance_m integer not null check (distance_m > 0),
  elev_gain_m integer check (elev_gain_m is null or elev_gain_m >= 0),
  -- `expired` no se escribe: `list_challenges` lo calcula a partir del plazo.
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'finished', 'expired')),
  deadline timestamptz not null,
  created_at timestamptz not null default now(),
  check (challenger_id <> challenged_id)
);
create index challenges_challenger on public.challenges(challenger_id);
create index challenges_challenged on public.challenges(challenged_id);

create table public.challenge_results (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_date date not null,
  moving_time_s integer not null check (moving_time_s > 0),
  distance_m integer not null check (distance_m > 0),
  avg_speed_ms real not null check (avg_speed_ms > 0),
  elev_gain_m integer check (elev_gain_m is null or elev_gain_m >= 0),
  vam_mh integer check (vam_mh is null or vam_mh >= 0),
  submitted_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

alter table public.challenges enable row level security;
alter table public.challenge_results enable row level security;
revoke all on public.challenges, public.challenge_results from anon, authenticated;
grant select on public.challenges, public.challenge_results to authenticated;
create policy challenges_participants on public.challenges for select to authenticated
  using ((select auth.uid()) in (challenger_id, challenged_id));
create policy challenge_results_participants on public.challenge_results for select to authenticated
  using (exists (select 1 from public.challenges c
    where c.id = challenge_results.challenge_id and (select auth.uid()) in (c.challenger_id, c.challenged_id)));

-- Los parámetros llevan el nombre que usa el cliente; dentro se citan con el nombre de la función.
create function public.create_challenge(challenged_id uuid, route_name text, route_points jsonb, distance_m integer, elev_gain_m integer)
  returns uuid
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sesión necesaria' using errcode = '42501'; end if;
  if not exists (select 1 from public.friendships f
      where f.status = 'accepted'
        and least(f.requester_id, f.recipient_id) = least(auth.uid(), create_challenge.challenged_id)
        and greatest(f.requester_id, f.recipient_id) = greatest(auth.uid(), create_challenge.challenged_id)) then
    raise exception 'Solo puedes retar a amigos' using errcode = '42501';
  end if;
  begin
    insert into public.challenges(challenger_id, challenged_id, route_name, route_points, distance_m, elev_gain_m, deadline)
      values (auth.uid(), create_challenge.challenged_id, btrim(create_challenge.route_name), create_challenge.route_points,
        create_challenge.distance_m, create_challenge.elev_gain_m, now() + interval '30 days')
      returning id into new_id;
  exception when check_violation or not_null_violation then
    raise exception 'Ruta no válida' using errcode = '22023';
  end;
  return new_id;
end;
$$;

create function public.respond_challenge(challenge_id uuid, accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  c public.challenges;
begin
  select * into c from public.challenges
    where id = respond_challenge.challenge_id and challenged_id = auth.uid() for update;
  if not found then raise exception 'Reto no disponible' using errcode = '42501'; end if;
  if c.status <> 'pending' or now() > c.deadline or respond_challenge.accept is null then
    raise exception 'Reto cerrado' using errcode = '22023';
  end if;
  update public.challenges set status = case when respond_challenge.accept then 'accepted' else 'declined' end
    where id = c.id;
end;
$$;

create function public.submit_challenge_result(challenge_id uuid, activity_date date, moving_time_s integer,
  distance_m integer, avg_speed_ms real, elev_gain_m integer, vam_mh integer) returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  c public.challenges;
begin
  select * into c from public.challenges
    where id = submit_challenge_result.challenge_id and auth.uid() in (challenger_id, challenged_id) for update;
  if not found then raise exception 'Reto no disponible' using errcode = '42501'; end if;
  if c.status <> 'accepted' or now() > c.deadline then raise exception 'Reto cerrado' using errcode = '22023'; end if;
  -- La salida cuenta desde el día del reto hasta hoy, en Madrid como el resto de la app.
  if submit_challenge_result.activity_date is null
    or submit_challenge_result.activity_date < (c.created_at at time zone 'Europe/Madrid')::date
    or submit_challenge_result.activity_date > (now() at time zone 'Europe/Madrid')::date then
    raise exception 'Salida fuera del plazo' using errcode = '22023';
  end if;
  begin
    insert into public.challenge_results(challenge_id, user_id, activity_date, moving_time_s, distance_m, avg_speed_ms, elev_gain_m, vam_mh)
      values (c.id, auth.uid(), submit_challenge_result.activity_date, submit_challenge_result.moving_time_s,
        submit_challenge_result.distance_m, submit_challenge_result.avg_speed_ms, submit_challenge_result.elev_gain_m,
        submit_challenge_result.vam_mh)
      on conflict on constraint challenge_results_pkey do update set
        activity_date = excluded.activity_date, moving_time_s = excluded.moving_time_s, distance_m = excluded.distance_m,
        avg_speed_ms = excluded.avg_speed_ms, elev_gain_m = excluded.elev_gain_m, vam_mh = excluded.vam_mh, submitted_at = now();
  exception when check_violation or not_null_violation then
    raise exception 'Cifras no válidas' using errcode = '22023';
  end;
  if (select count(*) from public.challenge_results r where r.challenge_id = c.id) = 2 then
    update public.challenges set status = 'finished' where id = c.id;
  end if;
end;
$$;

create function public.list_challenges()
  returns table (challenge jsonb, rival public.profile_card, mine jsonb, theirs jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sesión necesaria' using errcode = '42501'; end if;
  return query
    select
      jsonb_build_object(
        'id', c.id,
        'status', case when c.status in ('pending', 'accepted') and c.deadline < now() then 'expired' else c.status end,
        'route_name', c.route_name, 'route_points', c.route_points, 'distance_m', c.distance_m, 'elev_gain_m', c.elev_gain_m,
        'deadline', c.deadline, 'created_at', c.created_at, 'i_am_challenger', c.challenger_id = auth.uid()),
      row(p.id, p.username, p.display_name, case when p.show_area then p.locality end, null::double precision)::public.profile_card,
      (select to_jsonb(r) - 'challenge_id' - 'user_id' from public.challenge_results r where r.challenge_id = c.id and r.user_id = auth.uid()),
      (select to_jsonb(r) - 'challenge_id' - 'user_id' from public.challenge_results r where r.challenge_id = c.id and r.user_id = p.id)
    from public.challenges c
    join public.profiles p on p.id = case when c.challenger_id = auth.uid() then c.challenged_id else c.challenger_id end
    where auth.uid() in (c.challenger_id, c.challenged_id)
    order by c.created_at desc
    limit 100;
end;
$$;

revoke all on function public.create_challenge(uuid, text, jsonb, integer, integer), public.respond_challenge(uuid, boolean),
  public.submit_challenge_result(uuid, date, integer, integer, real, integer, integer), public.list_challenges()
  from public, anon, authenticated;
grant execute on function public.create_challenge(uuid, text, jsonb, integer, integer), public.respond_challenge(uuid, boolean),
  public.submit_challenge_result(uuid, date, integer, integer, real, integer, integer), public.list_challenges()
  to authenticated;
commit;
