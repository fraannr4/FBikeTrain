begin;

create table public.shared_ai_usage (
  bucket text not null,
  window_start timestamptz not null,
  calls integer not null check (calls >= 0),
  primary key (bucket, window_start)
);
alter table public.shared_ai_usage enable row level security;
revoke all on public.shared_ai_usage from public, anon, authenticated;

-- Solo el servidor autenticado como service_role puede consumir. No acepta límites del navegador.
-- Cuotas conservadoras iniciales: 12 operaciones/día/usuario y 40 globales;
-- 2 operaciones/minuto/usuario y 3 globales. plan + explain cuentan como dos operaciones.
create function public.consume_shared_ai_quota(account_id uuid)
returns table(allowed boolean, retry_after_s integer)
language plpgsql security definer set search_path = '' as $$
declare
  current_time_utc timestamptz := now();
  day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  minute_start timestamptz := date_trunc('minute', now());
  user_day text := 'user:' || account_id::text || ':day';
  user_minute text := 'user:' || account_id::text || ':minute';
begin
  if account_id is null then raise exception 'Cuenta no válida' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fbiketrain_shared_ai_quota', 0));
  if coalesce((select calls from public.shared_ai_usage where bucket = user_day and window_start = day_start), 0) >= 12
    or coalesce((select calls from public.shared_ai_usage where bucket = 'global:day' and window_start = day_start), 0) >= 40 then
    return query select false, greatest(1, ceil(extract(epoch from day_start + interval '1 day' - current_time_utc))::integer);
    return;
  end if;
  if coalesce((select calls from public.shared_ai_usage where bucket = user_minute and window_start = minute_start), 0) >= 2
    or coalesce((select calls from public.shared_ai_usage where bucket = 'global:minute' and window_start = minute_start), 0) >= 3 then
    return query select false, greatest(1, ceil(extract(epoch from minute_start + interval '1 minute' - current_time_utc))::integer);
    return;
  end if;
  delete from public.shared_ai_usage where window_start < day_start - interval '2 days';
  insert into public.shared_ai_usage(bucket, window_start, calls) values
    (user_day, day_start, 1), (user_minute, minute_start, 1),
    ('global:day', day_start, 1), ('global:minute', minute_start, 1)
  on conflict (bucket, window_start) do update set calls = public.shared_ai_usage.calls + 1;
  return query select true, 0;
end;
$$;
revoke all on function public.consume_shared_ai_quota(uuid) from public, anon, authenticated;
grant execute on function public.consume_shared_ai_quota(uuid) to service_role;
commit;
