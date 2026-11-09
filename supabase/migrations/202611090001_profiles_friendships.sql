-- Perfiles descubribles; las estadísticas y los tracks tendrán permisos separados.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,32}$'),
  display_name text not null default 'Ciclista' check (char_length(display_name) between 1 and 60),
  stats_visibility text not null default 'everyone' check (stats_visibility in ('everyone', 'friends')),
  created_at timestamptz not null default now()
);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester_id <> recipient_id)
);
create unique index friendships_pair on public.friendships
  (least(requester_id, recipient_id), greatest(requester_id, recipient_id));
create index friendships_recipient on public.friendships(recipient_id);
create index friendships_requester on public.friendships(requester_id);

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
revoke all on public.profiles, public.friendships from anon, authenticated;
grant select on public.profiles, public.friendships to authenticated;
grant update (username, display_name, stats_visibility) on public.profiles to authenticated;

create policy profiles_search on public.profiles for select to authenticated using (true);
create policy profiles_edit on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy friendships_participants on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester_id, recipient_id));

-- No usar correos ni metadatos de OAuth como datos de perfil públicos.
create function public.create_cycling_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, username) values (new.id, replace(new.id::text, '-', ''));
  return new;
end;
$$;
revoke all on function public.create_cycling_profile() from public, anon, authenticated;
create trigger cycling_profile_created after insert on auth.users
  for each row execute function public.create_cycling_profile();
-- También permite aplicar la migración a un proyecto con cuentas previas.
insert into public.profiles(id, username)
  select id, replace(id::text, '-', '') from auth.users on conflict (id) do nothing;

-- Solo estas operaciones pueden modificar las amistades. El cliente no decide el remitente.
create function public.request_friendship(target_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or target_id is null or target_id = auth.uid() then
    raise exception 'Solicitud no válida' using errcode = '22023';
  end if;
  insert into public.friendships(requester_id, recipient_id) values (auth.uid(), target_id)
    on conflict do nothing;
end;
$$;

create function public.accept_friendship(request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.friendships set status = 'accepted'
    where id = request_id and recipient_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Solicitud no disponible' using errcode = '42501'; end if;
end;
$$;

-- Sirve para rechazar, cancelar o retirar una amistad, siempre por un participante.
create function public.remove_friendship(request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.friendships where id = request_id and auth.uid() in (requester_id, recipient_id);
  if not found then raise exception 'Solicitud no disponible' using errcode = '42501'; end if;
end;
$$;

revoke all on function public.request_friendship(uuid), public.accept_friendship(uuid),
  public.remove_friendship(uuid) from public, anon, authenticated;
grant execute on function public.request_friendship(uuid), public.accept_friendship(uuid),
  public.remove_friendship(uuid) to authenticated;

insert into storage.buckets(id, name, public) values ('fbiketrain-tracks', 'fbiketrain-tracks', false);
create policy cycling_tracks_read on storage.objects for select to authenticated
  using (bucket_id = 'fbiketrain-tracks' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy cycling_tracks_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fbiketrain-tracks' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy cycling_tracks_update on storage.objects for update to authenticated
  using (bucket_id = 'fbiketrain-tracks' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'fbiketrain-tracks' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy cycling_tracks_delete on storage.objects for delete to authenticated
  using (bucket_id = 'fbiketrain-tracks' and (storage.foldername(name))[1] = (select auth.uid()::text));
commit;
