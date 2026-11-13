begin;

-- Límites del motor de rutas compartido casi al máximo de la clave gratuita de ORS (2.000 al día y 40 por minuto),
-- con un pequeño margen: global 1.900 al día y 38 por minuto; por usuario 1.500 al día y 38 por minuto.
create or replace function public.consume_shared_ors_quota(account_id uuid, cost integer)
returns table(allowed boolean, retry_after_s integer)
language plpgsql security definer set search_path = '' as $$
declare
  current_time_utc timestamptz := now();
  day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  minute_start timestamptz := date_trunc('minute', now());
  user_day text := 'ors:user:' || account_id::text || ':day';
  user_minute text := 'ors:user:' || account_id::text || ':minute';
begin
  if account_id is null then raise exception 'Cuenta no válida' using errcode = '22023'; end if;
  if cost is null or cost < 1 or cost > 8 then raise exception 'Coste no válido' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fbiketrain_shared_ors_quota', 0));
  if coalesce((select calls from public.shared_ai_usage where bucket = user_day and window_start = day_start), 0) + cost > 1500
    or coalesce((select calls from public.shared_ai_usage where bucket = 'ors:global:day' and window_start = day_start), 0) + cost > 1900 then
    return query select false, greatest(1, ceil(extract(epoch from day_start + interval '1 day' - current_time_utc))::integer);
    return;
  end if;
  if coalesce((select calls from public.shared_ai_usage where bucket = user_minute and window_start = minute_start), 0) + cost > 38
    or coalesce((select calls from public.shared_ai_usage where bucket = 'ors:global:minute' and window_start = minute_start), 0) + cost > 38 then
    return query select false, greatest(1, ceil(extract(epoch from minute_start + interval '1 minute' - current_time_utc))::integer);
    return;
  end if;
  delete from public.shared_ai_usage where bucket like 'ors:%' and window_start < day_start - interval '2 days';
  insert into public.shared_ai_usage(bucket, window_start, calls) values
    (user_day, day_start, cost), (user_minute, minute_start, cost),
    ('ors:global:day', day_start, cost), ('ors:global:minute', minute_start, cost)
  on conflict (bucket, window_start) do update set calls = public.shared_ai_usage.calls + excluded.calls;
  return query select true, 0;
end;
$$;
revoke all on function public.consume_shared_ors_quota(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_shared_ors_quota(uuid, integer) to service_role;
commit;
