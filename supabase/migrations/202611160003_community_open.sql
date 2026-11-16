-- Comunidad abierta: solo cuentas registradas; ninguna geometría ni celda sale de las nuevas RPC.
begin;

create table public.community_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(blocker_id, blocked_id), check(blocker_id <> blocked_id)
);
create index community_blocks_target on public.community_blocks(blocked_id);
create table public.community_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check(char_length(btrim(reason)) between 5 and 500),
  created_at timestamptz not null default now(), check(reporter_id <> target_id)
);
create index community_reports_author on public.community_reports(reporter_id, created_at);
create table public.community_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  active_day timestamptz not null
);
create table public.community_rate_limits (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  window_start timestamptz not null default now(), used integer not null default 0 check(used between 0 and 20)
);

create function public.community_registered(account_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users caller where caller.id = auth.uid() and not caller.is_anonymous)
    and exists(select 1 from auth.users u where u.id = account_id and not u.is_anonymous)
$$;
create function public.community_visible(target_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.community_registered(auth.uid()) and public.community_registered(target_id)
    and not exists(select 1 from public.community_blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = target_id)
        or (b.blocked_id = auth.uid() and b.blocker_id = target_id))
$$;
create function public.community_require_registered() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.community_registered(auth.uid()) then raise exception 'Cuenta registrada necesaria' using errcode = '42501'; end if;
end $$;
create function public.community_consume_quota(amount integer) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.community_rate_limits;
begin
  perform public.community_require_registered();
  if amount is null or amount < 1 or amount > 20 then raise exception 'Invitación no válida' using errcode = '22023'; end if;
  insert into public.community_rate_limits(user_id) values(auth.uid()) on conflict do nothing;
  select * into r from public.community_rate_limits where user_id = auth.uid() for update;
  if r.window_start <= now() - interval '24 hours' then r.used := 0; r.window_start := now(); end if;
  if r.used + amount > 20 then raise exception 'Límite diario de invitaciones' using errcode = 'P0429'; end if;
  update public.community_rate_limits set used = r.used + amount, window_start = r.window_start where user_id = auth.uid();
end $$;

alter table public.community_blocks enable row level security;
alter table public.community_reports enable row level security;
alter table public.community_presence enable row level security;
alter table public.community_rate_limits enable row level security;
revoke all on public.community_blocks, public.community_reports, public.community_presence, public.community_rate_limits from anon, authenticated;
grant select on public.community_blocks, public.community_reports to authenticated;
grant select on public.community_reports to service_role;
create policy community_blocks_owner on public.community_blocks for select to authenticated using(blocker_id = auth.uid() and public.community_registered());
create policy community_reports_owner on public.community_reports for select to authenticated using(reporter_id = auth.uid() and public.community_registered());
create policy community_reports_service on public.community_reports for select to service_role using(true);

-- El grant de columnas público existente permanece; las columnas de zona siguen fuera de SELECT.
drop policy profiles_search on public.profiles;
create policy profiles_search on public.profiles for select to authenticated using(public.community_visible(id));
create policy profiles_registered_edit on public.profiles as restrictive for update to authenticated
  using(public.community_registered()) with check(public.community_registered());
create policy friendships_community_guard on public.friendships as restrictive for select to authenticated
  using(public.community_visible(requester_id) and public.community_visible(recipient_id));
create policy journal_community_guard on public.profile_posts as restrictive for select to authenticated
  using(public.community_visible(author_id));
create policy avatars_community_guard on storage.objects as restrictive for select to authenticated
  using(bucket_id <> 'fbiketrain-avatars' or (public.community_registered()
    and exists(select 1 from public.profiles p where name = p.id::text || '/avatar.webp')));

create function public.touch_community_activity() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.community_require_registered();
  insert into public.community_presence(user_id, active_day) values(auth.uid(), date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
    on conflict(user_id) do update set active_day = excluded.active_day
      where community_presence.active_day is distinct from excluded.active_day;
end $$;
create function public.list_cyclists(query_text text default '', page_offset integer default 0)
returns table(id uuid,username text,display_name text,bio text,riding_style text,avatar_version bigint,locality text,distance_km double precision,last_active_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.community_require_registered();
  if query_text is null or char_length(query_text) > 60 or page_offset is null or page_offset < 0 or page_offset > 100000 then
    raise exception 'Búsqueda no válida' using errcode = '22023'; end if;
  return query select p.id,p.username,p.display_name,p.bio,p.riding_style,p.avatar_version,
    case when p.show_area then p.locality end,null::double precision,a.active_day
    from public.profiles p left join public.community_presence a on a.user_id = p.id
    where public.community_visible(p.id) and (btrim(query_text) = '' or
      strpos(lower(p.display_name),lower(btrim(query_text))) > 0 or
      (p.username <> replace(p.id::text,'-','') and strpos(lower(p.username),lower(btrim(query_text))) > 0))
    order by a.active_day desc nulls last,p.id limit 50 offset page_offset;
end $$;
create function public.block_cyclist(target_id uuid,blocked boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.community_require_registered();
  if blocked is null or target_id is null or target_id = auth.uid() or not public.community_registered(target_id) then
    raise exception 'Usuario no disponible' using errcode = '22023'; end if;
  -- App pequeña: serializar también el bloqueo inverso frente a solicitudes e invitaciones.
  perform pg_catalog.pg_advisory_xact_lock(611160003);
  insert into public.community_rate_limits(user_id) values(auth.uid()) on conflict do nothing;
  perform 1 from public.community_rate_limits where user_id = auth.uid() for update;
  if blocked then
    insert into public.community_blocks(blocker_id,blocked_id) values(auth.uid(),target_id) on conflict do nothing;
    delete from public.friendships f where least(f.requester_id,f.recipient_id) = least(auth.uid(),target_id)
      and greatest(f.requester_id,f.recipient_id) = greatest(auth.uid(),target_id);
  else delete from public.community_blocks b where b.blocker_id = auth.uid() and b.blocked_id = target_id;
  end if;
end $$;
create function public.list_blocked_cyclists() returns table(id uuid,username text,display_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.community_require_registered();
  return query select p.id,p.username,p.display_name from public.community_blocks b join public.profiles p on p.id = b.blocked_id
    where b.blocker_id = auth.uid() and public.community_registered(p.id) order by b.created_at desc,p.id;
end $$;
create function public.report_cyclist(target_id uuid,reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.community_require_registered();
  if target_id is null or target_id = auth.uid() or not public.community_registered(target_id)
    or reason is null or char_length(btrim(reason)) not between 5 and 500 then
    raise exception 'Denuncia no válida' using errcode = '22023'; end if;
  -- Denuncias también acotadas; borrar contenido social no reinicia este contador.
  insert into public.community_rate_limits(user_id) values(auth.uid()) on conflict do nothing;
  perform 1 from public.community_rate_limits where user_id = auth.uid() for update;
  if (select count(*) from public.community_reports r where r.reporter_id = auth.uid() and r.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'Límite diario de denuncias' using errcode = 'P0429'; end if;
  insert into public.community_reports(reporter_id,target_id,reason) values(auth.uid(),target_id,btrim(reason));
end $$;

create table public.community_challenges (
  id uuid primary key default gen_random_uuid(), creator_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check(char_length(btrim(title)) between 1 and 120),
  kind text not null check(kind in ('distance','elevation','rides','segment','speed')),
  created_at timestamptz not null default now(), deadline timestamptz not null,
  target_value double precision check(target_value > 0 and target_value < 'Infinity'::double precision),
  distance_m integer, segment_key text,
  check(target_value is null or target_value <= case kind when 'distance' then 150000000 when 'elevation' then 3000000 when 'rides' then 3000 when 'speed' then 40 else 2592000 end),
  check(kind <> 'rides' or target_value is null or target_value = trunc(target_value)),
  check(deadline > created_at and deadline <= created_at + interval '30 days'),
  check((kind in ('segment','speed') and distance_m is not null and distance_m between 100 and 5000000) or (kind not in ('segment','speed') and distance_m is null)),
  check((kind = 'segment' and segment_key is not null and segment_key ~ '^[a-f0-9]{64}$') or (kind <> 'segment' and segment_key is null))
);
create table public.community_challenge_members (
  challenge_id uuid not null references public.community_challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check(status in ('pending','accepted','declined')),
  accepted_at timestamptz, primary key(challenge_id,user_id),
  check((status = 'accepted') = (accepted_at is not null))
);
create index community_members_user on public.community_challenge_members(user_id,challenge_id);
create table public.community_challenge_scores (
  challenge_id uuid not null, user_id uuid not null,
  score double precision not null check(score >= 0 and score < 'Infinity'::double precision),
  updated_at timestamptz not null default now(), primary key(challenge_id,user_id),
  foreign key(challenge_id,user_id) references public.community_challenge_members(challenge_id,user_id) on delete cascade
);
create table public.community_notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check(kind in ('invitation','accepted','declined','finished','friendship','friendship_accepted')),
  challenge_id uuid references public.community_challenges(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(), read_at timestamptz
);
create unique index community_notifications_finish on public.community_notifications(user_id,challenge_id) where kind = 'finished';
create index community_notifications_user on public.community_notifications(user_id,created_at desc,id);

create function public.community_challenge_visible(challenge_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.community_registered() and exists(select 1 from public.community_challenge_members m where m.challenge_id = community_challenge_visible.challenge_id and m.user_id = auth.uid())
    and not exists(select 1 from public.community_challenge_members m where m.challenge_id = community_challenge_visible.challenge_id and not public.community_visible(m.user_id))
$$;
alter table public.community_challenges enable row level security;
alter table public.community_challenge_members enable row level security;
alter table public.community_challenge_scores enable row level security;
alter table public.community_notifications enable row level security;
revoke all on public.community_challenges, public.community_challenge_members,public.community_challenge_scores,public.community_notifications from anon,authenticated;
grant select on public.community_challenges,public.community_challenge_members,public.community_challenge_scores,public.community_notifications to authenticated;
create policy community_challenges_read on public.community_challenges for select to authenticated using(public.community_challenge_visible(id));
create policy community_members_read on public.community_challenge_members for select to authenticated using(public.community_challenge_visible(challenge_id));
create policy community_scores_read on public.community_challenge_scores for select to authenticated using(public.community_challenge_visible(challenge_id));
create policy community_notifications_read on public.community_notifications for select to authenticated using(user_id = auth.uid() and public.community_registered()
  and (actor_id is null or public.community_visible(actor_id)) and (challenge_id is null or public.community_challenge_visible(challenge_id)));

create function public.create_community_challenge(title text,kind text,duration_days integer,invited_ids uuid[],target_value double precision default null,distance_m integer default null,segment_key text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare new_id uuid; n integer;
begin
  perform public.community_require_registered();
  perform pg_catalog.pg_advisory_xact_lock(611160003);
  n := cardinality(invited_ids);
  if title is null or char_length(btrim(title)) not between 1 and 120 or kind is null or kind not in ('distance','elevation','rides','segment','speed')
    or duration_days is null or duration_days not between 1 and 30 or n is null or n not between 1 and 19
    or exists(select 1 from unnest(invited_ids) u where u is null or u = auth.uid() or not public.community_visible(u))
    or (select count(distinct u) from unnest(invited_ids) u) <> n
    or (target_value is not null and not(target_value > 0 and target_value <= case kind when 'distance' then 150000000 when 'elevation' then 3000000 when 'rides' then 3000 when 'speed' then 40 else 2592000 end))
    or (kind = 'rides' and target_value is not null and target_value <> trunc(target_value))
    or (kind in ('segment','speed') and (distance_m is null or distance_m not between 100 and 5000000))
    or (kind not in ('segment','speed') and distance_m is not null)
    or (kind = 'segment' and (segment_key is null or segment_key !~ '^[a-f0-9]{64}$'))
    or (kind <> 'segment' and segment_key is not null) then raise exception 'Reto no válido' using errcode = '22023'; end if;
  if exists(select 1 from public.community_blocks b where b.blocker_id = any(invited_ids) and b.blocked_id = any(invited_ids)) then
    raise exception 'Usuario no disponible' using errcode = '42501'; end if;
  perform public.community_consume_quota(n);
  -- Comprobar de nuevo después del bloqueo de cuota.
  if exists(select 1 from unnest(invited_ids) u where not public.community_visible(u)) then raise exception 'Usuario no disponible' using errcode = '42501'; end if;
  insert into public.community_challenges(creator_id,title,kind,deadline,target_value,distance_m,segment_key)
    values(auth.uid(),btrim(title),kind,now() + make_interval(days => duration_days),target_value,distance_m,segment_key) returning id into new_id;
  insert into public.community_challenge_members(challenge_id,user_id,status,accepted_at) values(new_id,auth.uid(),'accepted',now());
  insert into public.community_challenge_members(challenge_id,user_id,status) select new_id,u,'pending' from unnest(invited_ids) u;
  insert into public.community_notifications(user_id,kind,challenge_id,actor_id) select u,'invitation',new_id,auth.uid() from unnest(invited_ids) u;
  return new_id;
end $$;
create function public.respond_community_challenge(challenge_id uuid,accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare c public.community_challenges;
begin
  perform public.community_require_registered();
  perform pg_catalog.pg_advisory_xact_lock(611160003);
  select * into c from public.community_challenges where id = challenge_id for update;
  if not found or not public.community_challenge_visible(challenge_id) then raise exception 'Reto no disponible' using errcode = '42501'; end if;
  if accept is null or c.deadline <= now() then raise exception 'Reto cerrado' using errcode = '22023'; end if;
  update public.community_challenge_members m set status = case when accept then 'accepted' else 'declined' end, accepted_at = case when accept then now() end
    where m.challenge_id = c.id and m.user_id = auth.uid() and m.status = 'pending';
  if not found then raise exception 'Invitación no disponible' using errcode = '22023'; end if;
  insert into public.community_notifications(user_id,kind,challenge_id,actor_id)
    values(c.creator_id,case when accept then 'accepted' else 'declined' end,c.id,auth.uid());
end $$;
create function public.submit_community_score(challenge_id uuid,score double precision) returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare c public.community_challenges; maximum double precision;
begin
  perform public.community_require_registered();
  perform pg_catalog.pg_advisory_xact_lock(611160003);
  select * into c from public.community_challenges where id = challenge_id for update;
  if not found or not public.community_challenge_visible(challenge_id)
    or not exists(select 1 from public.community_challenge_members m where m.challenge_id = c.id and m.user_id = auth.uid() and m.status = 'accepted') then
    raise exception 'Reto no disponible' using errcode = '42501'; end if;
  if c.deadline <= now() then raise exception 'Reto cerrado' using errcode = '22023'; end if;
  maximum := case c.kind when 'distance' then 150000000 when 'elevation' then 3000000 when 'rides' then 3000 when 'speed' then 40 else 2592000 end;
  if score is null or not(score >= 0 and score <= maximum) or (c.kind = 'rides' and score <> trunc(score)) then
    raise exception 'Cifras no válidas' using errcode = '22023'; end if;
  insert into public.community_challenge_scores(challenge_id,user_id,score) values(c.id,auth.uid(),score)
    on conflict(challenge_id,user_id) do update set score = excluded.score,updated_at = now();
end $$;

create function public.community_challenge_json(challenge_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',c.id,'title',c.title,'kind',c.kind,'created_at',c.created_at,'deadline',c.deadline,
    'creator_id',c.creator_id,'target_value',c.target_value,'distance_m',c.distance_m,'segment_key',c.segment_key,
    'status',case when c.deadline <= now() then 'finished' else 'active' end,
    'members',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,
      'status',m.status,'accepted_at',m.accepted_at,'score',case when m.status = 'accepted' then s.score end,'updated_at',s.updated_at) order by m.accepted_at nulls last,p.id),'[]'::jsonb)
      from public.community_challenge_members m join public.profiles p on p.id = m.user_id
      left join public.community_challenge_scores s on s.challenge_id = m.challenge_id and s.user_id = m.user_id where m.challenge_id = c.id),
    'winner_ids',case when c.deadline > now() or (select count(*) from public.community_challenge_members a where a.challenge_id=c.id and a.status='accepted') < 2 then '[]'::jsonb else
      (select coalesce(jsonb_agg(s.user_id order by s.user_id),'[]'::jsonb) from public.community_challenge_scores s
        join public.community_challenge_members m on m.challenge_id = s.challenge_id and m.user_id = s.user_id
        where s.challenge_id = c.id and m.status = 'accepted' and s.score > 0 and s.score =
          (select case when c.kind = 'segment' then min(s2.score) else max(s2.score) end
            from public.community_challenge_scores s2 join public.community_challenge_members m2 on m2.challenge_id = s2.challenge_id and m2.user_id = s2.user_id
            where s2.challenge_id = c.id and m2.status = 'accepted' and s2.score > 0)) end)
  from public.community_challenges c where c.id = challenge_id and public.community_challenge_visible(c.id)
$$;
create function public.get_community_challenge(challenge_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin perform public.community_require_registered(); return public.community_challenge_json(challenge_id); end $$;
create function public.list_community_challenges(page_offset integer default 0) returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.community_require_registered();
  if page_offset is null or page_offset < 0 or page_offset > 100000 then raise exception 'Página no válida' using errcode = '22023'; end if;
  return query select public.community_challenge_json(c.id) from public.community_challenges c
    where public.community_challenge_visible(c.id) order by c.created_at desc,c.id desc limit 50 offset page_offset;
end $$;
create function public.list_community_notifications(page_offset integer default 0)
returns table(id uuid,kind text,challenge_id uuid,actor_id uuid,created_at timestamptz,read_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.community_require_registered();
  if page_offset is null or page_offset < 0 or page_offset > 100000 then raise exception 'Página no válida' using errcode = '22023'; end if;
  -- Cierre perezoso e idempotente: no necesita cron ni permisos del cliente sobre el estado.
  insert into public.community_notifications(user_id,kind,challenge_id)
    select auth.uid(),'finished',c.id from public.community_challenges c
    where c.deadline <= now() and public.community_challenge_visible(c.id)
    on conflict(user_id,challenge_id) where kind = 'finished' do nothing;
  return query select n.id,n.kind,n.challenge_id,n.actor_id,n.created_at,n.read_at from public.community_notifications n
    where n.user_id = auth.uid() and (n.actor_id is null or public.community_visible(n.actor_id))
      and (n.challenge_id is null or public.community_challenge_visible(n.challenge_id))
    order by n.created_at desc,n.id desc limit 50 offset page_offset;
end $$;
create function public.read_community_notification(notification_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.community_require_registered();
  update public.community_notifications n set read_at = coalesce(n.read_at,now())
    where n.id = notification_id and n.user_id = auth.uid()
      and (n.actor_id is null or public.community_visible(n.actor_id))
      and (n.challenge_id is null or public.community_challenge_visible(n.challenge_id));
  if not found then raise exception 'Aviso no disponible' using errcode = '42501'; end if;
end $$;

-- Amistad abierta a cualquier cuenta registrada, sin devolver cuota al retirar una solicitud.
create or replace function public.request_friendship(target_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.community_require_registered();
  perform pg_catalog.pg_advisory_xact_lock(611160003);
  if target_id is null or target_id = auth.uid() or not public.community_visible(target_id) then raise exception 'Usuario no disponible' using errcode = '42501'; end if;
  if exists(select 1 from public.friendships f where least(f.requester_id,f.recipient_id) = least(auth.uid(),target_id) and greatest(f.requester_id,f.recipient_id) = greatest(auth.uid(),target_id)) then return; end if;
  perform public.community_consume_quota(1);
  if not public.community_visible(target_id) then raise exception 'Usuario no disponible' using errcode = '42501'; end if;
  insert into public.friendships(requester_id,recipient_id) values(auth.uid(),target_id) on conflict do nothing;
  if found then insert into public.community_notifications(user_id,kind,actor_id) values(target_id,'friendship',auth.uid()); end if;
end $$;
create or replace function public.accept_friendship(request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  perform public.community_require_registered();
  perform pg_catalog.pg_advisory_xact_lock(611160003);
  update public.friendships f set status = 'accepted' where f.id = request_id and f.recipient_id = auth.uid() and f.status = 'pending'
    and public.community_visible(f.requester_id) returning f.requester_id into actor;
  if not found then raise exception 'Solicitud no disponible' using errcode = '42501'; end if;
  insert into public.community_notifications(user_id,kind,actor_id) values(actor,'friendship_accepted',auth.uid());
end $$;

-- Funciones antiguas: conservar sus firmas y comportamiento, pero cerrar rutas alternativas de acceso.
alter function public.remove_friendship(uuid) rename to community_old_remove_friendship;
create function public.remove_friendship(request_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin perform public.community_require_registered(); perform public.community_old_remove_friendship(request_id); end $$;
alter function public.search_profiles(text) rename to community_old_search_profiles;
create function public.search_profiles(q text) returns setof public.profile_card language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.community_require_registered();
  return query select s.* from public.community_old_search_profiles(q) s where public.community_visible(s.id);
end $$;
alter function public.search_profiles_near(integer) rename to community_old_search_profiles_near;
create function public.search_profiles_near(radius_km integer) returns setof public.profile_card language plpgsql stable security definer set search_path = '' as $$
begin perform public.community_require_registered(); return query select s.* from public.community_old_search_profiles_near(radius_km) s where public.community_visible(s.id); end $$;
alter function public.list_friends() rename to community_old_list_friends;
create function public.list_friends() returns table(friendship_id uuid,status text,direction text,profile public.profile_card)
language plpgsql stable security definer set search_path = '' as $$
begin perform public.community_require_registered(); return query select s.* from public.community_old_list_friends() s where public.community_visible((s.profile).id); end $$;
alter function public.my_area() rename to community_old_my_area;
create function public.my_area() returns table(locality text,show_area boolean) language plpgsql stable security definer set search_path = '' as $$
begin perform public.community_require_registered(); return query select * from public.community_old_my_area(); end $$;
alter function public.create_profile_post(text,text,jsonb) rename to community_old_create_profile_post;
create function public.create_profile_post(body text,visibility text default 'friends',ride jsonb default null) returns uuid
language plpgsql security definer set search_path = '' as $$
begin perform public.community_require_registered(); return public.community_old_create_profile_post(body,visibility,ride); end $$;
alter function public.delete_profile_post(uuid) rename to community_old_delete_profile_post;
create function public.delete_profile_post(post_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin perform public.community_require_registered(); perform public.community_old_delete_profile_post(post_id); end $$;

create policy legacy_challenges_guard on public.challenges as restrictive for select to authenticated
  using(public.community_visible(challenger_id) and public.community_visible(challenged_id));
create policy legacy_results_guard on public.challenge_results as restrictive for select to authenticated
  using(exists(select 1 from public.challenges c where c.id = challenge_id));
alter function public.create_challenge(uuid,text,jsonb,integer,integer) rename to community_old_create_challenge;
create function public.create_challenge(challenged_id uuid,route_name text,route_points jsonb,distance_m integer,elev_gain_m integer) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform public.community_require_registered();
  perform pg_catalog.pg_advisory_xact_lock(611160003);
  if not public.community_visible(challenged_id) then raise exception 'Usuario no disponible' using errcode = '42501'; end if;
  perform public.community_consume_quota(1);
  return public.community_old_create_challenge(challenged_id,route_name,route_points,distance_m,elev_gain_m);
end $$;
alter function public.respond_challenge(uuid,boolean) rename to community_old_respond_challenge;
create function public.respond_challenge(challenge_id uuid,accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.community_require_registered();
  perform pg_catalog.pg_advisory_xact_lock(611160003);
  if not exists(select 1 from public.challenges c where c.id = challenge_id and public.community_visible(c.challenger_id) and public.community_visible(c.challenged_id)) then raise exception 'Reto no disponible' using errcode = '42501'; end if;
  perform public.community_old_respond_challenge(challenge_id,accept);
end $$;
alter function public.submit_challenge_result(uuid,date,integer,integer,real,integer,integer) rename to community_old_submit_challenge_result;
create function public.submit_challenge_result(challenge_id uuid,activity_date date,moving_time_s integer,distance_m integer,avg_speed_ms real,elev_gain_m integer,vam_mh integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.community_require_registered();
  perform pg_catalog.pg_advisory_xact_lock(611160003);
  if not exists(select 1 from public.challenges c where c.id = challenge_id and public.community_visible(c.challenger_id) and public.community_visible(c.challenged_id)) then raise exception 'Reto no disponible' using errcode = '42501'; end if;
  perform public.community_old_submit_challenge_result(challenge_id,activity_date,moving_time_s,distance_m,avg_speed_ms,elev_gain_m,vam_mh);
end $$;
alter function public.list_challenges() rename to community_old_list_challenges;
create function public.list_challenges() returns table(challenge jsonb,rival public.profile_card,mine jsonb,theirs jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin perform public.community_require_registered(); return query select s.* from public.community_old_list_challenges() s where public.community_visible((s.rival).id); end $$;

-- Renombrar una función cambia su etiqueta implícita de PL/pgSQL. Ajustar las referencias
-- parámetro calificadas del código antiguo antes de que se compile con el nombre nuevo.
do $$ declare f record; definition text; begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'community_old_%' loop
    definition := pg_get_functiondef(f.oid);
    definition := replace(definition, substring(f.proname from 15) || '.', f.proname || '.');
    execute definition;
  end loop;
end $$;

-- Todos los helpers internos quedan inaccesibles por RPC. Solo los predicados RLS son ejecutables.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature, p.proname as function_name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'community_%' or p.proname in (
      'list_cyclists','touch_community_activity','block_cyclist','list_blocked_cyclists','report_cyclist',
      'create_community_challenge','respond_community_challenge','submit_community_score','get_community_challenge','list_community_challenges','list_community_notifications','read_community_notification',
      'request_friendship','accept_friendship','remove_friendship','search_profiles','search_profiles_near','list_friends','my_area','create_profile_post','delete_profile_post',
      'create_challenge','respond_challenge','submit_challenge_result','list_challenges')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    if left(f.function_name,10) <> 'community_' or f.function_name in ('community_registered','community_visible','community_challenge_visible') then
      execute format('grant execute on function %s to authenticated',f.signature);
    end if;
  end loop;
end $$;
commit;
