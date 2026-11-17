-- «Me gusta» de retos de la comunidad y de salidas compartidas (publicaciones del cuaderno).
-- Aditiva: solo crea una tabla y dos funciones nuevas; no toca nada existente.
begin;

create table public.likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  object_type text not null check (object_type in ('challenge', 'post')),
  object_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, object_type, object_id)
);
-- Recuento por objeto sin recorrer la tabla entera.
create index likes_object on public.likes(object_type, object_id);
alter table public.likes enable row level security;
revoke all on public.likes from anon, authenticated;
grant select, insert, delete on public.likes to authenticated;

-- SECURITY INVOKER: reutiliza las políticas ya existentes de cada objeto.
--  - reto: community_challenge_visible (participante registrado, sin bloqueos);
--  - salida compartida: la fila de profile_posts solo existe para el lector si su RLS
--    (amistad, visibilidad, estadísticas y barrera de comunidad) se la deja ver.
create function public.like_target_visible(object_type text, object_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select case like_target_visible.object_type
    when 'challenge' then public.community_challenge_visible(like_target_visible.object_id)
    when 'post' then exists(select 1 from public.profile_posts p where p.id = like_target_visible.object_id)
    else false end
$$;

create policy likes_read on public.likes for select to authenticated
  using ((select public.community_current_registered()) and public.like_target_visible(object_type, object_id));
create policy likes_insert on public.likes for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.community_current_registered())
    and public.like_target_visible(object_type, object_id));
-- Quitar el propio siempre se puede, aunque el objeto haya dejado de verse.
create policy likes_delete on public.likes for delete to authenticated
  using (user_id = (select auth.uid()));

-- Recuento y marca propia de hasta 100 objetos en una sola consulta; el filtro RLS de la tabla
-- hace que un objeto oculto devuelva 0 y no revele nada.
create function public.list_likes(kind text, ids uuid[])
  returns table (object_id uuid, like_count integer, liked boolean)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sesión necesaria' using errcode = '42501'; end if;
  if kind is null or kind not in ('challenge', 'post') or ids is null or cardinality(ids) > 100 then
    raise exception 'Consulta no válida' using errcode = '22023';
  end if;
  return query
    select o.id, count(l.user_id)::integer, coalesce(bool_or(l.user_id = auth.uid()), false)
    from (select distinct u from unnest(ids) u) o(id)
    left join public.likes l on l.object_type = kind and l.object_id = o.id
    group by o.id;
end;
$$;

revoke all on function public.like_target_visible(text, uuid), public.list_likes(text, uuid[]) from public, anon, authenticated;
grant execute on function public.like_target_visible(text, uuid), public.list_likes(text, uuid[]) to authenticated;
commit;
