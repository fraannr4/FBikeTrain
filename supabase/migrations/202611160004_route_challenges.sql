-- Reto de ruta: un reto de la comunidad (kind 'route') sobre un trazado concreto. Gana el menor tiempo en
-- movimiento de una salida que recorra al menos el 90 % de la ruta, en su sentido, dentro del plazo.
-- La geometría (recortada en el cliente al inicio y al final, como mucho 2.000 puntos) solo la leen los
-- participantes. De las salidas solo llega el resultado: tiempo, cobertura, momento y el id local de la salida.
-- El cálculo es del cliente; el servidor valida rangos (tiempo >= distancia a 60 km/h, momento desde la
-- aceptación y antes del cierre) y guarda el mejor resultado de cada participante. Basado en la confianza.
begin;

alter table public.community_challenges drop constraint community_challenges_kind_check;
alter table public.community_challenges add constraint community_challenges_kind_check
  check(kind in ('distance','elevation','rides','segment','speed','route'));

-- [lat, lng] o [lat, lng, ele], números en rango; 2 a 2.000 puntos. `case` evita las funciones de array sobre otra cosa.
create function public.community_route_points_valid(points jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(case when jsonb_typeof(points) = 'array' then
    jsonb_array_length(points) between 2 and 2000
    and not jsonb_path_exists(points, 'strict $[*] ? (@.type() != "array" || @.size() < 2 || @.size() > 3)')
    and not jsonb_path_exists(points, 'strict $[*][*] ? (@.type() != "number")')
    and not jsonb_path_exists(points, 'strict $[*] ? (@[0] < -90 || @[0] > 90 || @[1] < -180 || @[1] > 180)')
    else false end, false)
$$;

create table public.community_route_challenges (
  challenge_id uuid primary key references public.community_challenges(id) on delete cascade,
  points jsonb not null check(public.community_route_points_valid(points)),
  distance_m integer not null check(distance_m between 1000 and 1000000)
);
create table public.community_route_results (
  challenge_id uuid not null, user_id uuid not null,
  moving_time_s integer not null check(moving_time_s between 1 and 2592000),
  coverage real not null check(coverage >= 0.9::real and coverage <= 1),
  ridden_at timestamptz not null,
  activity_ref text not null check(activity_ref ~ '^[A-Za-z0-9._:-]{1,80}$'),
  updated_at timestamptz not null default now(), primary key(challenge_id,user_id),
  foreign key(challenge_id,user_id) references public.community_challenge_members(challenge_id,user_id) on delete cascade
);
alter table public.community_route_challenges enable row level security;
alter table public.community_route_results enable row level security;
revoke all on public.community_route_challenges, public.community_route_results from anon, authenticated;
grant select on public.community_route_challenges, public.community_route_results to authenticated;
create policy community_route_read on public.community_route_challenges for select to authenticated using(public.community_challenge_visible(challenge_id));
create policy community_route_results_read on public.community_route_results for select to authenticated using(public.community_challenge_visible(challenge_id));

create function public.create_route_challenge(title text,duration_days integer,invited_ids uuid[],route_points jsonb,distance_m integer) returns uuid
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare new_id uuid; n integer;
begin
  perform public.community_require_registered();
  perform pg_catalog.pg_advisory_xact_lock(611160003);
  n := cardinality(invited_ids);
  if title is null or char_length(btrim(title)) not between 1 and 120
    or duration_days is null or duration_days not between 1 and 30 or n is null or n not between 1 and 19
    or exists(select 1 from unnest(invited_ids) u where u is null or u = auth.uid() or not public.community_visible(u))
    or (select count(distinct u) from unnest(invited_ids) u) <> n
    or not public.community_route_points_valid(route_points)
    or distance_m is null or distance_m not between 1000 and 1000000 then raise exception 'Reto no válido' using errcode = '22023'; end if;
  if exists(select 1 from public.community_blocks b where b.blocker_id = any(invited_ids) and b.blocked_id = any(invited_ids)) then
    raise exception 'Usuario no disponible' using errcode = '42501'; end if;
  perform public.community_consume_quota(n);
  if exists(select 1 from unnest(invited_ids) u where not public.community_visible(u)) then raise exception 'Usuario no disponible' using errcode = '42501'; end if;
  insert into public.community_challenges(creator_id,title,kind,deadline)
    values(auth.uid(),btrim(title),'route',now() + make_interval(days => duration_days)) returning id into new_id;
  insert into public.community_route_challenges(challenge_id,points,distance_m) values(new_id,route_points,distance_m);
  insert into public.community_challenge_members(challenge_id,user_id,status,accepted_at) values(new_id,auth.uid(),'accepted',now());
  insert into public.community_challenge_members(challenge_id,user_id,status) select new_id,u,'pending' from unnest(invited_ids) u;
  insert into public.community_notifications(user_id,kind,challenge_id,actor_id) select u,'invitation',new_id,auth.uid() from unnest(invited_ids) u;
  return new_id;
end $$;

create function public.submit_route_result(challenge_id uuid,moving_time_s integer,coverage real,ridden_at timestamptz,activity_ref text) returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare c public.community_challenges; route public.community_route_challenges; accepted_from timestamptz; best integer;
begin
  perform public.community_require_registered();
  perform pg_catalog.pg_advisory_xact_lock(611160003);
  select * into c from public.community_challenges where id = submit_route_result.challenge_id for update;
  if not found or not public.community_challenge_visible(c.id) then raise exception 'Reto no disponible' using errcode = '42501'; end if;
  select m.accepted_at into accepted_from from public.community_challenge_members m
    where m.challenge_id = c.id and m.user_id = auth.uid() and m.status = 'accepted';
  if not found then raise exception 'Reto no disponible' using errcode = '42501'; end if;
  if c.kind <> 'route' then raise exception 'Reto no válido' using errcode = '22023'; end if;
  if c.deadline <= now() then raise exception 'Reto cerrado' using errcode = '22023'; end if;
  select * into route from public.community_route_challenges r where r.challenge_id = c.id;
  -- Nadie recorre el tramo a más de 60 km/h de media: tiempo >= distancia / (60 / 3,6).
  if moving_time_s is null or moving_time_s > 2592000 or moving_time_s::numeric * 60 < route.distance_m::numeric * 3.6
    or coverage is null or coverage < 0.9::real or coverage > 1
    or ridden_at is null or ridden_at < accepted_from or ridden_at > now() or ridden_at >= c.deadline
    or activity_ref is null or activity_ref !~ '^[A-Za-z0-9._:-]{1,80}$' then
    raise exception 'Cifras no válidas' using errcode = '22023'; end if;
  -- Un resultado por participante: el mejor tiempo.
  insert into public.community_route_results(challenge_id,user_id,moving_time_s,coverage,ridden_at,activity_ref)
    values(c.id,auth.uid(),moving_time_s,coverage,ridden_at,activity_ref)
    on conflict on constraint community_route_results_pkey do update set moving_time_s = excluded.moving_time_s,
      coverage = excluded.coverage, ridden_at = excluded.ridden_at, activity_ref = excluded.activity_ref, updated_at = now()
      where excluded.moving_time_s < community_route_results.moving_time_s;
  select r.moving_time_s into best from public.community_route_results r where r.challenge_id = c.id and r.user_id = auth.uid();
  insert into public.community_challenge_scores(challenge_id,user_id,score) values(c.id,auth.uid(),best)
    on conflict on constraint community_challenge_scores_pkey do update set score = excluded.score, updated_at = now()
      where community_challenge_scores.score is distinct from excluded.score;
end $$;

-- El marcador genérico no admite rutas: su resultado pasa por submit_route_result y sus comprobaciones.
create or replace function public.submit_community_score(challenge_id uuid,score double precision) returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare c public.community_challenges; maximum double precision; accepted_from timestamptz; elapsed_days integer;
begin
  perform public.community_require_registered();
  perform pg_catalog.pg_advisory_xact_lock(611160003);
  select * into c from public.community_challenges where id = challenge_id for update;
  if not found or not public.community_challenge_visible(challenge_id) then
    raise exception 'Reto no disponible' using errcode = '42501'; end if;
  select m.accepted_at into accepted_from from public.community_challenge_members m
    where m.challenge_id = c.id and m.user_id = auth.uid() and m.status = 'accepted';
  if not found then raise exception 'Reto no disponible' using errcode = '42501'; end if;
  if c.deadline <= now() then raise exception 'Reto cerrado' using errcode = '22023'; end if;
  if c.kind = 'route' then raise exception 'Cifras no válidas' using errcode = '22023'; end if;
  -- Días de 24 h iniciados desde aceptar: el primer día dispone de una cuota completa,
  -- sin depender de medianoche ni del tiempo que el reto llevaba abierto antes de aceptar.
  elapsed_days := least(30,greatest(1,ceil(extract(epoch from (now() - accepted_from)) / 86400.0)))::integer;
  maximum := case c.kind when 'distance' then 400000 * elapsed_days when 'elevation' then 6000 * elapsed_days
    when 'rides' then 4 * elapsed_days when 'speed' then 60.0 / 3.6 else 2592000 end;
  if score is null or not(score >= 0 and score <= maximum) or (c.kind = 'rides' and score <> trunc(score)) then
    raise exception 'Cifras no válidas' using errcode = '22023'; end if;
  insert into public.community_challenge_scores(challenge_id,user_id,score) values(c.id,auth.uid(),score)
    on conflict(challenge_id,user_id) do update set score = excluded.score,updated_at = now();
end $$;

-- Igual que antes, más la distancia de la ruta y el menor tiempo como ganador también en las rutas.
create or replace function public.community_challenge_json(challenge_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',c.id,'title',c.title,'kind',c.kind,'created_at',c.created_at,'deadline',c.deadline,
    'creator_id',c.creator_id,'target_value',c.target_value,'distance_m',c.distance_m,'segment_key',c.segment_key,
    'route_distance_m',(select r.distance_m from public.community_route_challenges r where r.challenge_id = c.id),
    'status',case when c.deadline <= now() then 'finished' else 'active' end,
    'members',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,
      'status',m.status,'accepted_at',m.accepted_at,'score',case when m.status = 'accepted' then s.score end,'updated_at',s.updated_at) order by m.accepted_at nulls last,p.id),'[]'::jsonb)
      from public.community_challenge_members m join public.profiles p on p.id = m.user_id
      left join public.community_challenge_scores s on s.challenge_id = m.challenge_id and s.user_id = m.user_id where m.challenge_id = c.id),
    'winner_ids',case when c.deadline > now() or (select count(*) from public.community_challenge_members a where a.challenge_id=c.id and a.status='accepted') < 2 then '[]'::jsonb else
      (select coalesce(jsonb_agg(s.user_id order by s.user_id),'[]'::jsonb) from public.community_challenge_scores s
        join public.community_challenge_members m on m.challenge_id = s.challenge_id and m.user_id = s.user_id
        where s.challenge_id = c.id and m.status = 'accepted' and s.score > 0 and s.score =
          (select case when c.kind in ('segment','route') then min(s2.score) else max(s2.score) end
            from public.community_challenge_scores s2 join public.community_challenge_members m2 on m2.challenge_id = s2.challenge_id and m2.user_id = s2.user_id
            where s2.challenge_id = c.id and m2.status = 'accepted' and s2.score > 0)) end)
  from public.community_challenges c where c.id = challenge_id and public.community_challenge_visible(c.id)
$$;

revoke all on function public.community_route_points_valid(jsonb) from public, anon, authenticated;
revoke all on function public.create_route_challenge(text,integer,uuid[],jsonb,integer) from public, anon, authenticated;
revoke all on function public.submit_route_result(uuid,integer,real,timestamptz,text) from public, anon, authenticated;
grant execute on function public.create_route_challenge(text,integer,uuid[],jsonb,integer) to authenticated;
grant execute on function public.submit_route_result(uuid,integer,real,timestamptz,text) to authenticated;
commit;
