-- Chat entre amigos (lote 1: texto). Las tablas solo se leen con RLS; todo se escribe por RPC.
-- El aviso push sale por el mismo secreto de private.push_config que los avisos de la comunidad.
begin;

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct','group')),
  title text check (title is null or (kind = 'group' and char_length(title) between 1 and 60)),
  direct_key text unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  check ((kind = 'direct') = (direct_key is not null))
);
create table public.chat_members (
  conversation_id uuid references public.chat_conversations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  last_notified_at timestamptz,
  muted boolean not null default false,
  left_at timestamptz,
  primary key (conversation_id, user_id)
);
create index chat_members_user on public.chat_members(user_id);
-- El id lo genera el cliente: reintentar un envío no duplica.
create table public.chat_messages (
  id uuid primary key,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('text','ride','route','library_route','proposal','system')),
  body text not null default '' check (char_length(body) <= 2000),
  payload jsonb not null default '{}' check (pg_column_size(payload) <= 8192),
  deleted_at timestamptz
);
create index chat_messages_conversation on public.chat_messages(conversation_id, created_at desc);
create index chat_messages_sender on public.chat_messages(sender_id, created_at);

alter table public.community_reports
  add column message_id uuid references public.chat_messages(id) on delete set null,
  add column message_body text check (message_body is null or char_length(message_body) <= 2000);

-- Predicado de RLS: no lanza error (Realtime lo evalúa por fila), simplemente devuelve false.
create function public.chat_is_member(conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.community_registered() and exists(
    select 1 from public.chat_members me join public.chat_conversations c on c.id = me.conversation_id
    where me.conversation_id = chat_is_member.conversation and me.user_id = auth.uid() and me.left_at is null
      and (c.kind <> 'direct' or not exists(select 1 from public.chat_members o
        where o.conversation_id = c.id and o.user_id <> auth.uid() and not public.community_visible(o.user_id))))
$$;

alter table public.chat_conversations enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.chat_conversations, public.chat_members, public.chat_messages from public, anon, authenticated;
-- Solo los mensajes se leen directamente, y solo porque Realtime lo exige. Conversaciones y miembros
-- salen por RPC: así nadie puede mirar si la otra persona le ha silenciado ni cuándo se le avisó.
grant select on public.chat_messages to authenticated;
create policy chat_messages_read on public.chat_messages for select to authenticated using (public.chat_is_member(conversation_id));

create function public.chat_open_direct(target_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); pair_key text; conv uuid;
begin
  perform public.community_require_registered();
  if target_id is null or target_id = me or not public.community_registered(target_id) then
    raise exception 'Usuario no disponible' using errcode = '22023'; end if;
  if not public.community_visible(target_id) or not exists(select 1 from public.friendships f where f.status = 'accepted'
    and least(f.requester_id,f.recipient_id) = least(me,target_id) and greatest(f.requester_id,f.recipient_id) = greatest(me,target_id)) then
    raise exception 'Conversación no disponible' using errcode = '42501'; end if;
  pair_key := least(me,target_id)::text || ':' || greatest(me,target_id)::text;
  insert into public.chat_conversations(kind,direct_key,created_by) values ('direct',pair_key,me)
    on conflict (direct_key) do nothing returning id into conv;
  if conv is null then select c.id into conv from public.chat_conversations c where c.direct_key = pair_key; end if;
  insert into public.chat_members(conversation_id,user_id) values (conv,me),(conv,target_id) on conflict do nothing;
  return conv;
end $$;

create function public.chat_list_conversations() returns table(
  id uuid, kind text, title text, peer_id uuid, peer_name text, peer_avatar_version integer,
  peer_last_read_at timestamptz, last_kind text, last_preview text, last_sender_id uuid,
  last_message_at timestamptz, unread integer, muted boolean, can_send boolean, last_deleted boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.community_require_registered();
  return query
  select c.id, c.kind, c.title, peer.user_id, p.display_name, p.avatar_version::integer, peer.last_read_at,
    lm.kind, case when lm.id is null or lm.deleted_at is not null then '' else left(regexp_replace(lm.body,'\r\n|\r|\n',' ','g'),80) end,
    lm.sender_id, c.last_message_at,
    (select count(*)::integer from (select 1 from public.chat_messages u where u.conversation_id = c.id and u.sender_id <> auth.uid()
      and u.deleted_at is null and (mine.last_read_at is null or u.created_at > mine.last_read_at) limit 99) unread_rows),
    mine.muted,
    c.kind <> 'direct' or exists(select 1 from public.friendships f where f.status = 'accepted'
      and least(f.requester_id,f.recipient_id) = least(auth.uid(),peer.user_id) and greatest(f.requester_id,f.recipient_id) = greatest(auth.uid(),peer.user_id)),
    lm.deleted_at is not null
  from public.chat_members mine
  join public.chat_conversations c on c.id = mine.conversation_id
  left join lateral (select o.user_id, o.last_read_at from public.chat_members o
    where o.conversation_id = c.id and o.user_id <> auth.uid() limit 1) peer on c.kind = 'direct'
  left join public.profiles p on p.id = peer.user_id
  left join lateral (select m.id, m.kind, m.body, m.sender_id, m.deleted_at from public.chat_messages m
    where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1) lm on true
  where mine.user_id = auth.uid() and mine.left_at is null and public.chat_is_member(c.id)
  order by c.last_message_at desc, c.id desc;
end $$;

create function public.chat_list_messages(conversation uuid, before_at timestamptz default null, page_size integer default 50) returns table(
  id uuid, conversation_id uuid, sender_id uuid, sender_name text, created_at timestamptz,
  kind text, body text, payload jsonb, deleted boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.community_require_registered();
  if page_size is null or page_size not between 1 and 100 then raise exception 'Página no válida' using errcode = '22023'; end if;
  if not public.chat_is_member(conversation) then raise exception 'Conversación no disponible' using errcode = '42501'; end if;
  return query select m.id, m.conversation_id, m.sender_id, p.display_name, m.created_at, m.kind, m.body, m.payload, m.deleted_at is not null
    from public.chat_messages m join public.profiles p on p.id = m.sender_id
    where m.conversation_id = chat_list_messages.conversation and (before_at is null or m.created_at < before_at)
    order by m.created_at desc, m.id desc limit page_size;
end $$;

-- Los parámetros no se llaman kind, body ni payload: chocarían con las columnas de salida.
create function public.chat_send(message_id uuid, conversation uuid, message_kind text, message_body text, message_payload jsonb default '{}'::jsonb)
returns table(id uuid, conversation_id uuid, sender_id uuid, sender_name text, created_at timestamptz, kind text, body text, payload jsonb, deleted boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare me uuid := auth.uid(); previous public.chat_messages; peer uuid;
begin
  perform public.community_require_registered();
  -- Lote 1: solo texto, sin carga.
  if message_id is null or conversation is null or message_kind is distinct from 'text' or message_body is null or message_body !~ '\S'
    or char_length(message_body) > 2000 or coalesce(message_payload,'{}'::jsonb) <> '{}'::jsonb then
    raise exception 'Mensaje no válido' using errcode = '22023'; end if;
  if not public.chat_is_member(conversation) then raise exception 'Conversación no disponible' using errcode = '42501'; end if;
  -- Serializa los envíos de cada cuenta: cuota e id repetido se comprueban sin carreras.
  insert into public.community_rate_limits(user_id) values (me) on conflict do nothing;
  perform 1 from public.community_rate_limits r where r.user_id = me for update;
  select * into previous from public.chat_messages m where m.id = chat_send.message_id;
  if found then
    -- Reintento: devuelve el guardado sin cobrar cuota; un id ajeno nunca devuelve el mensaje de otro.
    if previous.sender_id <> me or previous.conversation_id <> conversation then
      raise exception 'Mensaje no válido' using errcode = '22023'; end if;
  else
    if (select c.kind from public.chat_conversations c where c.id = conversation) = 'direct' then
      select o.user_id into peer from public.chat_members o where o.conversation_id = conversation and o.user_id <> me;
      if not exists(select 1 from public.friendships f where f.status = 'accepted'
        and least(f.requester_id,f.recipient_id) = least(me,peer) and greatest(f.requester_id,f.recipient_id) = greatest(me,peer)) then
        raise exception 'Ya no sois amigos' using errcode = '42501'; end if;
    end if;
    if (select count(*) from public.chat_messages m where m.sender_id = me and m.created_at > now() - interval '60 seconds') >= 30 then
      raise exception 'Demasiados mensajes seguidos' using errcode = 'P0429'; end if;
    if (select count(*) from public.chat_messages m where m.sender_id = me and m.created_at > now() - interval '24 hours') >= 600 then
      raise exception 'Límite diario de mensajes' using errcode = 'P0429'; end if;
    insert into public.chat_messages(id,conversation_id,sender_id,kind,body) values (chat_send.message_id,chat_send.conversation,me,'text',chat_send.message_body);
    update public.chat_conversations c set last_message_at = now() where c.id = conversation;
  end if;
  return query select m.id, m.conversation_id, m.sender_id, p.display_name, m.created_at, m.kind, m.body, m.payload, m.deleted_at is not null
    from public.chat_messages m join public.profiles p on p.id = m.sender_id where m.id = chat_send.message_id;
end $$;

create function public.chat_mark_read(conversation uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.community_require_registered();
  if not public.chat_is_member(conversation) then raise exception 'Conversación no disponible' using errcode = '42501'; end if;
  update public.chat_members m set last_read_at = now() where m.conversation_id = chat_mark_read.conversation and m.user_id = auth.uid();
end $$;

-- Se vacía en lugar de borrar la fila: los DELETE de Realtime no pasan por RLS.
create function public.chat_delete_message(message_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.community_require_registered();
  update public.chat_messages m set deleted_at = coalesce(m.deleted_at, now()), body = '', payload = '{}'::jsonb
    where m.id = chat_delete_message.message_id and m.sender_id = auth.uid();
  if not found then raise exception 'Conversación no disponible' using errcode = '42501'; end if;
end $$;

create function public.chat_set_muted(conversation uuid, muted boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.community_require_registered();
  if muted is null or not public.chat_is_member(conversation) then raise exception 'Conversación no disponible' using errcode = '42501'; end if;
  update public.chat_members m set muted = chat_set_muted.muted where m.conversation_id = chat_set_muted.conversation and m.user_id = auth.uid();
end $$;

create function public.chat_unread_count() returns integer
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.community_require_registered();
  return (select count(*)::integer from public.chat_members mine
    where mine.user_id = auth.uid() and mine.left_at is null and not mine.muted and public.chat_is_member(mine.conversation_id)
      and exists(select 1 from public.chat_messages m where m.conversation_id = mine.conversation_id and m.sender_id <> auth.uid()
        and m.deleted_at is null and (mine.last_read_at is null or m.created_at > mine.last_read_at)));
end $$;

create function public.report_chat_message(message_id uuid, reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare msg public.chat_messages;
begin
  perform public.community_require_registered();
  -- Mismo orden de cerrojos que block_cyclist, al que se llama al final.
  perform pg_catalog.pg_advisory_xact_lock(611160003);
  select * into msg from public.chat_messages m where m.id = report_chat_message.message_id;
  if not found or msg.sender_id = auth.uid() or not public.chat_is_member(msg.conversation_id)
    or reason is null or char_length(btrim(reason)) not between 5 and 500 then
    raise exception 'Denuncia no válida' using errcode = '22023'; end if;
  insert into public.community_rate_limits(user_id) values (auth.uid()) on conflict do nothing;
  perform 1 from public.community_rate_limits r where r.user_id = auth.uid() for update;
  if (select count(*) from public.community_reports r where r.reporter_id = auth.uid() and r.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'Límite diario de denuncias' using errcode = 'P0429'; end if;
  insert into public.community_reports(reporter_id,target_id,reason,message_id,message_body)
    values (auth.uid(),msg.sender_id,btrim(reason),msg.id,msg.body);
  perform public.block_cyclist(msg.sender_id, true);
end $$;

-- Aviso push por destinatario, con freno de 20 s por conversación salvo las propuestas.
-- community_visible usa la sesión de quien envía. Un fallo nunca impide guardar el mensaje.
create function private.notify_chat_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare config private.push_config; conv_title text; actor_name text; target record;
begin
  if new.kind = 'system' then return null; end if;
  select * into config from private.push_config;
  if not found then return null; end if;
  begin
    select c.title into conv_title from public.chat_conversations c where c.id = new.conversation_id;
    select p.display_name into actor_name from public.profiles p where p.id = new.sender_id;
    for target in select mb.user_id, mb.last_notified_at from public.chat_members mb
      where mb.conversation_id = new.conversation_id and mb.user_id <> new.sender_id and mb.left_at is null
        and not mb.muted and public.community_visible(mb.user_id) loop
      continue when new.kind <> 'proposal' and target.last_notified_at > now() - interval '20 seconds';
      -- Bloque propio: un destinatario que falla no deja sin aviso a los demás.
      begin
        perform net.http_post(
          url := config.url,
          body := jsonb_build_object('type', 'INSERT', 'table', 'chat_messages',
            'record', jsonb_build_object('user_id', target.user_id, 'kind', new.kind, 'conversation_id', new.conversation_id,
              'actor_name', actor_name, 'title', conv_title,
              'preview', case when new.kind = 'text' then left(new.body, 120) end)),
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', config.secret),
          timeout_milliseconds := 5000);
        update public.chat_members mb set last_notified_at = now()
          where mb.conversation_id = new.conversation_id and mb.user_id = target.user_id;
      exception when others then null;
      end;
    end loop;
  exception when others then null;
  end;
  return null;
end $$;
create trigger chat_messages_push after insert on public.chat_messages
  for each row execute function private.notify_chat_push();

-- PGlite no tiene la publicación de Realtime.
do $$ begin
  if exists(select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

revoke all on function public.chat_is_member(uuid), public.chat_open_direct(uuid), public.chat_list_conversations(),
  public.chat_list_messages(uuid,timestamptz,integer), public.chat_send(uuid,uuid,text,text,jsonb), public.chat_mark_read(uuid),
  public.chat_delete_message(uuid), public.chat_set_muted(uuid,boolean), public.chat_unread_count(),
  public.report_chat_message(uuid,text) from public, anon, authenticated;
grant execute on function public.chat_is_member(uuid), public.chat_open_direct(uuid), public.chat_list_conversations(),
  public.chat_list_messages(uuid,timestamptz,integer), public.chat_send(uuid,uuid,text,text,jsonb), public.chat_mark_read(uuid),
  public.chat_delete_message(uuid), public.chat_set_muted(uuid,boolean), public.chat_unread_count(),
  public.report_chat_message(uuid,text) to authenticated;
revoke all on function private.notify_chat_push() from public, anon, authenticated;
commit;
