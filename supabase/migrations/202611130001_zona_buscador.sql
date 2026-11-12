-- Zona aproximada del perfil (pueblo y celda de 2 decimales, unos 1-5 km), búsqueda de personas y
-- listado de amistades. «Casa» exacta nunca llega aquí: el móvil solo envía la localidad y la celda.
begin;

alter table public.profiles
  add column locality text check (locality is null or char_length(locality) between 1 and 80),
  add column area_lat double precision
    check (area_lat is null or (area_lat between -90 and 90 and area_lat = round(area_lat::numeric, 2)::double precision)),
  add column area_lng double precision
    check (area_lng is null or (area_lng between -180 and 180 and area_lng = round(area_lng::numeric, 2)::double precision)),
  add column show_area boolean not null default true,
  add constraint profiles_area_pair check ((area_lat is null) = (area_lng is null));

-- La lectura directa sigue abierta para el nombre, pero no para la zona: esa solo sale por las RPC,
-- que respetan `show_area`. Los privilegios de columna no dependen de la fila, por eso se retira el
-- SELECT de toda la tabla y se concede columna a columna.
revoke select on public.profiles from authenticated;
grant select (id, username, display_name, stats_visibility, show_area, created_at) on public.profiles to authenticated;
-- La política `profiles_edit` ya limita la escritura al dueño.
grant update (locality, area_lat, area_lng, show_area) on public.profiles to authenticated;

create type public.profile_card as (
  id uuid, username text, display_name text, locality text, distance_km double precision
);

-- La zona propia, para Ajustes y para saber si hay que pedirla tras el login.
create function public.my_area() returns table (locality text, show_area boolean)
language sql stable security definer set search_path = '' as $$
  select p.locality, p.show_area from public.profiles p where p.id = auth.uid();
$$;

create function public.search_profiles(q text) returns setof public.profile_card
language plpgsql stable security definer set search_path = '' as $$
declare
  term text := btrim(coalesce(q, ''));
  pattern text;
begin
  if auth.uid() is null then raise exception 'Sesión necesaria' using errcode = '42501'; end if;
  if char_length(term) < 3 then raise exception 'Escribe al menos 3 letras' using errcode = '22023'; end if;
  if char_length(term) > 60 then raise exception 'Búsqueda demasiado larga' using errcode = '22023'; end if;
  -- %, _ y \ cuentan como letras, no como comodines.
  pattern := '%' || replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select p.id, p.username, p.display_name, case when p.show_area then p.locality end, null::double precision
    from public.profiles p
    where p.id <> auth.uid()
      and (p.display_name ilike pattern escape '\'
        -- El usuario automático (el id en hexadecimal) no es un nombre: buscar «cafe» no debe devolverlo.
        or (p.username <> replace(p.id::text, '-', '') and p.username ilike pattern escape '\'))
    order by p.username
    limit 20;
end;
$$;

create function public.search_profiles_near(radius_km integer) returns setof public.profile_card
language plpgsql stable security definer set search_path = '' as $$
declare
  me_lat double precision;
  me_lng double precision;
begin
  if auth.uid() is null then raise exception 'Sesión necesaria' using errcode = '42501'; end if;
  if radius_km is null or radius_km not in (25, 50) then raise exception 'Radio no válido' using errcode = '22023'; end if;
  select p.area_lat, p.area_lng into me_lat, me_lng from public.profiles p where p.id = auth.uid();
  if me_lat is null then raise exception 'Sin zona configurada' using errcode = '22023'; end if;
  return query
    select s.id, s.username, s.display_name, s.locality, round(s.km)::double precision
    from (
      select p.id, p.username, p.display_name, p.locality,
        -- Haversine sobre las celdas; `least` evita un asin(>1) por redondeo.
        2 * 6371 * asin(least(1, sqrt(
          power(sin(radians(p.area_lat - me_lat) / 2), 2)
          + cos(radians(me_lat)) * cos(radians(p.area_lat)) * power(sin(radians(p.area_lng - me_lng) / 2), 2)))) as km
      from public.profiles p
      where p.id <> auth.uid() and p.show_area and p.area_lat is not null
    ) s
    where s.km <= radius_km
    order by s.km, s.username
    limit 50;
end;
$$;

create function public.list_friends()
  returns table (friendship_id uuid, status text, direction text, profile public.profile_card)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sesión necesaria' using errcode = '42501'; end if;
  return query
    select f.id, f.status, case when f.requester_id = auth.uid() then 'sent' else 'received' end,
      row(p.id, p.username, p.display_name, case when p.show_area then p.locality end, null::double precision)::public.profile_card
    from public.friendships f
    join public.profiles p
      on p.id = case when f.requester_id = auth.uid() then f.recipient_id else f.requester_id end
    where auth.uid() in (f.requester_id, f.recipient_id)
    order by f.status, p.username;
end;
$$;

revoke all on function public.my_area(), public.search_profiles(text), public.search_profiles_near(integer),
  public.list_friends() from public, anon, authenticated;
grant execute on function public.my_area(), public.search_profiles(text), public.search_profiles_near(integer),
  public.list_friends() to authenticated;
commit;
