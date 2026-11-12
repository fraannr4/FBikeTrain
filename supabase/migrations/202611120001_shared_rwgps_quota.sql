begin;

-- Cuota de Ride with GPS compartido (función rwgps). Reutiliza la tabla de contadores de la IA
-- con buckets propios «rwgps:...». Solo el servidor (service_role) puede consumir.
-- Cada ruta o colección es una petición a la cuenta común: por usuario 300 al día; en total 3.000 al día.
create function public.consume_shared_rwgps_quota(account_id uuid)
returns table(allowed boolean, retry_after_s integer)
language plpgsql security definer set search_path = '' as $$
declare
  current_time_utc timestamptz := now();
  day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  user_day text := 'rwgps:user:' || account_id::text || ':day';
begin
  if account_id is null then raise exception 'Cuenta no válida' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fbiketrain_shared_rwgps_quota', 0));
  if coalesce((select calls from public.shared_ai_usage where bucket = user_day and window_start = day_start), 0) + 1 > 300
    or coalesce((select calls from public.shared_ai_usage where bucket = 'rwgps:global:day' and window_start = day_start), 0) + 1 > 3000 then
    return query select false, greatest(1, ceil(extract(epoch from day_start + interval '1 day' - current_time_utc))::integer);
    return;
  end if;
  delete from public.shared_ai_usage where bucket like 'rwgps:%' and window_start < day_start - interval '2 days';
  insert into public.shared_ai_usage(bucket, window_start, calls) values
    (user_day, day_start, 1), ('rwgps:global:day', day_start, 1)
  on conflict (bucket, window_start) do update set calls = public.shared_ai_usage.calls + excluded.calls;
  return query select true, 0;
end;
$$;
revoke all on function public.consume_shared_rwgps_quota(uuid) from public, anon, authenticated;
grant execute on function public.consume_shared_rwgps_quota(uuid) to service_role;
commit;
