-- Quién dio «me gusta» no se enseña a nadie: cada cuenta solo lee sus propias filas.
-- El recuento sale de una tabla aparte, que mantiene un trigger sobre likes y que solo
-- se lee para objetos visibles. Aditiva salvo por la política de lectura de likes, creada
-- en la migración anterior, que se estrecha.
begin;

create table public.like_counts (
  object_type text not null check (object_type in ('challenge', 'post')),
  object_id uuid not null,
  like_count integer not null default 0 check (like_count >= 0),
  primary key (object_type, object_id)
);
alter table public.like_counts enable row level security;
revoke all on public.like_counts from anon, authenticated;
grant select on public.like_counts to authenticated;
create policy like_counts_read on public.like_counts for select to authenticated
  using ((select public.community_current_registered()) and public.like_target_visible(object_type, object_id));

insert into public.like_counts(object_type, object_id, like_count)
  select object_type, object_id, count(*)::integer from public.likes group by object_type, object_id;

-- SECURITY DEFINER: quien da «me gusta» no puede escribir en like_counts por sí mismo.
create function public.likes_count_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.like_counts(object_type, object_id, like_count) values (new.object_type, new.object_id, 1)
      on conflict (object_type, object_id) do update set like_count = public.like_counts.like_count + 1;
  else
    update public.like_counts set like_count = greatest(like_count - 1, 0)
      where object_type = old.object_type and object_id = old.object_id;
  end if;
  return null;
end;
$$;
revoke all on function public.likes_count_sync() from public, anon, authenticated;
create trigger likes_count_sync after insert or delete on public.likes
  for each row execute function public.likes_count_sync();

drop policy likes_read on public.likes;
create policy likes_read on public.likes for select to authenticated
  using (user_id = (select auth.uid()));

-- Misma firma y mismo resultado: una fila por id pedido; un objeto oculto devuelve 0.
create or replace function public.list_likes(kind text, ids uuid[])
  returns table (object_id uuid, like_count integer, liked boolean)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sesión necesaria' using errcode = '42501'; end if;
  if kind is null or kind not in ('challenge', 'post') or ids is null or cardinality(ids) > 100 then
    raise exception 'Consulta no válida' using errcode = '22023';
  end if;
  return query
    select o.id, coalesce(c.like_count, 0),
      exists(select 1 from public.likes l where l.user_id = auth.uid() and l.object_type = kind and l.object_id = o.id)
    from (select distinct u from unnest(ids) u) o(id)
    left join public.like_counts c on c.object_type = kind and c.object_id = o.id;
end;
$$;
commit;
