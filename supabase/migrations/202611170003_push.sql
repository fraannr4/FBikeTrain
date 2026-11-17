-- Avisos push (Web Push): una fila por dispositivo suscrito.
-- Aditiva: solo crea una tabla y una función nuevas; no toca nada existente.
-- El envío lo hace la Edge Function `push` con service_role; el navegador solo da de alta, lee y borra lo suyo.
begin;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://[^/@:\s]+/' and char_length(endpoint) <= 1000),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  user_agent text check (user_agent is null or char_length(user_agent) <= 120),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index push_subscriptions_user on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
-- El servidor lee, borra los endpoints caducados y anota el último envío correcto; nada más.
grant select, delete on public.push_subscriptions to service_role;
grant update (last_ok_at) on public.push_subscriptions to service_role;
create policy push_subscriptions_read on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid() and (select public.community_current_registered()));
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());
create policy push_subscriptions_server on public.push_subscriptions for all to service_role using (true) with check (true);

-- Alta o renovación. Un dispositivo (endpoint) pertenece a quien tiene la sesión abierta en él:
-- si otra cuenta inicia sesión en el mismo navegador, la fila pasa a ella.
create function public.register_push_subscription(push_endpoint text, push_p256dh text, push_auth text, push_agent text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.community_require_registered();
  if push_endpoint is null or push_p256dh is null or push_auth is null
    or push_endpoint !~ '^https://[^/@:\s]+/' or char_length(push_endpoint) > 1000
    or push_p256dh !~ '^[A-Za-z0-9_-]{80,100}$' or push_auth !~ '^[A-Za-z0-9_-]{16,32}$' then
    raise exception 'Suscripción no válida' using errcode = '22023';
  end if;
  -- Serializa las altas de la cuenta para que el límite no se sortee con peticiones paralelas.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('push:' || auth.uid()::text, 0));
  if not exists(select 1 from public.push_subscriptions s where s.endpoint = push_endpoint and s.user_id = auth.uid())
    and (select count(*) from public.push_subscriptions s where s.user_id = auth.uid()) >= 10 then
    raise exception 'Demasiados dispositivos con avisos' using errcode = '53400';
  end if;
  insert into public.push_subscriptions(user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), push_endpoint, push_p256dh, push_auth, left(push_agent, 120))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, last_ok_at = null;
end $$;
revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

commit;
