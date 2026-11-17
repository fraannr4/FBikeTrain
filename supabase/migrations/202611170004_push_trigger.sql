-- Dispara la Edge Function `push` en cada aviso nuevo de la comunidad.
-- El secreto compartido NO está en este fichero: se guarda en private.push_config, que
-- solo lee la función del trigger. Sin fila de configuración, el trigger no hace nada.
-- Un fallo al encolar la petición nunca impide crear el aviso.
begin;

create extension if not exists pg_net;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.push_config (
  id boolean primary key default true check (id),
  url text not null check (url ~ '^https://'),
  secret text not null check (char_length(secret) >= 32)
);
revoke all on private.push_config from public, anon, authenticated;

create function private.notify_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare config private.push_config;
begin
  select * into config from private.push_config;
  if not found then return null; end if;
  begin
    perform net.http_post(
      url := config.url,
      body := jsonb_build_object('type', 'INSERT', 'table', 'community_notifications',
        'record', jsonb_build_object('user_id', new.user_id, 'kind', new.kind, 'challenge_id', new.challenge_id)),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', config.secret),
      timeout_milliseconds := 5000);
  exception when others then null;
  end;
  return null;
end $$;
revoke all on function private.notify_push() from public, anon, authenticated;

create trigger community_notifications_push after insert on public.community_notifications
  for each row execute function private.notify_push();
commit;
