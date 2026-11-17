-- Sincronización entre dispositivos de una misma cuenta.
-- Cada fila es un dato del usuario (salida, track, entreno, objetivo, ruta propia o ajustes) cifrado en
-- el navegador con la clave de `sync_keys`. El servidor nunca ve el contenido en claro, solo el tipo,
-- el identificador, la fecha del cambio y el tamaño.
-- Sin permisos directos sobre las tablas: todo pasa por funciones que actúan solo sobre auth.uid().
begin;

create table public.sync_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  key text not null check (key ~ '^[A-Za-z0-9+/]{43}=$'),
  created_at timestamptz not null default now()
);
create table public.sync_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bytes bigint not null default 0 check (bytes >= 0),
  items integer not null default 0 check (items >= 0)
);
create sequence public.sync_seq;
create table public.sync_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('activity','track','workout','goal','route','settings')),
  item_id text not null check (char_length(item_id) between 1 and 200),
  -- Momento del cambio en el dispositivo (epoch ms), nunca posterior al reloj del servidor.
  changed_ms bigint not null check (changed_ms >= 0),
  seq bigint not null default nextval('public.sync_seq'),
  -- null: el dato se borró. El borrado se conserva para propagarlo a los demás dispositivos.
  payload text check (payload is null or char_length(payload) between 1 and 4000000),
  primary key (user_id, kind, item_id)
);
create index sync_items_seq on public.sync_items(user_id, seq);

alter table public.sync_keys enable row level security;
alter table public.sync_usage enable row level security;
alter table public.sync_items enable row level security;
revoke all on public.sync_keys, public.sync_usage, public.sync_items from public, anon, authenticated;
revoke all on sequence public.sync_seq from public, anon, authenticated;

create function public.sync_require_account() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null or exists(select 1 from auth.users u where u.id = me and u.is_anonymous) then
    raise exception 'Cuenta no válida' using errcode = '42501';
  end if;
  return me;
end $$;

-- Devuelve la clave de la cuenta. Si aún no hay, guarda la candidata; dos dispositivos a la vez
-- acaban con la misma.
create function public.sync_key(candidate text) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.sync_require_account(); stored text;
begin
  if candidate is null or candidate !~ '^[A-Za-z0-9+/]{43}=$' then
    raise exception 'Clave no válida' using errcode = '22023';
  end if;
  insert into public.sync_keys(user_id, key) values(me, candidate) on conflict (user_id) do nothing;
  select k.key into stored from public.sync_keys k where k.user_id = me;
  return stored;
end $$;

-- Sube cambios. Gana el más reciente: una fila solo se sustituye si el cambio es posterior al guardado.
-- Límites por cuenta: 150 MB y 60 000 datos.
create function public.sync_push(items jsonb)
returns table(kind text, item_id text, changed_ms bigint, accepted boolean)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.sync_require_account();
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  item jsonb; k text; i text; ms bigint; body text;
  prev public.sync_items; had boolean; delta_bytes bigint := 0; delta_items integer := 0; used public.sync_usage;
begin
  if items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) not between 1 and 200 then
    raise exception 'Lote no válido' using errcode = '22023';
  end if;
  -- Tope del lote entero, antes de escribir nada: una llamada no puede cargar cientos de MB.
  if (select coalesce(sum(char_length(e->>'payload')), 0) from jsonb_array_elements(items) e) > 8000000 then
    raise exception 'Lote demasiado grande' using errcode = '22023';
  end if;
  -- Un lote por cuenta a la vez: el orden de `seq` coincide con el de confirmación.
  perform pg_advisory_xact_lock(hashtextextended(me::text, 7));
  for item in select * from jsonb_array_elements(items) loop
    k := item->>'kind'; i := item->>'item_id'; body := item->>'payload';
    if jsonb_typeof(item->'changed_ms') is distinct from 'number' or k is null or i is null
      or k not in ('activity','track','workout','goal','route','settings')
      or char_length(i) not between 1 and 200
      or (body is not null and char_length(body) not between 1 and 4000000) then
      raise exception 'Dato no válido' using errcode = '22023';
    end if;
    ms := least(greatest((item->>'changed_ms')::numeric, 0), now_ms)::bigint;
    select * into prev from public.sync_items s where s.user_id = me and s.kind = k and s.item_id = i;
    had := found;
    if had and prev.changed_ms >= ms then
      kind := k; item_id := i; changed_ms := prev.changed_ms; accepted := false; return next; continue;
    end if;
    if had then
      update public.sync_items s set changed_ms = ms, payload = body, seq = nextval('public.sync_seq')
        where s.user_id = me and s.kind = k and s.item_id = i;
    else
      insert into public.sync_items(user_id, kind, item_id, changed_ms, payload) values(me, k, i, ms, body);
      delta_items := delta_items + 1;
    end if;
    delta_bytes := delta_bytes + coalesce(char_length(body), 0) - case when had then coalesce(char_length(prev.payload), 0) else 0 end;
    kind := k; item_id := i; changed_ms := ms; accepted := true; return next;
  end loop;
  insert into public.sync_usage(user_id, bytes, items) values(me, greatest(delta_bytes, 0), delta_items)
    on conflict (user_id) do update set bytes = greatest(public.sync_usage.bytes + delta_bytes, 0),
      items = public.sync_usage.items + delta_items
    returning * into used;
  if (delta_bytes > 0 or delta_items > 0) and (used.bytes > 150000000 or used.items > 60000) then
    raise exception 'sync_quota' using errcode = '53400';
  end if;
end $$;

-- Lista los cambios posteriores a `after`, sin contenido.
create function public.sync_list(after bigint, max_rows integer)
returns table(seq bigint, kind text, item_id text, changed_ms bigint, deleted boolean)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := public.sync_require_account();
begin
  if after is null or after < 0 or max_rows is null or max_rows not between 1 and 1000 then
    raise exception 'Página no válida' using errcode = '22023';
  end if;
  return query select s.seq, s.kind, s.item_id, s.changed_ms, s.payload is null
    from public.sync_items s where s.user_id = me and s.seq > after order by s.seq limit max_rows;
end $$;

-- Descarga el contenido de los datos pedidos (como mucho 50 por llamada).
create function public.sync_fetch(keys jsonb)
returns table(kind text, item_id text, changed_ms bigint, payload text)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := public.sync_require_account();
begin
  if keys is null or jsonb_typeof(keys) <> 'array' or jsonb_array_length(keys) not between 1 and 50 then
    raise exception 'Lote no válido' using errcode = '22023';
  end if;
  return query select s.kind, s.item_id, s.changed_ms, s.payload
    from public.sync_items s
    join jsonb_array_elements(keys) wanted on s.kind = wanted->>'kind' and s.item_id = wanted->>'item_id'
    where s.user_id = me;
end $$;

revoke all on function public.sync_require_account(), public.sync_key(text), public.sync_push(jsonb),
  public.sync_list(bigint, integer), public.sync_fetch(jsonb) from public, anon, authenticated;
grant execute on function public.sync_key(text), public.sync_push(jsonb), public.sync_list(bigint, integer),
  public.sync_fetch(jsonb) to authenticated;
commit;
