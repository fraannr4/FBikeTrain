-- Cuaderno de ruta: identidad pública, avatar privado autenticado y publicaciones opt-in sin GPS.
begin;

alter table public.profiles
  add column bio text not null default '' check (char_length(bio) <= 280),
  add column riding_style text not null default 'explorar' check (riding_style in ('explorar', 'subir', 'fondo', 'grupo')),
  add column avatar_version bigint not null default 0 check (avatar_version >= 0),
  -- Contadores internos: borrar una publicación no devuelve la cuota de las últimas 24 horas.
  add column journal_window_start timestamptz,
  add column journal_window_count smallint not null default 0 check (journal_window_count between 0 and 20);

grant select (bio, riding_style, avatar_version) on public.profiles to authenticated;
grant update (bio, riding_style, avatar_version) on public.profiles to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values ('fbiketrain-avatars', 'fbiketrain-avatars', false, 524288, array['image/webp'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy cycling_avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'fbiketrain-avatars');
create policy cycling_avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fbiketrain-avatars' and name = (select auth.uid()::text) || '/avatar.webp');
create policy cycling_avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'fbiketrain-avatars' and name = (select auth.uid()::text) || '/avatar.webp')
  with check (bucket_id = 'fbiketrain-avatars' and name = (select auth.uid()::text) || '/avatar.webp');
create policy cycling_avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'fbiketrain-avatars' and name = (select auth.uid()::text) || '/avatar.webp');

create function public.valid_journal_ride(ride jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  if ride is null then return true; end if;
  if jsonb_typeof(ride) <> 'object' then return false; end if;
  if not (ride ?& array['activity_date', 'distance_m', 'moving_time_s', 'elev_gain_m'])
    or exists (select 1 from jsonb_object_keys(ride) k where k not in ('activity_date', 'distance_m', 'moving_time_s', 'elev_gain_m')) then return false; end if;
  if jsonb_typeof(ride->'activity_date') <> 'string' or ride->>'activity_date' !~ '^\d{4}-\d{2}-\d{2}$'
    or (ride->>'activity_date')::date < date '1970-01-01'
    or (ride->>'activity_date')::date > (now() at time zone 'Europe/Madrid')::date then return false; end if;
  if jsonb_typeof(ride->'distance_m') <> 'number' or not ((ride->>'distance_m')::numeric > 0 and (ride->>'distance_m')::numeric <= 5000000)
    or jsonb_typeof(ride->'moving_time_s') <> 'number' or not ((ride->>'moving_time_s')::numeric > 0 and (ride->>'moving_time_s')::numeric <= 604800) then return false; end if;
  if jsonb_typeof(ride->'elev_gain_m') <> 'null' and
    (jsonb_typeof(ride->'elev_gain_m') <> 'number' or not ((ride->>'elev_gain_m')::numeric between 0 and 100000)) then return false; end if;
  return true;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range then
  return false;
end;
$$;

create table public.profile_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 1000),
  visibility text not null default 'friends' check (visibility in ('everyone', 'friends')),
  ride jsonb check (public.valid_journal_ride(ride)),
  created_at timestamptz not null default now(),
  check (char_length(btrim(body)) > 0 or ride is not null)
);
create index profile_posts_author_date on public.profile_posts(author_id, created_at desc, id desc);
create index profile_posts_date on public.profile_posts(created_at desc, id desc);
alter table public.profile_posts enable row level security;
revoke all on public.profile_posts from anon, authenticated;
grant select on public.profile_posts to authenticated;
create policy profile_posts_visible on public.profile_posts for select to authenticated using (
  author_id = (select auth.uid())
  or exists (select 1 from public.friendships f where f.status = 'accepted'
    and ((f.requester_id = (select auth.uid()) and f.recipient_id = author_id)
      or (f.recipient_id = (select auth.uid()) and f.requester_id = author_id)))
  or (visibility = 'everyone' and (ride is null or exists (
    select 1 from public.profiles p where p.id = author_id and p.stats_visibility = 'everyone')))
);

create function public.create_profile_post(body text, visibility text default 'friends', ride jsonb default null) returns uuid
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  p public.profiles;
  new_id uuid;
begin
  if me is null then raise exception 'Sesión necesaria' using errcode = '42501'; end if;
  if create_profile_post.body is null or char_length(btrim(create_profile_post.body)) > 1000
    or create_profile_post.visibility is null or create_profile_post.visibility not in ('everyone', 'friends')
    or (char_length(btrim(create_profile_post.body)) = 0 and create_profile_post.ride is null)
    or not public.valid_journal_ride(create_profile_post.ride) then
    raise exception 'Publicación no válida' using errcode = '22023';
  end if;
  -- Serializa la cuota por cuenta; autor y fecha nunca proceden de la petición.
  select * into p from public.profiles where id = me for update;
  if not found then raise exception 'Sesión necesaria' using errcode = '42501'; end if;
  if p.journal_window_start is not null and p.journal_window_start > now() - interval '24 hours'
    and p.journal_window_count >= 20 then
    raise exception 'Límite diario de publicaciones' using errcode = 'P0429';
  end if;
  update public.profiles set
    journal_window_count = case when p.journal_window_start is null or p.journal_window_start <= now() - interval '24 hours' then 1 else p.journal_window_count + 1 end,
    journal_window_start = case when p.journal_window_start is null or p.journal_window_start <= now() - interval '24 hours' then now() else p.journal_window_start end
    where id = me;
  insert into public.profile_posts(author_id, body, visibility, ride)
    values (me, btrim(create_profile_post.body), create_profile_post.visibility, create_profile_post.ride)
    returning id into new_id;
  return new_id;
end;
$$;

create function public.delete_profile_post(post_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sesión necesaria' using errcode = '42501'; end if;
  delete from public.profile_posts where id = post_id and author_id = auth.uid();
  if not found then raise exception 'Publicación no disponible' using errcode = '42501'; end if;
end;
$$;

-- SECURITY INVOKER: la consulta directa y esta RPC tienen exactamente el mismo filtro RLS.
create function public.list_profile_posts(target_id uuid default null, before_created_at timestamptz default null, before_id uuid default null)
  returns table (id uuid, author_id uuid, body text, visibility text, ride jsonb, created_at timestamptz, author jsonb)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sesión necesaria' using errcode = '42501'; end if;
  if (before_created_at is null) <> (before_id is null) then raise exception 'Página no válida' using errcode = '22023'; end if;
  return query
    select n.id, n.author_id, n.body,
      case when n.ride is not null and p.stats_visibility = 'friends' then 'friends' else n.visibility end,
      n.ride, n.created_at,
      jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name,
        'riding_style', p.riding_style, 'avatar_version', p.avatar_version)
    from public.profile_posts n join public.profiles p on p.id = n.author_id
    where (case when target_id is not null then n.author_id = target_id else
      n.author_id = auth.uid() or exists (select 1 from public.friendships f where f.status = 'accepted'
        and ((f.requester_id = auth.uid() and f.recipient_id = n.author_id)
          or (f.recipient_id = auth.uid() and f.requester_id = n.author_id))) end)
      and (before_created_at is null or (n.created_at, n.id) < (before_created_at, before_id))
    order by n.created_at desc, n.id desc limit 20;
end;
$$;

revoke all on function public.valid_journal_ride(jsonb), public.create_profile_post(text, text, jsonb),
  public.delete_profile_post(uuid), public.list_profile_posts(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.create_profile_post(text, text, jsonb), public.delete_profile_post(uuid),
  public.list_profile_posts(uuid, timestamptz, uuid) to authenticated;
commit;
