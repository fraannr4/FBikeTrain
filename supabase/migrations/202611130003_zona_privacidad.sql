-- Privacidad de la zona. Con la distancia al km y cambios de zona ilimitados, un atacante podía mover
-- su zona varias veces y trilaterar la celda de otro. Ahora la distancia sale solo por bandas
-- (5, 10, 25 o 50 km) y la celda se puede cambiar como mucho 3 veces en 24 h.
begin;

-- Columnas de control: fuera del grant de update y del de select, así que el usuario no las toca.
alter table public.profiles
  add column area_changes smallint not null default 0,
  add column area_window_start timestamptz;

create function public.limit_area_changes() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Solo cuentan las coordenadas; locality y show_area se cambian sin límite.
  if (new.area_lat, new.area_lng) is not distinct from (old.area_lat, old.area_lng) then return new; end if;
  if old.area_window_start is null or old.area_window_start <= now() - interval '24 hours' then
    new.area_window_start := now();
    new.area_changes := 1;
  elsif old.area_changes >= 3 then
    raise exception 'Has cambiado tu zona demasiadas veces hoy. Prueba mañana.' using errcode = 'ZN429';
  else
    new.area_changes := old.area_changes + 1;
  end if;
  return new;
end;
$$;
revoke all on function public.limit_area_changes() from public, anon, authenticated;
create trigger profiles_limit_area_changes before update of area_lat, area_lng on public.profiles
  for each row execute function public.limit_area_changes();

-- Misma firma y tipo; `distance_km` pasa a ser el límite superior de la banda.
create or replace function public.search_profiles_near(radius_km integer) returns setof public.profile_card
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
    select s.id, s.username, s.display_name, s.locality,
      (case when s.km <= 5 then 5 when s.km <= 10 then 10 when s.km <= 25 then 25 else 50 end)::double precision as band
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
    order by band, s.username
    limit 50;
end;
$$;
commit;
