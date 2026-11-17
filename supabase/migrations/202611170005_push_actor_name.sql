-- El aviso push dice quién lo provoca: el trigger añade el nombre público del actor.
-- Solo el nombre público (el mismo que ya se ve en la app): ni usuario, ni zona, ni identificadores.
begin;

create or replace function private.notify_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare config private.push_config; actor_name text;
begin
  select * into config from private.push_config;
  if not found then return null; end if;
  begin
    if new.actor_id is not null then
      select p.display_name into actor_name from public.profiles p where p.id = new.actor_id;
    end if;
    perform net.http_post(
      url := config.url,
      body := jsonb_build_object('type', 'INSERT', 'table', 'community_notifications',
        'record', jsonb_build_object('user_id', new.user_id, 'kind', new.kind, 'challenge_id', new.challenge_id,
          'actor_name', actor_name)),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', config.secret),
      timeout_milliseconds := 5000);
  exception when others then null;
  end;
  return null;
end $$;
revoke all on function private.notify_push() from public, anon, authenticated;
commit;
